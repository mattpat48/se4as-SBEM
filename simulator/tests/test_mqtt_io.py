import json
from collections import namedtuple
from datetime import datetime

import pytest

from mqtt_io import SimulatorService, device_topic, parse_device_topic
from simulation import Simulation

Published = namedtuple("Published", "topic payload qos retain")


class FakeClient:
    def __init__(self):
        self.published: list[Published] = []
        self.subscriptions: list[tuple[str, int]] = []

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.published.append(Published(topic, payload, qos, retain))

    def subscribe(self, topic, qos=0):
        self.subscriptions.append((topic, qos))


class FakeMsg:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = payload


@pytest.fixture
def client():
    return FakeClient()


@pytest.fixture
def service(model, client):
    return SimulatorService(Simulation(model, datetime(2026, 9, 30, 21, 15)), client, model.settings)


def test_device_topic_roundtrip():
    t = device_topic("raw", "A", "A-2-1", "co2")
    assert t == "Complex/raw/A/A-2-1/co2"
    assert parse_device_topic(t) == ("raw", "A", "A-2-1", "co2")
    with pytest.raises(ValueError):
        parse_device_topic("City/data/x")


def test_on_connect_subscribes_and_publishes_retained(service, client):
    service.on_connect(client, None, None, 0, None)
    assert {s[0] for s in client.subscriptions} == {"Complex/cmd/#", "Complex/control/#"}
    retained = {p.topic for p in client.published if p.retain}
    assert {"Complex/status/simulator", "Complex/model", "Complex/clock", "Complex/scenarios"} <= retained
    assert len([t for t in retained if t.startswith("Complex/state/")]) == 283


def test_on_connect_republishes_after_reconnect(service, client):
    service.on_connect(client, None, None, 0, None); n = len(client.published)
    service.on_connect(client, None, None, 0, None)
    assert len(client.published) == 2 * n


def test_command_publishes_ack_and_state(service, client):
    service.on_message(client, None, FakeMsg("Complex/cmd/A/A-2-1/window",
                       json.dumps({"cmd_id": "c1", "command": {"position": "open"}})))
    topics = [p.topic for p in client.published]
    assert "Complex/ack/A/A-2-1/window" in topics and "Complex/state/A/A-2-1/window" in topics


@pytest.mark.parametrize("topic, payload", [
    ("Complex/cmd/A/A-2-1/hvac", b"\xff\xfe"), ("Complex/cmd/bad", b"{}"),
    ("Complex/control/scenario", b"[1,2]"), ("Complex/control/clock", b'{"speed": 0}'),
    ("Complex/control/unknown", b"{}"),
])
def test_on_message_garbage_does_not_raise(service, client, topic, payload):
    service.on_message(client, None, FakeMsg(topic, payload))   # must not raise


def test_tick_publishes_readings_on_sampling_boundary(service, client):
    for ts in range(100, 111):
        service.tick(float(ts))
    raw = [p for p in client.published if p.topic.startswith("Complex/raw/")]
    assert len(raw) in (414, 828) and all(p.qos == 0 and not p.retain for p in raw)


def test_scenario_control_publishes_scenarios(service, client):
    service.on_message(client, None, FakeMsg("Complex/control/scenario",
                       json.dumps({"action": "start", "scenario": "storm", "target": "complex"})))
    last = [p for p in client.published if p.topic == "Complex/scenarios"][-1]
    assert last.retain and json.loads(last.payload)["active"][0]["scenario"] == "storm"


def test_undecodable_command_gets_rejected_ack(service, client):
    service.on_message(client, None, FakeMsg("Complex/cmd/A/A-2-1/hvac", b"\xff\xfe"))
    acks = [json.loads(p.payload) for p in client.published if p.topic == "Complex/ack/A/A-2-1/hvac"]
    assert len(acks) == 1 and acks[0]["status"] == "rejected" and acks[0]["cmd_id"] is None


def test_tick_survives_simulation_error(service, client, monkeypatch):
    def boom(real_dt):
        raise OverflowError("date value out of range")
    monkeypatch.setattr(service.sim, "step", boom)
    service.tick(100.0)                                         # must not raise
