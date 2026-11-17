import pytest

from pipeline.roi_explore import validate_roi, select_scenes, cache_key
from pipeline.sources.base import SceneMeta


ROI = {'type': 'Polygon', 'coordinates': [[[-93, 16], [-92.9, 16], [-92.9, 16.1], [-93, 16.1], [-93, 16]]]}


def scene(day, crid='P1', maturity='PROVISIONAL'):
    return SceneMeta(f'scene{day}{crid}', 'asf', 'GCOV', 1, 2, 'ASCENDING', ('HH',), crid, maturity, day)


def test_valid_roi_and_cache_isolation():
    wkt = validate_roi(ROI)
    assert wkt.startswith('POLYGON')
    assert cache_key(wkt, 'v1') != cache_key(wkt, 'v2')
    assert cache_key(wkt, 'v1') != cache_key(wkt.replace('-93', '-93.01'), 'v1')


@pytest.mark.parametrize('roi', [None, {}, {'type': 'Point', 'coordinates': [0, 0]},
    {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
    {'type': 'Polygon', 'coordinates': [[[0, 0], [10, 0], [10, 10], [0, 0]]]}])
def test_invalid_roi(roi):
    with pytest.raises(ValueError):
        validate_roi(roi)


def test_select_comparable_pair_without_mixing_versions():
    a, b, c = scene('2026-01-01'), scene('2026-02-01'), scene('2026-03-01', 'P2')
    assert select_scenes([c, a, b]) == [a, b]
    assert select_scenes([c]) == [c]
    assert select_scenes([scene('2026-01-01', maturity=None)]) == []
    assert select_scenes([]) == []


def test_preparation_uses_remote_windows_and_publishes_one_scene(tmp_path, monkeypatch):
    """Integración con H5 sintético: sustituye HTTPS, no el procesamiento SAR."""
    import json
    from dataclasses import replace
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline.tests.test_subset import make_gcov, scene as synthetic_scene, ROI as synthetic_roi
    from pipeline.tests.test_etapa1 import add_radar_grid, FakeHTTPS
    from pipeline import sources
    from pipeline.sources import asf
    from pipeline.roi_explore import prepare, write_json

    h5, _ = make_gcov(tmp_path / 'synthetic.h5')
    add_radar_grid(h5)
    remote = FakeHTTPS(h5)
    selected = replace(synthetic_scene(), url='https://example.invalid/synthetic.h5')
    class Source:
        def search(self, roi, product):
            assert product == 'GCOV'
            assert wkt.loads(roi).equals(wkt.loads(synthetic_roi))
            return [selected]
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    monkeypatch.setattr(asf, 'earthdata_https_fs', lambda: remote)
    run = tmp_path / 'run'
    run.mkdir()
    write_json(run / 'request.json', {'roi': mapping(wkt.loads(synthetic_roi))})
    prepare(run)
    result = json.loads((run / 'result.json').read_text(encoding='utf-8'))
    assert len(result['manifests']) == 1
    assert result['comparable'] is False
    assert result['manifests'][0]['procedencia']['identidad_verificada_contra_catalogo']
    assert all(c['escala']['vmin_dB'] == -22 for c in result['manifests'][0]['capas'])
    assert remote.opened[0][1]['cache_type'] == 'blockcache'
    assert not list(run.rglob('*.h5'))


def test_preparation_records_phase_timings_with_monotonic_clock(tmp_path, monkeypatch):
    import json
    from dataclasses import replace
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline.tests.test_subset import make_gcov, scene as synthetic_scene, ROI as synthetic_roi
    from pipeline.tests.test_etapa1 import add_radar_grid, FakeHTTPS
    from pipeline import sources, roi_explore
    from pipeline.sources import asf

    h5, _ = make_gcov(tmp_path / 'synthetic.h5')
    add_radar_grid(h5)
    selected = replace(synthetic_scene(), url='https://example.invalid/synthetic.h5')
    class Source:
        def search(self, roi, product):
            return [selected]
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    monkeypatch.setattr(asf, 'earthdata_https_fs', lambda: FakeHTTPS(h5))
    monkeypatch.setattr(roi_explore, 'COPY_ROOT', tmp_path / 'graficas-roi')
    ticks = iter(range(100, 200))
    monkeypatch.setattr(roi_explore.time, 'monotonic', lambda: next(ticks))
    run = tmp_path / 'timed'
    run.mkdir()
    roi_explore.write_json(run / 'request.json', {'roi': mapping(wkt.loads(synthetic_roi))})

    roi_explore.prepare(run)
    timings = json.loads((run / 'result.json').read_text(encoding='utf-8'))['timings']
    assert timings['search_asf_seconds'] == 1.0
    assert timings['scene_processing_seconds'] == [1.0]
    assert timings['grid_compare_seconds'] == 1.0
    assert timings['chart_copy_seconds'] == 1.0
    assert timings['server_prepare_total_seconds'] == 9.0
    assert all(isinstance(value, float) for value in timings.values() if not isinstance(value, list))


def test_preparation_returns_charts_and_saves_copy(tmp_path, monkeypatch):
    """La ROI devuelve sus gráficas (incidencia, retrodispersión, máscara) y deja una copia en disco."""
    import json
    from dataclasses import replace
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline.tests.test_subset import make_gcov, scene as synthetic_scene, ROI as synthetic_roi
    from pipeline.tests.test_etapa1 import add_radar_grid, FakeHTTPS
    from pipeline import sources, roi_explore
    from pipeline.sources import asf

    h5, _ = make_gcov(tmp_path / 'synthetic.h5')
    add_radar_grid(h5)
    selected = replace(synthetic_scene(), url='https://example.invalid/synthetic.h5')

    class Source:
        def search(self, roi, product):
            return [selected]
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    monkeypatch.setattr(asf, 'earthdata_https_fs', lambda: FakeHTTPS(h5))
    monkeypatch.setattr(roi_explore, 'COPY_ROOT', tmp_path / 'graficas-roi')
    run = tmp_path / 'abc123'
    run.mkdir()
    roi_explore.write_json(run / 'request.json', {'roi': mapping(wkt.loads(synthetic_roi))})
    roi_explore.prepare(run)

    result = json.loads((run / 'result.json').read_text(encoding='utf-8'))
    assert len(result['charts']) == 1
    entry = result['charts'][0]
    assert entry['granuleId'] == result['manifests'][0]['escena']['granuleId']
    ids = {g['id'] for g in entry['manifest']['graficas']}
    assert ids == {'histograma_gamma0_dB', 'mascara_roi', 'incidencia_por_altura'}
    # La máscara es la de la ROI dibujada, no la de Chiapas
    meta_roi = json.loads((run / 'layers' / entry['granuleId'] / 'metadatos.json').read_text(encoding='utf-8'))['roi']
    assert wkt.loads(meta_roi['wkt_4326']).equals(wkt.loads(synthetic_roi))

    copy = tmp_path / 'graficas-roi' / 'abc123'
    assert result['copia_disco'] == copy.resolve().as_posix()
    assert json.loads((copy / entry['granuleId'] / 'graficas.json').read_text(encoding='utf-8')) == entry['manifest']
    assert (copy / entry['granuleId'] / 'metadatos.json').is_file()
    summary = json.loads((copy / 'roi.json').read_text(encoding='utf-8'))
    assert summary['id'] == 'abc123' and summary['escenas'] == [entry['granuleId']]
