from datetime import datetime, timezone

from main import local_start


def test_start_is_laquila_local_time_without_timezone():
    start = local_start(datetime(2026, 9, 30, 17, 17, 2, 500, tzinfo=timezone.utc))
    assert start == datetime(2026, 9, 30, 19, 17, 2) and start.tzinfo is None


def test_start_uses_winter_offset():
    assert local_start(datetime(2027, 1, 15, 7, 0, tzinfo=timezone.utc)) == datetime(2027, 1, 15, 8, 0)
