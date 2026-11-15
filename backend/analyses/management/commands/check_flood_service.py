"""Diagnóstico privado; Earthdata es opt-in, con una sola tesela nueva."""
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import signal
import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from pipeline.elevation.nasadem import NASADEMProvider, validate_hgt_zip, SHORT_NAME, VERSION
from pipeline.hydrology.roi_runner import validate_config

PROJECT = Path(__file__).resolve().parents[4]
TILE = 'n16w094'
BBOX = (-93.1, 16.8, -93.099, 16.801)
MAX_ZIP = 64 * 1024 * 1024


def _private_parent(path):
    """Inspección sin escrituras: no admitir enlaces ni componentes privados públicos."""
    if not path.is_relative_to(PROJECT / 'data'):
        raise ValueError('root fuera de data')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('enlace en root')
    for part in (path, *path.parents):
        if part.exists():
            if not part.is_dir():
                raise ValueError('root no es directorio')
            if part.is_relative_to(PROJECT / 'data') and part != PROJECT / 'data' and part.stat().st_mode & 0o077:
                raise ValueError('root no es privado')
            if not os.access(part, os.W_OK | os.X_OK):
                raise ValueError('root inaccesible')
            return
    raise ValueError('root inaccesible')


def _acquire_child(path, conn):
    # El proceso aislado absorbe todas las salidas y errores de bibliotecas externas.
    os.setsid()
    os.umask(0o077)
    fd = os.open(os.devnull, os.O_WRONLY)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    os.close(fd)
    authenticated = [False]
    try:
        import earthaccess

        class EnvironmentOnly(NASADEMProvider):
            @staticmethod
            def _authenticate_noninteractive():
                auth = earthaccess.login(strategy='environment', persist=False)
                if auth is None or not getattr(auth, 'authenticated', False):
                    raise RuntimeError('authentication_failed')
                authenticated[0] = True

        # Cada comprobación emplea UUID nuevo: nunca aceptar una copia en caché anterior.
        path.mkdir(mode=0o700, parents=True, exist_ok=False)
        records = EnvironmentOnly(path / 'cache').acquire_roi(BBOX)
        if len(records) != 1 or records[0].tile_id != TILE or records[0].granule_ur != 'NASADEM_HGT_' + TILE or records[0].short_name != SHORT_NAME or records[0].version != VERSION:
            raise ValueError('identidad inesperada')
        archive = records[0].path
        size = archive.stat().st_size
        if not 0 < size <= MAX_ZIP:
            raise ValueError('tamaño inesperado')
        hgt_sha = validate_hgt_zip(archive)
        with archive.open('rb') as stream:
            zip_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
        receipt = path / 'cache' / f'.{TILE}.cmr.json'
        if json.loads(receipt.read_text(encoding='utf-8')) != NASADEMProvider._receipt_record(TILE, hgt_sha):
            raise ValueError('recibo inválido')
        proof = {'tile': TILE, 'collection': SHORT_NAME, 'version': VERSION,
                 'granule_ur': records[0].granule_ur, 'hgt_sha256': hgt_sha,
                 'zip_sha256': zip_sha, 'zip_bytes': size, 'downloaded': True,
                 'evidence': str(path.relative_to(PROJECT) / 'proof.json')}
        (path / 'proof.json').write_text(json.dumps(proof, sort_keys=True), encoding='utf-8')
        conn.send(proof)
    except Exception:
        conn.send({'reason': 'acquisition_failed' if authenticated[0] else 'authentication_failed'})
    finally:
        conn.close()


class Command(BaseCommand):
    help = 'Inspecciona DG2 localmente sin red ni escritura; --earthdata adquiere una tesela NASADEM nueva (máximo 120 s).'

    def add_arguments(self, parser):
        parser.add_argument('--earthdata', action='store_true', help='Autenticación solo por entorno y descarga real de una tesela; crea evidencia privada.')
        parser.add_argument('--timeout-s', type=int, default=120, help='Plazo de la adquisición, 1..120 segundos (solo con --earthdata).')

    def handle(self, *args, **options):
        def fail(reason):
            self.stdout.write(json.dumps({'ready': False, 'reason': reason}))
            raise CommandError(reason)

        if options['timeout_s'] < 1 or options['timeout_s'] > 120 or (not options['earthdata'] and options['timeout_s'] != 120):
            fail('configuration_invalid')
        config = getattr(settings, 'FLOOD_ROI_DG2_CONFIG', None)
        if not config:
            fail('configuration_invalid')
        if options['earthdata'] and not (os.environ.get('EARTHDATA_TOKEN') or
                (os.environ.get('EARTHDATA_USERNAME') and os.environ.get('EARTHDATA_PASSWORD'))):
            fail('missing_environment_credentials')
        try:
            validate_config(config)
            root = Path(settings.FLOOD_ROI_DG2_RUN_ROOT)
            _private_parent(root)
            _private_parent(PROJECT / 'data/service-checks')
        except (ValueError, OSError, TypeError, KeyError):
            fail('configuration_invalid')
        if not options['earthdata']:
            self.stdout.write(json.dumps({'ready': True, 'enabled': True, 'binary': 'verified',
                                          'helper': 'verified', 'root': 'writable_private',
                                          'earthdata': 'not_checked'}))
            return
        destination = PROJECT / 'data/service-checks' / str(uuid.uuid4())
        receiver, sender = multiprocessing.Pipe(duplex=False)
        child = multiprocessing.get_context('fork').Process(target=_acquire_child, args=(destination, sender))
        child.start()
        sender.close()
        child.join(options['timeout_s'])
        if child.is_alive():
            os.killpg(child.pid, signal.SIGKILL)
            child.join()
            receiver.close()
            fail('timeout')
        proof = receiver.recv() if receiver.poll() else {'reason': 'acquisition_failed'}
        receiver.close()
        if child.exitcode != 0 or 'reason' in proof:
            fail(proof.get('reason', 'acquisition_failed'))
        self.stdout.write(json.dumps({'ready': True, 'earthdata': proof}, sort_keys=True))
