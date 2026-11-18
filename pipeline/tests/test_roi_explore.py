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

    monkeypatch.setattr('pipeline.roi_explore.COPY_ROOT', tmp_path / 'graficas-roi')
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
    assert result['change'] is None          # una sola fecha: no hay mapa de cambio
    assert result['manifests'][0]['procedencia']['identidad_verificada_contra_catalogo']
    assert all(c['escala']['vmin_dB'] == -22 for c in result['manifests'][0]['capas'])
    assert remote.opened[0][1]['cache_type'] == 'blockcache'
    assert not list(run.rglob('*.h5'))
    scene_dir = run / 'layers' / result['manifests'][0]['escena']['granuleId']
    assert list((scene_dir / 'web').glob('*.tif'))
    assert list((scene_dir / 'web').glob('*.png'))
    assert (scene_dir / 'graficas.json').is_file()
    assert (scene_dir / 'metadatos.json').is_file()


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
    root = roi_explore.Path(__file__).resolve().parents[2]
    resolved_copy = copy.resolve()
    expected_copy = (resolved_copy.relative_to(root).as_posix()
                     if resolved_copy.is_relative_to(root) else resolved_copy.as_posix())
    assert result['copia_disco'] == expected_copy
    assert json.loads((copy / entry['granuleId'] / 'graficas.json').read_text(encoding='utf-8')) == entry['manifest']
    assert (copy / entry['granuleId'] / 'metadatos.json').is_file()
    summary = json.loads((copy / 'roi.json').read_text(encoding='utf-8'))
    assert summary['id'] == 'abc123' and summary['escenas'] == [entry['granuleId']]


def _local_scene(scene_id, date, h5_path, *, crid='P05023'):
    from dataclasses import replace
    from pipeline.tests.test_subset import scene as synthetic_scene
    base = synthetic_scene(scene_id=scene_id)
    return replace(base, crid=crid, start_time=f'{date}T00:00:00Z',
                   extra={'local_h5': str(h5_path)})


def test_prepare_pair_uses_two_local_h5_children_in_selected_order(tmp_path, monkeypatch):
    import json
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline import roi_explore, sources
    from pipeline.tests.test_subset import make_gcov, ROI as synthetic_roi
    from pipeline.tests.test_etapa1 import add_radar_grid

    monkeypatch.setattr(roi_explore, 'COPY_ROOT', tmp_path / 'graficas-roi')
    scenes = []
    for sid, date in (('PAIR_EARLY', '2026-01-01'), ('PAIR_LATE', '2026-02-01')):
        h5, _ = make_gcov(tmp_path / f'{sid}.h5', granule=sid)
        add_radar_grid(h5)
        scenes.append(_local_scene(sid, date, h5))
    extra_h5, _ = make_gcov(tmp_path / 'unselected.h5', granule='UNSELECTED')
    add_radar_grid(extra_h5)
    unselected = _local_scene('UNSELECTED', '2026-03-01', extra_h5, crid='OTHER')

    class Source:
        def search(self, roi, product):
            assert wkt.loads(roi).equals(wkt.loads(synthetic_roi))
            return [scenes[1], unselected, scenes[0]]
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    run = tmp_path / 'pair-run'
    run.mkdir()
    roi_explore.write_json(run / 'request.json', {'roi': mapping(wkt.loads(synthetic_roi))})
    roi_explore.prepare(run)

    result = json.loads((run / 'result.json').read_text(encoding='utf-8'))
    assert [m['escena']['granuleId'] for m in result['manifests']] == ['PAIR_EARLY', 'PAIR_LATE']
    assert [c['granuleId'] for c in result['charts']] == ['PAIR_EARLY', 'PAIR_LATE']
    assert result['comparable'] is True
    for sid in ('PAIR_EARLY', 'PAIR_LATE'):
        scene_dir = run / 'layers' / sid
        assert list((scene_dir / 'web').glob('*.tif'))
        assert list((scene_dir / 'web').glob('*.png'))
        assert (scene_dir / 'graficas.json').is_file()
        assert (scene_dir / 'metadatos.json').is_file()
        assert json.loads((scene_dir / 'metadatos.json').read_text())['identificacion']['granuleId'] == sid
    assert not (run / 'layers' / 'UNSELECTED').exists()

    # Mapa de cambio t2 − t1 sobre la misma ROI dibujada (comparable → se calcula).
    change = result['change']
    assert change['tipo'] == 'mapa_de_cambio'
    assert change['t1'] == 'PAIR_EARLY' and change['t2'] == 'PAIR_LATE'
    assert {c['capa'] for c in change['capas']} == {'HHHH', 'HVHV'}
    # Por defecto: multilook 5×5 desde la potencia lineal del producto y umbral de 3 dB.
    default = run / 'layers' / 'cambio' / 'ml5_u3'
    assert change['multilook'] == 5 and change['umbral_dB'] == 3.0
    assert change['opciones'] == {'multilook': [2, 5, 10], 'umbral_dB': [1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0]}
    for layer in change['capas']:
        assert layer['escala']['colormap'] == 'rdbu'
        assert (layer['escala']['vmin_dB'], layer['escala']['vmax_dB']) == (-6.0, 6.0)
        png = default / 'web' / f"{layer['id']}.png"
        assert png.is_file() and layer['png'].endswith(f"layers/cambio/ml5_u3/web/{layer['id']}.png")
    assert set(change['metricas']) == {'HH', 'HV'}
    assert {'ruido_dB', 'pct_abs_z_mayor_3', 'umbral_cerca_del_ruido'} <= set(change['metricas']['HH'])
    assert (default / 'change.json').is_file()

    # Recalcular con otra combinación: carpeta propia, sin tocar las fechas ni volver a ASF.
    other = roi_explore.recompute_change(run, 2, 1.5)
    assert other['multilook'] == 2 and other['umbral_dB'] == 1.5
    assert other['opciones'] == change['opciones']
    assert all('layers/cambio/ml2_u1.5/web/' in c['png'] for c in other['capas'])
    assert other['pixel_m'] == change['pixel_m'] * 2 / 5
    stamp = (run / 'layers' / 'cambio' / 'ml2_u1.5' / 'change.json').stat().st_mtime_ns
    assert roi_explore.recompute_change(run, 2, '1.5') == other           # caché por combinación
    assert (run / 'layers' / 'cambio' / 'ml2_u1.5' / 'change.json').stat().st_mtime_ns == stamp
    assert roi_explore.recompute_change(run, 5, 3) == change               # la de por defecto ya existe
    for looks, threshold in ((1, 3), (5, 3.3), (True, 3), ('x', 3), (5, float('nan'))):
        with pytest.raises(ValueError):
            roi_explore.recompute_change(run, looks, threshold)


