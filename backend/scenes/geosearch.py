"""Explicit Nominatim lookups; no autocomplete or client-side provider calls."""
import hashlib
import json
import time
import re
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "TerraPulseAI/1.0 (https://github.com/sarabiapillo/Space-app-SARS/issues)"
CACHE_SECONDS = 24 * 60 * 60


def _rate_limit():
    """A filesystem lock coordinates the public-provider limit across app workers."""
    import os
    path = Path(getattr(settings, "NOMINATIM_RATE_LIMIT_FILE",
                        Path(__file__).resolve().parents[2] / "data" / ".nominatim-rate-limit"))
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as state:
        state.seek(0, os.SEEK_END)
        if state.tell() == 0:
            state.write(b"0")
            state.flush()
        if os.name == "nt":
            import msvcrt
            while True:
                try:
                    state.seek(0)
                    msvcrt.locking(state.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.05)
            unlock = lambda: msvcrt.locking(state.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(state.fileno(), fcntl.LOCK_EX)
            unlock = lambda: fcntl.flock(state.fileno(), fcntl.LOCK_UN)
        try:
            state.seek(0)
            previous = state.read().decode("ascii").strip()
            wait = 1.05 - (time.time() - float(previous)) if previous else 0
            if wait > 0:
                time.sleep(wait)
            state.seek(0)
            state.truncate()
            state.write(str(time.time()).encode("ascii"))
            state.flush()
        finally:
            unlock()


def _validated_geometry(value):
    """Return a valid two-dimensional GeoJSON geometry in WGS 84, or None."""
    import math
    from shapely.geometry import shape, mapping

    if not isinstance(value, dict) or value.get("type") not in ("Point", "Polygon", "MultiPolygon"):
        return None
    if "crs" in value:
        return None
    try:
        coords = []
        coordinates = value.get("coordinates")
        if value["type"] == "Point":
            coords = [coordinates]
        else:
            polygons = [coordinates] if value["type"] == "Polygon" else coordinates
            if not isinstance(polygons, list) or not polygons:
                return None
            for polygon in polygons:
                if not isinstance(polygon, list) or not polygon:
                    return None
                for ring in polygon:
                    if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                        return None
                    coords.extend(ring)
        if not isinstance(coords, list) or not coords or len(coords) > 50000:
            return None
        for point in coords:
            if not isinstance(point, (list, tuple)) or len(point) != 2 or any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in point):
                return None
            if not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90:
                return None
        geom = shape(value)
        if geom.is_empty or not geom.is_valid:
            return None
        if geom.geom_type != "Point" and geom.area <= 0:
            return None
        return mapping(geom)
    except Exception:
        # Third-party geometry constructors may raise GEOS-specific exceptions too.
        return None


