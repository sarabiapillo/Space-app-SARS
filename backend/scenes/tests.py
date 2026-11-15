"""Pruebas de load_explore con salidas de etapa1 SINTÉTICAS (no son datos reales)."""
import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from scenes.management.commands.load_explore import parse_time, polygon_2d
from scenes.models import ROI, Scene, SceneChart, SceneInspection

GRANULE = "SYNTH_GCOV_T62_F10_20260618"
ROI_WKT = "POLYGON((-93.3919 16.6539,-92.8757 16.6539,-92.8757 16.8964,-93.3919 16.8964,-93.3919 16.6539))"


def write_explore(base: Path, code="abc1234", madurez="PROVISIONAL", charts=True, chart_code=None, granule=GRANULE):
    d = base / granule
    d.mkdir(parents=True, exist_ok=True)
    meta = {
        "creado_utc": "2026-11-15T07:00:00+00:00",
        "version_codigo": code,
        "procedencia": {"modo": "remoto", "url": "https://example.invalid/x.h5",
                        "catalogo_escena": {"madurez": madurez} if madurez else {}},
        "identificacion": {"granuleId": granule, "trackNumber": 62, "frameNumber": 10,
                           "orbitPassDirection": "Ascending", "compositeReleaseId": "P05023", "radarBand": "L",
                           "zeroDopplerStartTime": "2026-06-18T11:40:10.000000000",
                           "boundingPolygon": "POLYGON ((-93.5 16.5 100,-92.5 16.5 120,-92.5 17.0 90,"
                                              "-93.5 17.0 80,-93.5 16.5 100))"},
        "malla": {"producto": "GCOV", "frecuencia": "A", "polarizaciones": ["HH", "HV"], "epsg": 32615},
        "roi": {"wkt_4326": ROI_WKT, "pct_validos_en_poligono": 99.5},
        "estadisticas_roi": {"HHHH": {"gamma0": {"media_dB": -7.4}}},
        "advertencias": ["Una sola fecha"],
    }
    (d / "metadatos.json").write_text(json.dumps(meta), encoding="utf-8")
    if charts:
        g = {"version": "graficas-etapa1-1", "version_codigo": chart_code or code,
             "escena": {"granuleId": granule},
             "graficas": [{"id": "histograma_gamma0_dB", "series": [{"nombre": "HHHH", "conteos": [1, 2, 3]}]},
                          {"id": "mascara_roi", "series": [{"valores": [99.0, 1.0]}]},
                          {"id": "incidencia_por_altura", "x": [0.0, 500.0], "series": [{"valores": [43.8, 43.9]}]}]}
        (d / "graficas.json").write_text(json.dumps(g), encoding="utf-8")
    return d


class LoadExploreTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def load(self, *ids, **kw):
        call_command("load_explore", *ids, "--dir", str(self.base), stdout=StringIO(), **kw)

    def test_saves_scene_inspection_and_charts(self):
        write_explore(self.base)
        self.load(GRANULE)
        s = Scene.objects.get(name=GRANULE)
        self.assertEqual((s.track, s.frame, s.direction, s.crid, s.maturity), (62, 10, "ASCENDING", "P05023", "PROVISIONAL"))
        self.assertEqual(s.polarization, "HH+HV")
        self.assertEqual(s.start_time.isoformat(), "2026-06-18T11:40:10+00:00")
        self.assertFalse(s.footprint.hasz)
        insp = SceneInspection.objects.get(scene=s)
        self.assertEqual(insp.code_version, "abc1234")
        self.assertEqual(insp.roi_stats["HHHH"]["gamma0"]["media_dB"], -7.4)
        chart = SceneChart.objects.get(inspection=insp, chart_id="histograma_gamma0_dB")
        self.assertEqual(chart.data["series"][0]["conteos"], [1, 2, 3])     # se guarda tal cual
        self.assertTrue(chart.source_file.endswith("graficas.json"))
        self.assertEqual(ROI.objects.count(), 1)

    def test_reload_same_version_replaces(self):
        write_explore(self.base)
        self.load(GRANULE)
        self.load(GRANULE)
        self.assertEqual(SceneInspection.objects.count(), 1)
        self.assertEqual(SceneChart.objects.count(), 3)
        self.assertEqual(ROI.objects.count(), 1)

    def test_new_code_version_keeps_previous(self):
        write_explore(self.base, code="v1")
        self.load(GRANULE)
        write_explore(self.base, code="v2")
        self.load(GRANULE)
        self.assertEqual(Scene.objects.count(), 1)
        self.assertEqual(sorted(SceneInspection.objects.values_list("code_version", flat=True)), ["v1", "v2"])
        self.assertEqual(SceneChart.objects.count(), 6)

    def test_local_run_does_not_erase_known_maturity(self):
        write_explore(self.base)
        self.load(GRANULE)
        write_explore(self.base, code="local1", madurez=None)
        self.load(GRANULE)
        self.assertEqual(Scene.objects.get(name=GRANULE).maturity, "PROVISIONAL")

    def test_missing_charts_file_is_an_error(self):
        write_explore(self.base, charts=False)
        with self.assertRaisesMessage(CommandError, "graficas.json"):
            self.load(GRANULE)
        self.assertEqual(Scene.objects.count(), 0)

    def test_charts_from_another_run_are_rejected(self):
        write_explore(self.base, code="v2", chart_code="v1")
        with self.assertRaisesMessage(CommandError, "corridas distintas"):
            self.load(GRANULE)
        self.assertEqual(Scene.objects.count(), 0)              # transacción: no queda nada a medias

    def test_load_all(self):
        write_explore(self.base, granule="A_SCENE")
        write_explore(self.base, granule="B_SCENE")
        self.load(todas=True)
        self.assertEqual(Scene.objects.count(), 2)


