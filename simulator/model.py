"""Load, validate and expand config/complex.json into the full complex model."""
import copy
import json
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class SensorType:
    name: str
    unit: str
    valid_range: tuple[float, float]
    noise: float
    rest_value: float | None
    stuck_check: bool
    drift_check: bool


@dataclass(frozen=True)
class ActuatorType:
    name: str
    commands: dict[str, dict]
    default: dict
    power_w: dict
    essential: bool


@dataclass(frozen=True)
class Device:
    device_id: str
    unit_id: str
    area: str
    type: str
    kind: str  # "sensor" | "actuator"


@dataclass
class Unit:
    id: str
    kind: str  # "apartment" | "stairwell" | "building" | "park" | "charger"
    area: str
    sensors: list[str]
    actuators: list[str]
    attrs: dict = field(default_factory=dict)
    adjacent: list[str] = field(default_factory=list)


@dataclass
class ComplexModel:
    settings: dict
    sensor_types: dict[str, SensorType]
    actuator_types: dict[str, ActuatorType]
    profiles: dict
    units: dict[str, Unit]
    physics: dict
    monitor: dict
    layouts: dict
    catalogue: dict = field(default_factory=dict, repr=False)

    def apartments(self) -> list[Unit]:
        return self.units_of("apartment")

    def units_of(self, kind: str) -> list[Unit]:
        return sorted((u for u in self.units.values() if u.kind == kind), key=lambda u: u.id)

    def devices(self) -> list[Device]:
        out = []
        for u in self.units.values():
            out += [Device(f"{u.id}.{t}", u.id, u.area, t, "sensor") for t in u.sensors]
            out += [Device(f"{u.id}.{t}", u.id, u.area, t, "actuator") for t in u.actuators]
        return sorted(out, key=lambda d: d.device_id)

    def to_json(self) -> dict:
        return {
            "complex": self.settings,
            "device_types": self.catalogue,
            "profiles": self.profiles,
            "units": [asdict(u) for u in sorted(self.units.values(), key=lambda u: u.id)],
            "layouts": self.layouts,
            "monitor": self.monitor,
        }


def _req(section: dict, key: str, where: str):
    if not isinstance(section, dict) or key not in section:
        raise ConfigError(f"campo mancante: {where}.{key}")
    return section[key]


def _parse_catalogue(raw: dict) -> tuple[dict[str, SensorType], dict[str, ActuatorType]]:
    sensors, actuators = {}, {}
    for name, d in _req(raw, "device_types", "").items():
        kind = _req(d, "kind", f"device_types.{name}")
        where = f"device_types.{name}"
        if kind == "sensor":
            lo, hi = _req(d, "valid_range", where)
            if lo >= hi:
                raise ConfigError(f"valid_range non valido per {name}")
            sensors[name] = SensorType(name, _req(d, "unit", where), (float(lo), float(hi)),
                                       float(_req(d, "noise", where)), _req(d, "rest_value", where),
                                       bool(_req(d, "stuck_check", where)), bool(_req(d, "drift_check", where)))
        elif kind == "actuator":
            actuators[name] = ActuatorType(name, _req(d, "commands", where), _req(d, "default", where),
                                           _req(d, "power_w", where), bool(_req(d, "essential", where)))
        else:
            raise ConfigError(f"kind non valido per {name}: {kind}")
    return sensors, actuators


def _check_types(unit_id: str, sensors: list[str], actuators: list[str], stypes: dict, atypes: dict) -> None:
    for t in sensors:
        if t not in stypes:
            raise ConfigError(f"sensore sconosciuto in {unit_id}: {t}")
    for t in actuators:
        if t not in atypes:
            raise ConfigError(f"attuatore sconosciuto in {unit_id}: {t}")


def _link(units: dict[str, Unit], a: str, b: str) -> None:
    if b not in units[a].adjacent:
        units[a].adjacent.append(b)
    if a not in units[b].adjacent:
        units[b].adjacent.append(a)