def test_scene_children_keep_selected_order_and_reap_both(tmp_path, monkeypatch):
    import json
    from pipeline import roi_explore

    selected = [scene('2026-01-01'), scene('2026-02-01')]
    observed = {'polls': [0, 0], 'waited': [], 'launched': []}

    class Child:
        def __init__(self, index):
            self.index = index
            self.args = ['worker', str(index)]
        def poll(self):
            observed['polls'][self.index] += 1
            # El segundo termina primero; el primero permanece activo una iteración más.
            if self.index == 1:
                return 0
            return 0 if observed['polls'][self.index] >= 2 else None
        def wait(self, timeout=None):
            observed['waited'].append(self.index)
            return 0
        def terminate(self):
            raise AssertionError('No debe terminarse un hijo exitoso')

    def fake_popen(args, **kwargs):
        observed['launched'].append(args)
        index = int(args[-1])
        (tmp_path / f'scene-result-{index}.json').write_text(
            json.dumps({'manifest': {'index': index}, 'charts': None}), encoding='utf-8')
        return Child(index)

    monkeypatch.setattr(roi_explore.subprocess, 'Popen', fake_popen)
    monkeypatch.setattr(roi_explore.time, 'sleep', lambda _: None)
    results = roi_explore._run_scene_children(tmp_path, selected, roi_explore.time.monotonic() + 10)
    assert [item['manifest']['index'] for item in results] == [0, 1]
    assert [args[-2] for args in observed['launched']] == [selected[0].scene_id, selected[1].scene_id]
    assert sorted(observed['waited']) == [0, 1]


def test_scene_children_fail_fast_and_reap_active_child(tmp_path, monkeypatch):
    import subprocess
    from pipeline import roi_explore

    observed = {'launched': [], 'terminated': [], 'waited': []}
    class Child:
        def __init__(self, index): self.index, self.polls = index, 0
        def poll(self):
            self.polls += 1
            return None if self.index == 0 else 7
        def terminate(self): observed['terminated'].append(self.index)
        def wait(self, timeout=None): observed['waited'].append(self.index); return 0
    def fake_popen(args, **kwargs):
        observed['launched'].append(args)
        return Child(int(args[-1]))
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', fake_popen)
    with pytest.raises(subprocess.CalledProcessError):
        roi_explore._run_scene_children(tmp_path, [scene('2026-01-01'), scene('2026-02-01')],
                                        roi_explore.time.monotonic() + 10)
    assert observed['terminated'] == [0]
    assert observed['waited'] == [0, 1]


def test_slow_search_expiring_deadline_launches_no_scene_children(tmp_path, monkeypatch):
    import json
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline import roi_explore, sources, catalog
    from pipeline.tests.test_subset import ROI as synthetic_roi

    monkeypatch.setattr(catalog, 'code_version', lambda: 'test')
    tick = {'value': 0}
    def monotonic(): return tick['value']
    monkeypatch.setattr(roi_explore.time, 'monotonic', monotonic)
    pair = [scene('2026-01-01'), scene('2026-02-01')]
    class Source:
        def search(self, roi, product):
            tick['value'] = 1500
            return pair
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', lambda *a, **k: pytest.fail('No child launch after deadline'))
    run = tmp_path / 'expired-run'
    run.mkdir()
    roi_explore.write_json(run / 'request.json', {'roi': mapping(wkt.loads(synthetic_roi))})
    with pytest.raises(roi_explore.RoiPreparationError, match='reintentar'):
        roi_explore.prepare(run)
    assert not list(run.glob('scene-result-*.json'))


def test_recompute_change_requires_comparable_ready_job(tmp_path):
    from pipeline import roi_explore
    run = tmp_path / 'run'
    run.mkdir()
    with pytest.raises(ValueError, match='lista'):
        roi_explore.recompute_change(run, 5, 3)
    roi_explore.write_json(run / 'result.json', {'manifests': [{}], 'comparable': False, 'change': None})
    with pytest.raises(ValueError, match='comparable'):
        roi_explore.recompute_change(run, 5, 3)


def test_prune_change_cache_keeps_default_and_newest(tmp_path):
    import os
    from pipeline import roi_explore
    base = tmp_path / 'cambio'
    names = ['ml5_u3', 'ml2_u1.5', 'ml2_u2', 'ml10_u3', 'ml2_u3', 'ml10_u6']
    for i, name in enumerate(names):
        (base / name).mkdir(parents=True)
        os.utime(base / name, (1000 + i, 1000 + i))
    os.utime(base / 'ml5_u3', (1, 1))                                     # la más antigua, pero es la de defecto
    roi_explore.prune_change_cache(base, keep=3)
    assert sorted(d.name for d in base.iterdir()) == sorted(['ml5_u3', 'ml10_u6', 'ml2_u3', 'ml10_u3'])
