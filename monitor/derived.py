import time
import logging

logger = logging.getLogger(__name__)

class DerivedCalculator:
    def __init__(self, publisher, validator):
        self.publisher = publisher
        self.validator = validator
        self.last_calc = 0
        self.period_s = 10

    def calculate(self):
        current = time.time()
        if current - self.last_calc < self.period_s:
            return
        self.last_calc = current

        # We need building list and complex info
        buildings = self.validator.building_sensors.keys()
        if not buildings:
            return
            
        complex_power = 0
        complex_pv = 0
        complex_occ = 0
        
        for b_id in buildings:
            b_power = 0
            b_pv = 0
            b_occ = 0
            
            # Aggregate from units
            for dev in self.validator.devices.values():
                if dev.area == b_id:
                    if dev.type == "power" and dev.last_value is not None:
                        b_power += dev.last_value
                    elif dev.type == "pv_power" and dev.last_value is not None:
                        b_pv += dev.last_value
                    elif dev.type == "occupancy" and dev.last_value is not None:
                        b_occ += dev.last_value
                    elif dev.kind == "actuator" and getattr(dev, "power_w", 0) > 0:
                        # Need to track power_w for actuators, not fully implemented in state parsing yet
                        pass

            b_energy_balance = b_pv - b_power
            
            self._publish_derived(b_id, b_id, "power_total", "W", b_power)
            self._publish_derived(b_id, b_id, "energy_balance", "W", b_energy_balance)
            self._publish_derived(b_id, b_id, "occupancy_total", "persone", b_occ)
            
            complex_power += b_power
            complex_pv += b_pv
            complex_occ += b_occ

        # Park contribution
        park_power = 0
        for dev in self.validator.devices.values():
            if dev.area == "park" and dev.kind == "actuator":
                pass # add park power
                
        complex_power += park_power
        complex_eb = complex_pv - complex_power
        
        self._publish_derived("complex", "complex", "power_total", "W", complex_power)
        self._publish_derived("complex", "complex", "energy_balance", "W", complex_eb)
        self._publish_derived("complex", "complex", "occupancy_total", "persone", complex_occ)

    def _publish_derived(self, area, unit_id, typ, unit, value):
        payload = {
            "device_id": f"{unit_id}.{typ}",
            "type": typ,
            "unit": unit,
            "value": value,
            "kind": "derived",
            "quality": "ok",
            "timestamp": time.time()
        }
        topic = f"Complex/monitored/{area}/{unit_id}/{typ}"
        self.publisher.publish_monitored(topic, payload)
