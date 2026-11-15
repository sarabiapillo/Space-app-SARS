"""Distribución de calados del simulador de inundación con un DEM SINTÉTICO (sin red ni NASADEM)."""
from types import SimpleNamespace
from unittest import mock

import numpy as np
from django.test import SimpleTestCase

from analyses import simulate

ROI = {"type": "Polygon", "coordinates": [[[-93.1, 16.7], [-93.09, 16.7], [-93.09, 16.71], [-93.1, 16.71], [-93.1, 16.7]]]}


class FloodChartsTests(SimpleTestCase):
    def run_sim(self, elevation):
        dem = SimpleNamespace(elevation=elevation)
        with mock.patch.object(simulate, "acquire_provider_tile_paths", return_value=[]), \
                mock.patch.object(simulate, "prepare_dem", return_value=dem), \
                mock.patch.object(simulate, "NASADEMProvider"):
            return simulate.compute_topographic_flood(ROI, rainfall_mm=80, duration_hours=6, cache_dir=None)

    def test_depth_classes_cover_all_wet_cells(self):
        yy, xx = np.mgrid[0:30, 0:30]
        elevation = (np.hypot(yy - 15, xx - 15) * 1.5 + 500).astype(np.float32)   # cuenco
        out = self.run_sim(elevation)
        classes = out["charts"]["depth_classes"]
        self.assertEqual([c["desde_m"] for c in classes], [0.03, 0.10, 0.30, 0.80, 1.50])
        self.assertIsNone(classes[-1]["hasta_m"])
        wet_area = sum(c["area_km2"] for c in classes)
        self.assertAlmostEqual(wet_area, out["stats"]["floodedAreaKm2"], places=2)
        if out["stats"]["floodedAreaKm2"] > 0:
            self.assertAlmostEqual(sum(c["pct_mojado"] for c in classes), 100.0, places=0)
        self.assertEqual(out["charts"]["cell_size_m"], 30.0)
