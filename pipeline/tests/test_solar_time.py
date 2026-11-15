from datetime import datetime, timezone

import pytest

from pipeline.solar.time import resolve_solar_inputs


@pytest.mark.parametrize(
    "local,zone,utc,offset",
    [
        ("2026-01-15T12:34:56", "America/Mexico_City", "2026-01-15T18:34:56+00:00", "-06:00"),
        ("2026-07-15T12:34:56", "America/Mexico_City", "2026-07-15T18:34:56+00:00", "-06:00"),
        ("2026-01-15T12:34:56", "Asia/Kathmandu", "2026-01-15T06:49:56+00:00", "+05:45"),
    ],
)
def test_local_datetime_resolves_to_unique_utc_and_offset(local, zone, utc, offset):
    result = resolve_solar_inputs(local, zone, altitude_m=100)
    assert result["datetime_utc"] == utc
    assert result["utc_offset"] == offset


def test_dst_ambiguous_and_nonexistent_local_times_are_rejected():
    with pytest.raises(ValueError, match="ambiguous"):
        resolve_solar_inputs("2024-11-03T01:30:00", "America/New_York", altitude_m=1)
    with pytest.raises(ValueError, match="nonexistent"):
        resolve_solar_inputs("2024-03-10T02:30:00", "America/New_York", altitude_m=1)


@pytest.mark.parametrize("local", ["2026-01-01T12:00", "2026-01-01T12:00:00Z", "2026-01-01T12:00:00+02:00", "not-a-date"])
def test_invalid_local_datetime_format_or_offset_is_rejected(local):
    with pytest.raises(ValueError, match="datetime_local"):
        resolve_solar_inputs(local, "UTC", altitude_m=0)


@pytest.mark.parametrize("zone", ["Not/A_Zone", "", "+03:00"])
def test_invalid_or_non_iana_timezone_is_rejected(zone):
    with pytest.raises(ValueError, match="timezone"):
        resolve_solar_inputs("2026-01-01T12:00:00", zone, altitude_m=0)


def test_default_temperature_and_pressure_are_recorded_with_provenance():
    result = resolve_solar_inputs("2026-01-01T12:00:00", "UTC", altitude_m=0)
    assert result["temperature_c"] == 12.0
    assert result["temperature_provenance"] == "default: 12 °C (assumption, not measurement)"
    assert result["pressure_hpa"] == pytest.approx(1013.25)
    assert result["pressure_provenance"] == "calculated: dry standard atmosphere from caller-provided altitude (NASADEM origin unverified)"
    assert result["altitude_m"] == 0.0


def test_explicit_temperature_and_pressure_are_preserved_with_provenance():
    result = resolve_solar_inputs("2026-01-01T12:00:00", "UTC", altitude_m=250, temperature_c=20.5, pressure_hpa=990)
    assert result["temperature_c"] == 20.5
    assert result["temperature_provenance"] == "input: caller-supplied °C"
    assert result["pressure_hpa"] == 990.0
    assert result["pressure_provenance"] == "input: caller-supplied hPa"


@pytest.mark.parametrize("altitude", [None, float("nan"), float("inf"), -float("inf"), "bad", "100", 50000])
def test_invalid_or_missing_representative_altitude_is_rejected(altitude):
    with pytest.raises(ValueError, match="altitude_m"):
        resolve_solar_inputs("2026-01-01T12:00:00", "UTC", altitude_m=altitude)


@pytest.mark.parametrize("temperature", [float("nan"), float("inf"), -273.15, -300, "bad", "12"])
def test_temperature_must_be_finite_and_above_absolute_zero(temperature):
    with pytest.raises(ValueError, match="temperature_c"):
        resolve_solar_inputs("2026-01-01T12:00:00", "UTC", altitude_m=0, temperature_c=temperature)


@pytest.mark.parametrize("pressure", [0, -1, float("nan"), float("inf"), "bad", "990"])
def test_pressure_must_be_finite_and_positive(pressure):
    with pytest.raises(ValueError, match="pressure_hpa"):
        resolve_solar_inputs("2026-01-01T12:00:00", "UTC", altitude_m=0, pressure_hpa=pressure)


def test_atmospheric_pressure_uses_dry_standard_atmosphere_equation():
    result = resolve_solar_inputs("2026-01-01T12:00:00", "UTC", altitude_m=1000)
    expected_pa = 101325 * (1 - 0.0065 * 1000 / 288.15) ** (9.80665 / (287.053 * 0.0065))
    assert result["pressure_hpa"] == pytest.approx(expected_pa / 100)


def test_invalid_result_parameters_do_not_mutate_inputs():
    local = "2026-01-01T12:00:00"
    result = resolve_solar_inputs(local, "UTC", altitude_m=10)
    assert result["datetime_local"] == local
    assert result["timezone"] == "UTC"
    assert isinstance(datetime.fromisoformat(result["datetime_utc"]), datetime)
    assert datetime.fromisoformat(result["datetime_utc"]).utcoffset() == timezone.utc.utcoffset(None)
