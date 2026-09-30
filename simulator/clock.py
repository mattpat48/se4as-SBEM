"""Simulated clock: real time drives it, physics runs in simulated time."""
import re
from datetime import datetime, timedelta

_HHMM = re.compile(r"^(\d{1,2}):(\d{2})$")
MIN_YEAR, MAX_YEAR = 1900, 2200


class SimClock:
    def __init__(self, start: datetime, speed: float = 1, max_speed: float = 60):
        self._now = start.replace(microsecond=0, tzinfo=None)
        self._max_speed = max_speed
        self._speed = 1
        self.set_speed(speed)

    @property
    def now(self) -> datetime:
        return self._now

    @property
    def speed(self) -> float:
        return self._speed

    def advance(self, real_dt: float) -> float:
        sim_dt = real_dt * self._speed
        self._now += timedelta(seconds=sim_dt)
        return sim_dt

    def set_speed(self, speed: float) -> None:
        if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not 1 <= speed <= self._max_speed:
            raise ValueError(f"velocità non valida: {speed!r} (ammessa 1–{self._max_speed:g})")
        self._speed = speed

    def jump_to(self, target: str) -> None:
        if not isinstance(target, str):
            raise ValueError(f"orario non valido: {target!r}")
        m = _HHMM.match(target)
        if m:
            hour, minute = int(m.group(1)), int(m.group(2))
            if hour > 23 or minute > 59:
                raise ValueError(f"orario non valido: {target}")
            candidate = self._now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate <= self._now:
                candidate += timedelta(days=1)
            self._now = candidate
            return
        try:
            when = datetime.fromisoformat(target)
        except ValueError:
            raise ValueError(f"orario non valido: {target}") from None
        if when.tzinfo is not None:
            raise ValueError(f"orario con fuso non ammesso: {target}")
        if not MIN_YEAR <= when.year <= MAX_YEAR:
            raise ValueError(f"anno fuori da {MIN_YEAR}–{MAX_YEAR}: {target}")
        self._now = when.replace(microsecond=0)

    def to_message(self, real_ts: float) -> dict:
        return {"sim_time": self._now.isoformat(timespec="seconds"), "speed": self._speed, "timestamp": real_ts}
