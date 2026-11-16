"""Place-name typeahead via Photon; final administrative geometry still comes from Nominatim."""
import hashlib
import json
import urllib.parse
import urllib.request

from django.core.cache import cache
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .geosearch import USER_AGENT

PHOTON_URL = "https://photon.komoot.io/api/"
ALLOWED_PLACES = {"city", "town", "village", "municipality", "country"}


class SuggestionsUnavailable(APIException):
    status_code = 503
    default_detail = "Las sugerencias no están disponibles; usa Buscar para consultar la ubicación."


class SuggestionsThrottled(APIException):
    status_code = 429
    default_detail = "Espera un momento antes de solicitar más sugerencias; Buscar sigue disponible."


class LocationSuggestions(APIView):
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if not 3 <= len(query) <= 200:
            raise ValidationError({"q": "Escribe entre 3 y 200 caracteres para recibir sugerencias."})
        key = "terrapulse:photon:" + hashlib.sha256(query.casefold().encode()).hexdigest()
        suggestions = cache.get(key)
        if suggestions is None:
            # Backstop across clients sharing this Django cache; cached queries are free.
            if not cache.add("terrapulse:photon:rate", 1, timeout=0.5):
                raise SuggestionsThrottled()
            params = urllib.parse.urlencode({"q": query, "lang": "es", "limit": 8})
            req = urllib.request.Request(f"{PHOTON_URL}?{params}", headers={"User-Agent": USER_AGENT,
                                                                          "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=5) as response:
                    body = response.read(131073)
                if len(body) > 131072:
                    raise ValueError("Provider response too large")
                payload = json.loads(body)
                features = payload.get("features", [])
                if not isinstance(features, list):
                    raise ValueError("Unexpected response")
            except (OSError, ValueError, TypeError, KeyError) as exc:
                raise SuggestionsUnavailable() from exc
            suggestions = []
            seen = set()
            for feature in features[:8]:
                props = feature.get("properties") if isinstance(feature, dict) else None
                if not isinstance(props, dict):
                    continue
                name = props.get("name")
                osm_value = props.get("osm_value")
                if not isinstance(name, str) or not name.strip() or len(name) > 200:
                    continue
                if osm_value not in ALLOWED_PLACES and not (props.get("osm_key") == "boundary" and osm_value == "administrative" and props.get("type") == "municipality"):
                    continue
                parts = [name.strip()]
                for field in ("state", "country"):
                    value = props.get(field)
                    if isinstance(value, str) and value.strip() and len(value) <= 200 and value.casefold() not in {part.casefold() for part in parts}:
                        parts.append(value.strip())
                full_name = ", ".join(parts)
                if full_name.casefold() in seen:
                    continue
                seen.add(full_name.casefold())
                suggestions.append({"name": parts[0], "query": full_name})
            cache.set(key, suggestions, 60 * 60)
        return Response({"suggestions": suggestions, "attribution": "© OpenStreetMap contributors · Photon"})