def nominatim_search(query):
    key = "terrapulse:nominatim:" + hashlib.sha256(query.casefold().encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    _rate_limit()
    params = urllib.parse.urlencode({"q": query, "format": "geojson", "polygon_geojson": 1,
                                     "addressdetails": 1, "limit": 8})
    request = urllib.request.Request(f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT,
                                     "Accept": "application/geo+json,application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
            features = payload.get("features", []) if isinstance(payload, dict) else []
            if not isinstance(features, list):
                features = []
    except Exception as exc:
        raise APIException("El servicio de búsqueda geográfica no está disponible.") from exc
    cache.set(key, features, CACHE_SECONDS)
    return features


def _normalized_name(value):
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", value))


def _primary_name(props):
    """Normalized primary place name: first display_name segment or address place key."""
    display_name = props.get("display_name", "")
    if isinstance(display_name, str):
        first = display_name.split(",", 1)[0].strip()
        if first:
            return _normalized_name(first)
    address = props.get("address", {}) if isinstance(props.get("address"), dict) else {}
    for key in ("city", "town", "village", "municipality"):
        value = address.get(key)
        if isinstance(value, str) and value.strip():
            return _normalized_name(value)
    return ""


def _address_primary_matches(props_a, props_b):
    """True when both items share a normalized city/town/village/municipality address value."""
    address_a = props_a.get("address", {}) if isinstance(props_a.get("address"), dict) else {}
    address_b = props_b.get("address", {}) if isinstance(props_b.get("address"), dict) else {}
    for key in ("city", "town", "village", "municipality"):
        value_a = address_a.get(key)
        value_b = address_b.get(key)
        if isinstance(value_a, str) and value_a.strip() and isinstance(value_b, str) and value_b.strip():
            if _normalized_name(value_a) == _normalized_name(value_b):
                return True
    return False


def _same_country(props_a, props_b):
    address_a = props_a.get("address", {}) if isinstance(props_a.get("address"), dict) else {}
    address_b = props_b.get("address", {}) if isinstance(props_b.get("address"), dict) else {}
    for key in ("country_code", "country"):
        value_a = address_a.get(key)
        value_b = address_b.get(key)
        if isinstance(value_a, str) and value_a.strip() and isinstance(value_b, str) and value_b.strip():
            return _normalized_name(value_a) == _normalized_name(value_b)
    return False


def _same_state_when_both(props_a, props_b):
    """Require state/region/province match only when both results provide it."""
    address_a = props_a.get("address", {}) if isinstance(props_a.get("address"), dict) else {}
    address_b = props_b.get("address", {}) if isinstance(props_b.get("address"), dict) else {}
    keys = ("state", "region", "province")
    values_a = {_normalized_name(address_a[key]) for key in keys
                if isinstance(address_a.get(key), str) and address_a[key].strip()}
    values_b = {_normalized_name(address_b[key]) for key in keys
                if isinstance(address_b.get(key), str) and address_b[key].strip()}
    if values_a and values_b:
        return bool(values_a & values_b)
    return True


def _osm_identity(props):
    osm_id = props.get("osm_id")
    osm_type = props.get("osm_type")
    if osm_type not in (None, "") and osm_id not in (None, ""):
        return (osm_type, str(osm_id))
    return None


def _same_place(boundary_props, boundary_geometry, point_props, point_geometry):
    """Same-place rule: identity match, or name+country+state match with point covered by boundary."""
    from shapely.geometry import shape

    # (a) exact OpenStreetMap identity (avoid stringifying None as 'None').
    boundary_identity = _osm_identity(boundary_props)
    point_identity = _osm_identity(point_props)
    if boundary_identity is not None and boundary_identity == point_identity:
        return True

    # (b) normalized name, country, optional state, and geographic coverage.
    if not _same_country(boundary_props, point_props):
        return False
    if not _same_state_when_both(boundary_props, point_props):
        return False
    primary_a = _primary_name(boundary_props)
    primary_b = _primary_name(point_props)
    if not primary_a or not primary_b:
        return False
    name_match = primary_a == primary_b or _address_primary_matches(boundary_props, point_props)
    if not name_match:
        return False
    return shape(boundary_geometry).covers(shape(point_geometry))


def _deduplicate(results):
    """Drop a point only when the polygon is demonstrably the same named place."""
    retained = []
    dropped = set()
    for index, item in enumerate(results):
        props = item["_properties"]
        point = item["geometry"]["type"] == "Point"
        duplicate = False
        if point:
            for candidate_index, candidate in enumerate(results):
                if candidate_index == index:
                    continue
                other = candidate.get("_properties")
                if not isinstance(other, dict):
                    continue
                if (candidate["geometry"]["type"] not in ("Polygon", "MultiPolygon") or
                        other.get("category") != "boundary" or other.get("type") != "administrative"):
                    continue
                if _same_place(other, candidate["geometry"], props, item["geometry"]):
                    duplicate = True
                    break
        if duplicate:
            dropped.add(index)
    for index, item in enumerate(results):
        if index not in dropped:
            item.pop("_properties", None)
            retained.append(item)
    return retained


class LocationSearch(APIView):
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if not query or len(query) > 200:
            raise ValidationError({"detail": "q es obligatorio y debe tener hasta 200 caracteres."})
        features = nominatim_search(query)
        results = []
        for feature in features:
            if not isinstance(feature, dict):
                continue
            geometry = _validated_geometry(feature.get("geometry"))
            if geometry is None:
                continue
            props = feature.get("properties")
            if not isinstance(props, dict):
                continue
            name = props.get("display_name")
            if not isinstance(name, str) or not name.strip() or len(name) > 1000:
                continue
            raw_address = props.get("address", {})
            if not isinstance(raw_address, dict):
                continue
            address = {key: value for key, value in raw_address.items()
                       if isinstance(key, str) and isinstance(value, str) and len(key) <= 100 and len(value) <= 300}
            place_id = props.get("place_id")
            if isinstance(place_id, bool) or not isinstance(place_id, (str, int)):
                place_id = None
            safe_props = {key: (value.strip() if isinstance(value, str) else None)
                          for key in ("category", "type")
                          for value in [props.get(key)]
                          if value is None or isinstance(value, str)}
            results.append({"place_id": place_id, "name": name.strip(),
                            "category": safe_props.get("category"), "type": safe_props.get("type"),
                            "address": address, "geometry": geometry,
                            "selectable_roi": geometry.get("type") in ("Polygon", "MultiPolygon"),
                            "_properties": props})
        results = _deduplicate(results)
        return Response({"results": results, "attribution": "© OpenStreetMap contributors",
                         "license": "ODbL 1.0"})


class LocationRoi(APIView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        query, place_id = data.get("query"), data.get("place_id")
        radius = data.get("radius_km", 5)
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise ValidationError({"query": "Se requiere la consulta de búsqueda original."})
        if isinstance(radius, bool) or not isinstance(radius, (int, float)) or not 1 <= radius <= 15:
            raise ValidationError({"radius_km": "El radio debe estar entre 1 y 15 km."})
        features = nominatim_search(query.strip())
        match = next((feature for feature in features if isinstance(feature, dict)
                      and isinstance(feature.get("properties"), dict)
                      and str(feature["properties"].get("place_id")) == str(place_id)), None)
        if match is None:
            raise ValidationError({"place_id": "La selección no pertenece a esta búsqueda."})

        from pyproj import Geod
        from shapely.geometry import Polygon, mapping, shape
        from pipeline.roi_explore import validate_roi

        raw = _validated_geometry(match.get("geometry"))
        if raw is None:
            raise ValidationError({"geometry": "La geometría del proveedor no es válida."})
        original = shape(raw)
        is_point = original.geom_type == "Point"
        if not is_point:
            west, south, east, north = original.bounds
            if east - west > 180:
                raise ValidationError({"geometry": "Geometría que cruza el antimeridiano no admitida por ASF."})
            polygons = list(original.geoms) if original.geom_type == "MultiPolygon" else [original]
            if any(abs(y) >= 85 for polygon in polygons for ring in [polygon.exterior, *polygon.interiors]
                   for x, y in ring.coords):
                raise ValidationError({"geometry": "Geometría polar no admitida por los límites de análisis."})
        elif abs(original.y) >= 85:
            raise ValidationError({"geometry": "Ubicación polar no admitida por los límites de análisis."})

        def admin_fits_in_radius(geometry, radius_km):
            """Full geodesic containment: local azimuthal-equidistant ±radius_km box and <=0.6° axes."""
            from pyproj import Transformer

            west, south, east, north = geometry.bounds
            if east - west > 0.6 or north - south > 0.6:
                return False
            rep = geometry.representative_point()
            proj = f"+proj=aeqd +lat_0={rep.y} +lon_0={rep.x} +datum=WGS84 +units=m +no_defs"
            transformer = Transformer.from_crs("EPSG:4326", proj, always_xy=True)
            limit_m = radius_km * 1000
            polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
            for polygon in polygons:
                for ring in [polygon.exterior, *polygon.interiors]:
                    for x, y in ring.coords:
                        tx, ty = transformer.transform(x, y)
                        if abs(tx) > limit_m or abs(ty) > limit_m:
                            return False
            return True

        geod = Geod(ellps="WGS84")
        applied_radius = float(radius)
        generation = "point_geodesic_square"
        if is_point:
            center = original
        else:
            if admin_fits_in_radius(original, float(radius)):
                # Preserve the provider's administrative geometry exactly.
                center = original.representative_point()
                generation = "administrative_original"
                try:
                    validate_roi(raw)
                except ValueError as exc:
                    raise ValidationError({"geometry": str(exc)}) from exc
                return Response({"geometry": raw, "original_geometry": raw,
                    "metadata": {"name": str(match["properties"].get("display_name", "")).strip(),
                        "center": [center.x, center.y], "radius_km": float(radius),
                        "applied_radius_km": float(radius), "source": "nominatim", "generation": generation}})
            center = original.representative_point()
            generation = "administrative_rectangle"

        def rectangle(lon, lat, radius_km):
            distance = radius_km * 1000
            west_lon, _, _ = geod.fwd(lon, lat, 270, distance)
            east_lon, _, _ = geod.fwd(lon, lat, 90, distance)
            _, south_lat, _ = geod.fwd(lon, lat, 180, distance)
            _, north_lat, _ = geod.fwd(lon, lat, 0, distance)
            # A single ordinary GeoJSON polygon cannot safely encode an antimeridian wrap.
            if east_lon - west_lon < 0 or east_lon - west_lon > 180:
                raise ValidationError({"geometry": "La ROI cruza el antimeridiano; ASF y el recorte C1 reciben una sola geometría."})
            return Polygon([(west_lon, south_lat), (east_lon, south_lat),
                            (east_lon, north_lat), (west_lon, north_lat), (west_lon, south_lat)])

        from shapely.geometry import Point
        lon, lat = center.x, center.y

        def largest_rectangle_at(x, y):
            low, high = 0.0, float(radius)
            for _ in range(40):
                trial = (low + high) / 2
                try:
                    candidate = rectangle(x, y, trial)
                except ValidationError:
                    high = trial
                    continue
                west, south, east, north = candidate.bounds
                if east - west <= 0.6 and north - south <= 0.6 and (is_point or original.covers(candidate)):
                    low = trial
                else:
                    high = trial
            if low <= 0:
                return None
            return rectangle(x, y, low), low

        best = largest_rectangle_at(lon, lat)
        if not is_point:
            # A representative point is only a starting candidate: even when it works,
            # a nearby center may yield a much larger contained rectangle.
            west, south, east, north = original.bounds
            for iy in range(17):
                y = south + (north - south) * iy / 16
                for ix in range(17):
                    x = west + (east - west) * ix / 16
                    if not original.covers(Point(x, y)):
                        continue
                    candidate = largest_rectangle_at(x, y)
                    if candidate and (best is None or candidate[1] > best[1] + 1e-9 or
                                      (abs(candidate[1] - best[1]) <= 1e-9 and
                                       (x-lon)**2 + (y-lat)**2 < (best[0].centroid.x-lon)**2 + (best[0].centroid.y-lat)**2)):
                        best = candidate
        if best is None:
            raise ValidationError({"geometry": "No se pudo generar una ROI rectangular dentro del límite administrativo; dibuja manualmente la región."})
        candidate, applied_radius = best
        if not is_point:
            lon, lat = candidate.centroid.x, candidate.centroid.y
        geometry = mapping(candidate)
        try:
            validate_roi(geometry)
        except ValueError as exc:
            raise ValidationError({"geometry": str(exc)}) from exc
        return Response({"geometry": geometry, "original_geometry": None if is_point else raw,
            "metadata": {"name": str(match["properties"].get("display_name", "")).strip(),
                "center": [lon, lat], "radius_km": float(radius), "applied_radius_km": applied_radius,
                "source": "nominatim", "generation": generation}})
