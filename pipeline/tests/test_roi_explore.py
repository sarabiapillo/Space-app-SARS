import pytest
import time
from pathlib import Path

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
    from pipeline import roi_explore
    monkeypatch.setattr(roi_explore, 'COPY_ROOT', tmp_path / 'graficas-roi')
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
    repo_root = Path(__file__).resolve().parents[2]
    resolved_copy = copy.resolve()
    expected_copy = (resolved_copy.relative_to(repo_root).as_posix()
                     if resolved_copy.is_relative_to(repo_root) else resolved_copy.as_posix())
    assert result['copia_disco'] == expected_copy
    assert json.loads((copy / entry['granuleId'] / 'graficas.json').read_text(encoding='utf-8')) == entry['manifest']
    assert (copy / entry['granuleId'] / 'metadatos.json').is_file()
    summary = json.loads((copy / 'roi.json').read_text(encoding='utf-8'))
    assert summary['id'] == 'abc123' and summary['escenas'] == [entry['granuleId']]


def test_children_receive_selected_ids_and_results_keep_selection_order(tmp_path, monkeypatch):
    import json
    import subprocess
    from pipeline import roi_explore

    first, second = scene('2026-01-01'), scene('2026-02-01')
    launches, completion_order = [], []
    def save_result(index, item):
        (tmp_path / f'scene-result-{index}.json').write_text(json.dumps({
            'manifest': {'escena': {'granuleId': item.scene_id}}, 'charts': None, 'seconds': float(index)}))
    class Child:
        def __init__(self, args, **kwargs):
            self.args, self.returncode, self.polls = args, None, 0
            launches.append(args)
            if int(args[-1]) == 1:
                save_result(1, second)
                completion_order.append(1)
                self.returncode = 0
        def wait(self, timeout=None): return self.returncode
        def poll(self):
            self.polls += 1
            if int(self.args[-1]) == 0 and self.polls > 1:
                save_result(0, first)
                completion_order.append(0)
                self.returncode = 0
            return self.returncode
        def terminate(self): self.returncode = -15
        def kill(self): self.returncode = -9
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', Child)
    result = roi_explore._run_scene_children(tmp_path, [first, second], deadline=time.monotonic() + 10)
    assert [cmd[-2] for cmd in launches] == [first.scene_id, second.scene_id]
    assert completion_order == [1, 0]
    assert [row['manifest']['escena']['granuleId'] for row in result] == [first.scene_id, second.scene_id]


def test_child_failure_cleans_up_all_launched_processes(tmp_path, monkeypatch):
    import subprocess
    from pipeline import roi_explore
    children = []
    class Child:
        def __init__(self, args, **kwargs):
            self.args, self.returncode = args, 1 if not children else None
            children.append(self)
        def wait(self, timeout=None):
            return self.returncode
        def poll(self): return self.returncode
        def terminate(self): self.returncode = -15
        def kill(self): self.returncode = -9
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', Child)
    with pytest.raises(subprocess.CalledProcessError):
        roi_explore._run_scene_children(tmp_path, [scene('2026-01-01'), scene('2026-02-01')], deadline=time.monotonic() + 10)
    assert len(children) == 2
    assert all(child.returncode is not None for child in children)


def test_children_fail_fast_when_second_child_exits_while_first_is_running(tmp_path, monkeypatch):
    import subprocess
    from pipeline import roi_explore
    children = []
    class Child:
        def __init__(self, args, **kwargs):
            self.args, self.returncode = args, None
            children.append(self)
            if int(args[-1]) == 1:
                self.returncode = 9
        def poll(self): return self.returncode
        def wait(self, timeout=None):
            if self.returncode is None:
                raise AssertionError('Debe detectarse primero el fallo del segundo hijo sin esperar al primero')
            return self.returncode
        def terminate(self): self.returncode = -15
        def kill(self): self.returncode = -9
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', Child)
    with pytest.raises(subprocess.CalledProcessError):
        roi_explore._run_scene_children(tmp_path, [scene('2026-01-01'), scene('2026-02-01')], deadline=time.monotonic() + 10)
    assert len(children) == 2
    assert children[0].returncode is not None


