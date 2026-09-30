from datetime import datetime, timedelta

import pytest

from clock import SimClock

START = datetime(2026, 9, 30, 21, 15)


def test_advance_scales_with_speed():
    c = SimClock(START, speed=60)
    assert c.advance(1.0) == 60
    assert c.now == START + timedelta(seconds=60)


@pytest.mark.parametrize("bad", [0, 0.5, 61, -1])
def test_set_speed_out_of_range(bad):
    with pytest.raises(ValueError):
        SimClock(START).set_speed(bad)


def test_jump_to_later_same_day():
    c = SimClock(START); c.jump_to("22:00")
    assert c.now == datetime(2026, 9, 30, 22, 0)


def test_jump_to_hour_already_passed_goes_next_day():
    c = SimClock(START); c.jump_to("08:00")
    assert c.now == datetime(2026, 10, 1, 8, 0)


def test_jump_to_earlier_datetime():
    c = SimClock(START); c.jump_to("2026-01-15T08:00:00")
    assert c.now == datetime(2026, 1, 15, 8, 0)


@pytest.mark.parametrize("bad", ["25:00", "garbage", "", "12:61"])
def test_jump_to_invalid(bad):
    with pytest.raises(ValueError):
        SimClock(START).jump_to(bad)


def test_to_message():
    c = SimClock(START, speed=60)
    assert c.to_message(1790440000.0) == {"sim_time": "2026-09-30T21:15:00", "speed": 60, "timestamp": 1790440000.0}


@pytest.mark.parametrize("far", ["9999-12-31T23:59:59", "0001-01-01T00:00:00"])
def test_jump_to_out_of_supported_years(far):
    with pytest.raises(ValueError):
        SimClock(START).jump_to(far)
