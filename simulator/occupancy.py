"""People in the apartments (daily profiles, stair transit, evacuation) and electric cars."""
import random
from dataclasses import dataclass, field
from datetime import date, datetime

from model import ComplexModel


def _hours(hhmm: str) -> float:
    h, m = hhmm.split(":")
    return int(h) + int(m) / 60


def in_window(hour: float, start: str, end: str) -> bool:
    s, e = _hours(start), _hours(end)
    if s < e:
        return s <= hour < e
    return hour >= s or hour < e          # crosses midnight


def _hour(now: datetime) -> float:
    return now.hour + now.minute / 60 + now.second / 3600


@dataclass
class Activity:
    cooking: bool
    showering: int  # showers in progress


@dataclass
class _Evacuation:
    pending: list[float] = field(default_factory=list)   # seconds left before each person leaves
    out: int = 0                                          # people already in the park


class Occupancy:
    def __init__(self, model: ComplexModel, p: dict, rng: random.Random):
        self.p = p["occupancy"]
        self.apt_p = p["apartment"]
        self.transit_s = p["stairwell"]["transit_s"]
        self._seed = rng.getrandbits(64)
        self._apartments = {u.id: u for u in model.apartments()}
        self._groups: dict[str, list[dict]] = {}
        for uid, u in self._apartments.items():
            groups = self.p["schedules"][u.attrs["profile"]]["groups"]
            n = u.attrs["residents"]
            self._groups[uid] = [self._group_for(groups, (i + 0.5) / n) for i in range(n)]
        self.home: dict[str, int] = {uid: u.attrs["residents"] for uid, u in self._apartments.items()}
        self.transit: dict[str, int] = {u.id: 0 for u in model.units_of("stairwell")}
        self.in_park = 0
        self._moves: list[list] = []          # [stairwell_id, people, seconds_left]
        self._evac: dict[str, _Evacuation] = {}
        self._started = False

    @staticmethod
    def _group_for(groups: list[dict], position: float) -> dict:
        cumulative = 0.0
        for g in groups:
            cumulative += g["share"]
            if position < cumulative:
                return g
        return groups[-1]

    def _rng(self, *parts) -> random.Random:
        return random.Random("-".join(str(x) for x in (self._seed, *parts)))

    def _jitter_h(self, apt: str, day: date) -> float:
        j = self.p["jitter_min"]
        return self._rng("jitter", apt, day).uniform(-j, j) / 60 if j else 0.0

    def _resident_home(self, apt: str, i: int, now: datetime) -> bool:
        day, h = now.date(), _hour(now)
        if day.weekday() >= 5 and self._rng("weekend", apt, i, day).random() < self.p["weekend_home_prob"]:
            return True
        shifted = (h - self._jitter_h(apt, day)) % 24
        return not any(in_window(shifted, s, e) for s, e in self._groups[apt][i]["away"])

    def _scheduled(self, apt: str, now: datetime, forced: str | None) -> int:
        n = self._apartments[apt].attrs["residents"]
        if forced == "all_home":
            return n
        if forced == "all_away":
            return 0
        return sum(self._resident_home(apt, i, now) for i in range(n))

    def _stairwell(self, apt: str) -> str:
        return f"{self._apartments[apt].attrs['building']}-S"

    def step(self, now: datetime, dt: float, evacuate: set[str], forced: str | None) -> None:
        for move in self._moves:
            move[2] -= dt
        self._moves = [m for m in self._moves if m[2] > 0]
        new_moves: list[tuple[str, int]] = []

        for apt in self._apartments:
            old = self.home[apt]
            if apt in evacuate:
                ev = self._evac.get(apt)
                if ev is None:
                    rng = self._rng("evac", apt, now.isoformat())
                    lo, hi = self.p["evacuation_delay_min"]
                    ev = self._evac[apt] = _Evacuation([rng.uniform(lo, hi) * 60 for _ in range(old)])
                ev.pending = [t - dt for t in ev.pending]
                leaving = sum(1 for t in ev.pending if t <= 0)
                ev.pending = [t for t in ev.pending if t > 0]
                ev.out += leaving
                self.in_park += leaving
                new = len(ev.pending)
            else:
                ev = self._evac.pop(apt, None)
                if ev is not None:
                    self.in_park -= ev.out
                new = self._scheduled(apt, now, forced)
            self.home[apt] = new
            if self._started and new != old:
                new_moves.append((self._stairwell(apt), abs(new - old)))
        self._started = True

        for stair, people in new_moves:
            self._moves.append([stair, people, self.transit_s])
        for stair in self.transit:
            self.transit[stair] = sum(m[1] for m in self._moves if m[0] == stair)

    def awake(self, apartment_id: str, now: datetime) -> int:
        profile = self._apartments[apartment_id].attrs["profile"]
        start, end = self.p["schedules"][profile]["awake"]
        return self.home[apartment_id] if in_window(_hour(now), start, end) else 0

    def _shower_active(self, apt: str, i: int, now: datetime) -> bool:
        duration_h = self.apt_p["water"]["shower_min"] / 60
        h = _hour(now)
        rng = self._rng("shower", apt, i, now.date())
        start, end = rng.choice(self.apt_p["shower_windows"])
        begin = rng.uniform(_hours(start), _hours(end))
        return begin <= h < begin + duration_h

    def activity(self, apartment_id: str, now: datetime) -> Activity:
        awake = self.awake(apartment_id, now)
        h = _hour(now)
        cooking = awake > 0 and any(in_window(h, s, e) for s, e in self.apt_p["meals"])
        if apartment_id in self._evac:
            showering = 0
        else:
            n = self._apartments[apartment_id].attrs["residents"]
            showering = sum(1 for i in range(n)
                            if self._shower_active(apartment_id, i, now) and self._resident_home(apartment_id, i, now))
            showering = min(showering, self.home[apartment_id])
        return Activity(cooking=cooking, showering=showering)


@dataclass
class Car:
    connected: bool
    energy_needed_kwh: float


class EVFleet:
    def __init__(self, charger_ids: list[str], p: dict, rng: random.Random):
        self.p = p
        self._seed = rng.getrandbits(64)
        self.cars: dict[str, Car] = {cid: Car(False, 0.0) for cid in charger_ids}

    def _plan(self, cid: str, day: date) -> tuple[float, float, float]:
        rng = random.Random(f"{self._seed}-{cid}-{day}")
        return rng.uniform(*self.p["arrive_h"]), rng.uniform(*self.p["leave_h"]), rng.uniform(*self.p["need_kwh"])

    def step(self, now: datetime, dt: float, charging_w: dict[str, float]) -> None:
        h = _hour(now)
        for cid, car in self.cars.items():
            if car.connected:
                car.energy_needed_kwh = max(0.0, car.energy_needed_kwh - charging_w.get(cid, 0.0) * dt / 3.6e6)
            arrive, leave, need = self._plan(cid, now.date())
            connected = h >= arrive or h < leave
            if connected and not car.connected:
                car.energy_needed_kwh = need
            car.connected = connected