def test_child_timeout_reaps_all_processes(tmp_path, monkeypatch):
    import subprocess
    from pipeline import roi_explore
    ticks = [0.0]
    def monotonic():
        ticks[0] += 0.5
        return ticks[0]
    monkeypatch.setattr(roi_explore.time, 'monotonic', monotonic)
    monkeypatch.setattr(roi_explore.time, 'sleep', lambda _: None)
    children = []
    class Child:
        def __init__(self, args, **kwargs):
            self.args, self.returncode, self.waits = args, None, 0
            children.append(self)
        def wait(self, timeout=None):
            self.waits += 1
            if self is children[0] and self.waits == 1:
                raise subprocess.TimeoutExpired(self.args, timeout)
            self.returncode = -15 if self.waits > 1 else 0
        def poll(self): return self.returncode
        def terminate(self): self.terminated = True
        def kill(self): self.returncode = -9
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', Child)
    with pytest.raises(subprocess.TimeoutExpired):
        roi_explore._run_scene_children(tmp_path, [scene('2026-01-01'), scene('2026-02-01')], deadline=3.0)
    assert len(children) == 2
    assert all(child.returncode is not None for child in children)


def test_delayed_search_expiring_budget_does_not_launch_children(tmp_path, monkeypatch):
    import json
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline import roi_explore, sources
    from pipeline.roi_explore import RoiPreparationError
    from pipeline.sources.base import SceneMeta

    first = scene('2026-01-01')
    second = scene('2026-02-01')
    ticks = [10.0]
    monkeypatch.setattr(roi_explore.time, 'monotonic', lambda: ticks[0])
    class Source:
        def search(self, roi, product):
            ticks[0] = 1511.0
            return [first, second]
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    monkeypatch.setattr(roi_explore, 'COPY_ROOT', tmp_path / 'charts')
    from pipeline import catalog
    monkeypatch.setattr(catalog, 'code_version', lambda: 'test-version')
    launches = []
    def unexpected_launch(*args, **kwargs):
        launches.append(args)
        raise AssertionError('No child may start after the total preparation deadline')
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', unexpected_launch)
    run = tmp_path / 'late-search'
    run.mkdir()
    roi_explore.write_json(run / 'request.json', {'roi': ROI})
    with pytest.raises(RoiPreparationError):
        roi_explore.prepare(run)
    assert launches == []


def test_pair_workers_process_exact_selected_local_scenes_with_extra_catalog_entry(tmp_path, monkeypatch):
    import json
    from dataclasses import replace
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline.tests.test_subset import make_gcov, scene as synthetic_scene, ROI as synthetic_roi
    from pipeline.tests.test_etapa1 import add_radar_grid
    from pipeline import sources, roi_explore

    selected = []
    for granule, date in (('LOCAL_OLD', '2026-01-01T00:00:00Z'), ('LOCAL_NEW', '2026-02-01T00:00:00Z')):
        h5, _ = make_gcov(tmp_path / f'{granule}.h5', granule=granule)
        add_radar_grid(h5)
        base = synthetic_scene(granule)
        selected.append(replace(base, start_time=date, extra={'local_h5': str(h5)}))
    unselected_h5, _ = make_gcov(tmp_path / 'unselected.h5', granule='LOCAL_UNSELECTED')
    add_radar_grid(unselected_h5)
    unselected = replace(selected[1], scene_id='LOCAL_UNSELECTED', start_time='2026-03-01T00:00:00Z',
                         crid='P2', extra={'local_h5': str(unselected_h5)})
    class Source:
        def search(self, roi, product):
            assert product == 'GCOV'
            assert wkt.loads(roi).equals(wkt.loads(synthetic_roi))
            return [unselected, *selected]
    monkeypatch.setattr(sources, 'get_source', lambda _: Source())
    monkeypatch.setattr(roi_explore, 'COPY_ROOT', tmp_path / 'chart-copy')
    run = tmp_path / 'pair-run'
    run.mkdir()
    roi_explore.write_json(run / 'request.json', {'roi': mapping(wkt.loads(synthetic_roi))})

    roi_explore.prepare(run)
    result = json.loads((run / 'result.json').read_text())
    ids = [manifest['escena']['granuleId'] for manifest in result['manifests']]
    assert ids == ['LOCAL_OLD', 'LOCAL_NEW']
    assert result['comparable'] is True
    assert all(any(layer['pct_pixeles_validos'] > 0 for layer in manifest['capas'])
               for manifest in result['manifests'])
    assert [row['granuleId'] for row in result['charts']] == ids
    assert len(result['timings']['scene_processing_seconds']) == 2
    for scene_id in ids:
        scene_dir = run / 'layers' / scene_id
        assert (scene_dir / 'web' / 'capas.json').is_file()
        assert list((scene_dir / 'web').glob('*.tif'))
        assert list((scene_dir / 'web').glob('*.png'))
        assert (scene_dir / 'graficas.json').is_file()
        assert json.loads((scene_dir / 'metadatos.json').read_text())['identificacion']['granuleId'] == scene_id
    assert not (run / 'layers' / 'LOCAL_UNSELECTED').exists()

    # Mapa de cambio t2 − t1 sobre la misma ROI dibujada (comparable → se calcula).
    change = result['change']
    assert change['tipo'] == 'mapa_de_cambio'
    assert change['t1'] == ids[0] and change['t2'] == ids[1]
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


