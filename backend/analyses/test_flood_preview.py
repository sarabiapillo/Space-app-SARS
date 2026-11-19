"""Contrato público de preview ROI; fixtures locales, sin red ni solver."""
import hashlib
import io
import json
from pathlib import Path
import shutil
from types import SimpleNamespace
import uuid

from django.test import SimpleTestCase, override_settings
from PIL import Image
import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rest_framework.test import APIClient

PROOF = Path(__file__).resolve().parents[2] / 'data/test-runs/roi-dg2-136934da-7370-4113-b337-36ebc0bcafcc/6c5b38f4-9d14-4c71-912b-04ed7629d94a'


class RoiPreviewTests(SimpleTestCase):
    def setUp(self):
        self.jobs = Path(__file__).resolve().parents[2] / 'data/test-runs' / f'roi-preview-{uuid.uuid4()}'
        self.addCleanup(shutil.rmtree, self.jobs)
        self.jobs.mkdir(parents=True)
        self.settings_patch = override_settings(FLOOD_ROI_DG2_RUN_ROOT=str(self.jobs))
        self.settings_patch.enable()
        self.addCleanup(self.settings_patch.disable)
        self.alice = APIClient()
        self.alice.force_authenticate(user=SimpleNamespace(pk=1, is_authenticated=True))
        self.bob = APIClient()
        self.bob.force_authenticate(user=SimpleNamespace(pk=2, is_authenticated=True))
        self.anon = APIClient()
        self.run_id = str(uuid.uuid4())
        self.directory = self.jobs / self.run_id
        (self.directory / 'cogs').mkdir(parents=True)
        self.state = json.loads((PROOF / 'state.json').read_text())
        self.state['id'] = self.run_id
        self.state['owner'] = '1'
        for item in self.state['artifacts']:
            shutil.copyfile(PROOF / item['file'], self.directory / item['file'])
        self.name = Path(self.state['artifacts'][0]['file']).name
        self.path = self.directory / 'cogs' / self.name
        self.url = f'/api/flood-roi-runs/{self.run_id}/artifacts/{self.name}/preview/'
        self.download = self.url.removesuffix('preview/')
        self.save()
        self.assertEqual(self.alice.get(f'/api/flood-roi-runs/{self.run_id}/').status_code, 200)

    def save(self):
        (self.directory / 'state.json').write_text(json.dumps(self.state))

    def test_rgba_reprojection_headers_palette_and_original_download(self):
        with rasterio.open(self.path) as src:
            profile = src.profile.copy()
            bounds = src.bounds
        values = np.full((profile['height'], profile['width']), 1.0, dtype='float32')
        values[0, 0] = -9999
        values[0, 1] = 0
        values[0, 2] = 0.02
        values[0, 3] = 3.5
        values[1, :4] = [.1, .3, .7, 1.5]
        with rasterio.open(self.path, 'w', **profile) as dst:
            dst.write(values, 1)
        raw = self.path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        self.state['artifacts'][0]['sha256'] = digest
        self.save()
        response = self.alice.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/png')
        self.assertEqual(response['X-Preview-CRS'], 'EPSG:3857')
        self.assertEqual(response['X-Preview-Units'], 'm')
        self.assertEqual(response['X-Preview-Classes'], '0.03,0.15,0.5,1,2')
        self.assertNotIn('X-Preview-Value-Range', response)
        self.assertEqual(response['Cache-Control'], 'private, max-age=3600')
        self.assertTrue(response['ETag'].startswith('"') and response['ETag'].endswith('"'))
        geographic = tuple(map(float, response['X-Preview-Bounds'].split(',')))
        expected = transform_bounds('EPSG:32615', 'EPSG:4326', *bounds)
        for actual, reference in zip(geographic, expected):
            self.assertAlmostEqual(actual, reference, places=3)
        image = Image.open(io.BytesIO(response.content))
        self.assertEqual(image.mode, 'RGBA')
        self.assertEqual(image.getpixel((0, 0))[3], 0)  # nodata
        self.assertEqual(image.getpixel((1, 0))[3], 0)  # seco válido
        self.assertEqual(image.getpixel((2, 0))[3], 0)  # 0.02 m
        self.assertEqual(image.getpixel((3, 0))[3], 255)  # saturado
        self.assertGreater(image.width, 0)
        self.assertGreater(image.height, 0)
        pixels = list(image.getdata())
        self.assertIn(0, [pixel[3] for pixel in pixels])
        self.assertTrue(any(pixel[3] == 255 for pixel in pixels))
        # One sequential blue per depth class: 0.03-0.15, 0.15-0.5, 0.5-1, 1-2 and >= 2 m.
        colours = {pixel[:3] for pixel in pixels if pixel[3] == 255}
        self.assertEqual(colours, {(198, 219, 239), (107, 174, 214), (33, 113, 181), (8, 81, 156), (8, 48, 107)})
        self.assertNotEqual(self.alice.get(self.url)['ETag'], '"' + digest + '"')
        download = self.alice.get(self.download)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download['Content-Type'], 'image/tiff')
        self.assertEqual(download['Content-Length'], str(len(raw)))
        self.assertEqual(download['ETag'], '"' + digest + '"')
        self.assertEqual(b''.join(download.streaming_content), raw)

    def test_declared_but_malformed_raster_returns_bounded_error(self):
        self.path.write_bytes(b'not a raster')
        self.state['artifacts'][0]['sha256'] = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.save()
        response = self.alice.get(self.url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {'errors': {'preview': ['Raster inválido para vista previa.']}})
        self.assertNotIn(str(self.jobs), str(response.content))

    def test_authorization_integrity_and_invalid_artifacts(self):
        self.assertIn(self.anon.get(self.url).status_code, (401, 403))
        self.assertEqual(self.bob.get(self.url).status_code, 404)
        self.assertEqual(self.alice.get(self.url.replace(self.name, 'not-listed.tif')).status_code, 404)
        self.assertEqual(self.alice.get(self.url.replace(self.name, 'state.json')).status_code, 404)
        self.assertEqual(self.alice.get(self.url).status_code, 200)
        self.path.write_bytes(b'tamper')
        self.assertEqual(self.alice.get(self.url).status_code, 404)
        self.path.unlink()
        self.path.symlink_to(PROOF / self.state['artifacts'][0]['file'])
        self.assertEqual(self.alice.get(self.url).status_code, 404)
        self.path.unlink()
        self.state['state'] = 'failed'
        self.save()
        self.assertEqual(self.alice.get(self.url).status_code, 404)
