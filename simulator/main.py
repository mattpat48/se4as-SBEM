"""Entry point of the simulator service: the managed resource of the MAPE-K loop."""
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt

from model import ConfigError, load_model
from mqtt_io import ROOT, SimulatorService
from simulation import Simulation

log = logging.getLogger("simulator")
LOCAL_TZ = ZoneInfo("Europe/Rome")      # sim_time is L'Aquila local time without offset (spec §7.3)


def local_start(now_utc: datetime) -> datetime:
    return now_utc.astimezone(LOCAL_TZ).replace(tzinfo=None, microsecond=0)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    config_path = os.getenv("CONFIG_PATH", "/app/config/complex.json")
    try:
        model = load_model(config_path)
    except ConfigError as exc:
        print(f"Configurazione non valida ({config_path}): {exc}", file=sys.stderr)
        sys.exit(1)

    settings = model.settings
    sim = Simulation(model, local_start(datetime.now(timezone.utc)))

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="simulator")
    username = os.getenv("MQTT_USERNAME")
    if username:
        client.username_pw_set(username, os.getenv("MQTT_PASSWORD"))
    status_topic = f"{ROOT}/status/simulator"
    client.will_set(status_topic, "offline", qos=1, retain=True)
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    service = SimulatorService(sim, client, settings)
    client.on_connect = service.on_connect
    client.on_message = service.on_message

    broker, port = os.getenv("MQTT_BROKER", "localhost"), int(os.getenv("MQTT_PORT", "1883"))
    client.connect_async(broker, port)
    client.loop_start()
    log.info("simulatore avviato: %d dispositivi, broker %s:%d", len(model.devices()), broker, port)

    running = True

    def stop(signum, frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    step = settings["physics_step_s"]
    next_tick = time.monotonic()
    while running:
        service.tick(time.time())
        next_tick += step
        delay = next_tick - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        else:
            next_tick = time.monotonic()      # fell behind: do not try to catch up

    try:
        client.publish(status_topic, "offline", qos=1, retain=True).wait_for_publish(timeout=2)
    except (RuntimeError, ValueError):
        log.warning("impossibile pubblicare lo stato offline")
    client.loop_stop()
    client.disconnect()


if __name__ == "__main__":
    main()