def test_worker_process_reads_local_h5_without_parent_mocks(tmp_path):
    import json
    import subprocess
    import sys
    from pathlib import Path
    import yaml
    from pipeline.tests.test_subset import make_gcov, scene as synthetic_scene, ROI as synthetic_roi
    from pipeline.tests.test_etapa1 import add_radar_grid
    from pipeline.roi_explore import write_json

    h5, _ = make_gcov(tmp_path / 'fixture.h5', granule='LOCAL_CHILD_SCENE')
    add_radar_grid(h5)
    base = synthetic_scene('LOCAL_CHILD_SCENE')
    selected = base.__class__(**{**base.to_dict(), 'extra': {'local_h5': str(h5)}})
    run = tmp_path / 'run'
    (run / 'layers').mkdir(parents=True)
    write_json(run / 'catalog.json', {'scenes': [selected.to_dict()]})
    (run / 'config.yaml').write_text(yaml.safe_dump({'roi': {'wkt': synthetic_roi}}))
    child = subprocess.run([sys.executable, '-m', 'pipeline.roi_explore', '--scene-worker', str(run),
                            selected.scene_id, '0'], cwd=Path(__file__).resolve().parents[2],
                           capture_output=True, text=True, timeout=120, check=False)
    assert child.returncode == 0, child.stderr
    result = json.loads((run / 'scene-result-0.json').read_text())
    assert result['manifest']['escena']['granuleId'] == selected.scene_id
    assert (run / 'layers' / selected.scene_id / 'web' / 'capas.json').is_file()


def test_child_failure_waits_for_both_children(tmp_path, monkeypatch):
    import subprocess
    from pipeline import roi_explore

    observed = {'terminated': [], 'waited': []}
    class Child:
        def __init__(self, args): self.args, self.index = args, int(args[-1])
        def poll(self): return None if self.index == 0 else 7
        def terminate(self): observed['terminated'].append(self.index)
        def wait(self, timeout=None): observed['waited'].append(self.index); return 0
    monkeypatch.setattr(roi_explore.subprocess, 'Popen', lambda args, **kwargs: Child(args))
    with pytest.raises(subprocess.CalledProcessError):
        roi_explore._run_scene_children(tmp_path, [scene('2026-01-01'), scene('2026-02-01')],
                                        time.monotonic() + 10)
    assert observed['terminated'] == [0]
    assert observed['waited'] == [0, 1]


def test_slow_search_expiring_deadline_launches_no_scene_children(tmp_path, monkeypatch):
    from shapely import wkt
    from shapely.geometry import mapping
    from pipeline import roi_explore, sources, catalog
    from pipeline.tests.test_subset import ROI as synthetic_roi

    monkeypatch.setattr(catalog, 'code_version', lambda: 'test')
    tick = {'value': 0}
    monkeypatch.setattr(roi_explore.time, 'monotonic', lambda: tick['value'])
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
    os.utime(base / 'ml5_u3', (1, 1))
    roi_explore.prune_change_cache(base, keep=3)
    assert sorted(d.name for d in base.iterdir()) == sorted(['ml5_u3', 'ml10_u6', 'ml2_u3', 'ml10_u3'])