class HelpersTests(TestCase):
    def test_parse_time_nanoseconds(self):
        self.assertEqual(parse_time("2026-10-16T11:40:06.123456789").microsecond, 123456)

    def test_polygon_2d_drops_height(self):
        p = polygon_2d("POLYGON ((0 0 5,1 0 5,1 1 5,0 0 5))")
        self.assertFalse(p.hasz)
        self.assertEqual(p.srid, 4326)


class ApiTests(TestCase):
    """Endpoints de C4 sobre datos cargados con load_explore (sintéticos)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        write_explore(base, code="v1")
        call_command("load_explore", GRANULE, "--dir", str(base), stdout=StringIO())
        write_explore(base, code="v2")
        call_command("load_explore", GRANULE, "--dir", str(base), stdout=StringIO())
        # creado_utc igual en ambas: se fuerza que v2 sea la más reciente
        SceneInspection.objects.filter(code_version="v2").update(created_utc="2026-11-16T00:00:00Z")

    def tearDown(self):
        self.tmp.cleanup()

    def get(self, url, status=200):
        r = self.client.get(url, HTTP_ACCEPT="application/json")
        self.assertEqual(r.status_code, status, r.content[:300])
        self.assertIn("application/json", r["Content-Type"])
        return r.json()

    def test_rois(self):
        data = self.get("/api/rois")
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "chiapas")
        self.assertEqual(data[0]["srid"], 4326)
        self.assertEqual(data[0]["geometry"]["type"], "Polygon")

    def test_scene_list_and_filters(self):
        data = self.get("/api/scenes")
        self.assertEqual(len(data), 1)
        s = data[0]
        self.assertEqual(s["scene_id"], GRANULE)
        self.assertEqual(s["stackId"], "T62/F10")
        self.assertEqual(s["polarizations"], ["HH", "HV"])
        self.assertEqual((s["date"], s["epsg"], s["band"], s["maturity"]), ("2026-06-18", 32615, "L", "PROVISIONAL"))
        self.assertTrue(s["has_inspection"])
        roi_id = self.get("/api/rois")[0]["id"]
        self.assertEqual(len(self.get(f"/api/scenes?roi={roi_id}&track=62&maturity=provisional")), 1)
        self.assertEqual(len(self.get("/api/scenes?track=55")), 0)
        self.assertEqual(len(self.get("/api/scenes?maturity=BETA")), 0)
        self.get("/api/scenes?maturity=FOO", status=400)
        self.get("/api/scenes?roi=999", status=400)
        self.get("/api/scenes?track=x", status=400)

    def test_scene_detail(self):
        d = self.get(f"/api/scenes/{GRANULE}")
        self.assertEqual(d["footprint"]["type"], "Polygon")
        self.assertEqual([i["code_version"] for i in d["inspections"]], ["v2", "v1"])
        self.assertEqual(sorted(d["inspections"][0]["charts"]),
                         ["histograma_gamma0_dB", "incidencia_por_altura", "mascara_roi"])
        self.get("/api/scenes/NO_EXISTE", status=404)

    def test_charts_latest_and_by_version(self):
        d = self.get(f"/api/scenes/{GRANULE}/charts")
        self.assertEqual(d["inspection"]["code_version"], "v2")
        self.assertEqual(len(d["charts"]), 3)
        self.assertEqual(self.get(f"/api/scenes/{GRANULE}/charts?code_version=v1")["inspection"]["code_version"], "v1")
        self.get(f"/api/scenes/{GRANULE}/charts?code_version=zzz", status=404)

    def test_single_chart(self):
        d = self.get(f"/api/scenes/{GRANULE}/charts/histograma_gamma0_dB")
        self.assertEqual(d["code_version"], "v2")
        self.assertEqual(d["data"]["series"][0]["conteos"], [1, 2, 3])
        self.assertEqual(d["warnings"], ["Una sola fecha"])
        self.get(f"/api/scenes/{GRANULE}/charts/no_existe", status=404)

    def test_scene_without_inspection(self):
        Scene.objects.create(name="SIN_INSPECCION", product="GCOV", track=1, frame=1, direction="ASCENDING",
                             polarization="HH", frequency="A", crid="P05023", start_time="2026-06-18T00:00:00Z")
        self.assertFalse(next(s for s in self.get("/api/scenes") if s["scene_id"] == "SIN_INSPECCION")["has_inspection"])
        self.get("/api/scenes/SIN_INSPECCION/charts", status=404)

    def test_read_only(self):
        r = self.client.post("/api/scenes", {}, content_type="application/json")
        self.assertEqual(r.status_code, 405)