def build_model(raw: dict) -> ComplexModel:
    raw = copy.deepcopy(raw)
    settings = _req(raw, "complex", "")
    seed = _req(settings, "seed", "complex")
    stypes, atypes = _parse_catalogue(raw)
    profiles = _req(raw, "profiles", "")
    apt_t = _req(raw, "apartment_template", "")
    stair_t = _req(raw, "stairwell_template", "")
    park = _req(raw, "park", "")
    parking = _req(raw, "parking", "")
    physics = _req(raw, "physics", "")
    monitor = _req(raw, "monitor", "")

    units: dict[str, Unit] = {}

    def add(unit: Unit) -> None:
        if unit.id in units:
            raise ConfigError(f"ID duplicato: {unit.id}")
        _check_types(unit.id, unit.sensors, unit.actuators, stypes, atypes)
        units[unit.id] = unit

    buildings = _req(raw, "buildings", "")
    overrides: dict[str, dict] = {}
    for b in buildings:
        bid = _req(b, "id", "buildings[]")
        where = f"buildings.{bid}"
        floors, per_floor = _req(b, "floors", where), _req(b, "apartments_per_floor", where)
        orientation = _req(b, "orientation", where)
        add(Unit(bid, "building", bid, list(b.get("sensors", [])), list(b.get("actuators", [])),
                 {"floors": floors, "pv_peak_w": _req(b, "pv_peak_w", where),
                  "battery_kwh": _req(b, "battery_kwh", where), "battery_max_w": _req(b, "battery_max_w", where),
                  "layout": b.get("layout")}))
        add(Unit(f"{bid}-S", "stairwell", bid, list(stair_t["sensors"]), list(stair_t["actuators"]),
                 {"building": bid}))
        for f in range(floors):
            for n in range(1, per_floor + 1):
                area, height = apt_t["area_m2"], apt_t["height_m"]
                add(Unit(f"{bid}-{f}-{n}", "apartment", bid, list(apt_t["sensors"]), list(apt_t["actuators"]),
                         {"building": bid, "floor": f, "number": n, "profile": None, "residents": 0,
                          "orientation": orientation.get(str(n)), "area_m2": area, "height_m": height,
                          "volume_m3": area * height, "insulation": apt_t["insulation"]}))
        for uid, ov in b.get("overrides", {}).items():
            overrides[uid] = ov

    add(Unit("park", "park", "park", list(park["sensors"]), list(park["actuators"]),
             {"area_m2": park.get("area_m2")}))
    for c in _req(parking, "chargers", "parking"):
        cid = _req(c, "id", "parking.chargers[]")
        if c.get("building") not in {b["id"] for b in buildings}:
            raise ConfigError(f"palazzo sconosciuto per {cid}: {c.get('building')}")
        add(Unit(cid, "charger", "parking", [], ["ev_charger"],
                 {"building": c["building"], "max_power_w": c["max_power_w"]}))

    # Profiles and residents, seeded; overrides win.
    rng = random.Random(f"{seed}-profiles")
    names = sorted(profiles)
    weights = [profiles[n]["weight"] for n in names]
    apartments = sorted((u for u in units.values() if u.kind == "apartment"), key=lambda u: u.id)
    for u in apartments:
        p = rng.choices(names, weights)[0]
        lo, hi = profiles[p]["residents"]
        u.attrs["profile"], u.attrs["residents"] = p, rng.randint(lo, hi)
    for uid, ov in overrides.items():
        if uid not in units or units[uid].kind != "apartment":
            raise ConfigError(f"override per appartamento inesistente: {uid}")
        if "profile" in ov and ov["profile"] not in profiles:
            raise ConfigError(f"profilo sconosciuto in override {uid}: {ov['profile']}")
        a = units[uid].attrs
        a.update(ov)
        a["volume_m3"] = a["area_m2"] * a["height_m"]
    for u in apartments:
        if u.attrs["orientation"] is None:
            raise ConfigError(f"esposizione mancante per {u.id}")

    # Computed adjacency.
    for u in apartments:
        b, f, n = u.attrs["building"], u.attrs["floor"], u.attrs["number"]
        for other in apartments:
            ob, of, on = other.attrs["building"], other.attrs["floor"], other.attrs["number"]
            if other.id != u.id and ob == b and ((of == f) or (on == n and abs(of - f) == 1)):
                _link(units, u.id, other.id)
        _link(units, u.id, f"{b}-S")
    for entry in raw.get("adjacency_overrides", []):
        op, pair = entry.get("op"), entry.get("units", [])
        if op not in ("add", "remove") or len(pair) != 2:
            raise ConfigError(f"adjacency_overrides non valido: {entry}")
        a, b = pair
        for uid in (a, b):
            if uid not in units:
                raise ConfigError(f"adjacency_overrides: unità sconosciuta {uid}")
        if op == "add":
            _link(units, a, b)
        else:
            if b in units[a].adjacent:
                units[a].adjacent.remove(b)
            if a in units[b].adjacent:
                units[b].adjacent.remove(a)
    for u in units.values():
        u.adjacent.sort()

    layouts = {"park": park.get("layout"), "parking": parking.get("layout")}
    return ComplexModel(settings, stypes, atypes, profiles, units, physics, monitor, layouts,
                        catalogue=raw["device_types"])


def load_model(path: str | Path) -> ComplexModel:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"impossibile leggere {path}: {exc}") from exc
    return build_model(raw)
