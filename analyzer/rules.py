def calculate_comfort(sensors):
    """
    Calculate environmental comfort indexes at the room/apartment level.
    Returns: (comfort_score, details_dict) or (None, {})
    """
    details = {}
    score = 0.0
    components = 0
    
    # 1. Thermal Comfort (Temperature and Humidity)
    if "temperature" in sensors and "humidity" in sensors:
        temp = sensors["temperature"]
        hum = sensors["humidity"]
        
        # Ideal: 21-24C, 40-60%
        temp_score = 100 - min(abs(temp - 22.5) * 10, 100)
        hum_score = 100 - min(abs(hum - 50) * 2, 100)
        
        thermal = (temp_score * 0.7) + (hum_score * 0.3)
        details["thermal"] = thermal
        score += thermal
        components += 1
        
    # 2. Indoor Air Quality (IAQ) (CO2, PM2.5)
    if "co2" in sensors:
        co2 = sensors["co2"]
        # Ideal: < 800ppm. Poor > 1500ppm
        if co2 < 800:
            iaq = 100
        else:
            iaq = max(0, 100 - ((co2 - 800) / 10))
            
        details["iaq"] = iaq
        score += iaq
        components += 1
        
    # 3. Acoustic Comfort (Noise)
    if "noise_level" in sensors:
        noise = sensors["noise_level"]
        # Ideal: < 40dB. Poor > 70dB
        if noise < 40:
            acoustic = 100
        else:
            acoustic = max(0, 100 - ((noise - 40) * 3))
            
        details["acoustic"] = acoustic
        score += acoustic
        components += 1
        
    # 4. Visual Comfort (Light)
    if "light" in sensors:
        light = sensors["light"]
        # Simplified: depends on occupancy, but we assume > 300 lux is good if occupied
        if light > 300:
            visual = 100
        else:
            visual = max(0, (light / 300) * 100)
            
        details["visual"] = visual
        score += visual
        components += 1
        
    if components == 0:
        return None, {}
        
    final_score = score / components
    return final_score, details


def evaluate_risks(sensors, model):
    """
    Evaluate composite risks based on multiple sensor inputs.
    Returns: list of dicts with 'name', 'severity' (0-100), and 'details'.
    """
    risks = []
    
    # 1. Fire Risk: High temperature + Smoke detection
    temp = sensors.get("temperature", 0)
    smoke = sensors.get("smoke", 0)
    if temp > 45 or smoke > 5:
        severity = 0
        if smoke > 10:
            severity = 100
        elif temp > 50:
            severity = 80
        elif smoke > 5 and temp > 35:
            severity = 60
            
        if severity > 0:
            risks.append({
                "name": "fire",
                "severity": severity,
                "details": {"temperature": temp, "smoke": smoke}
            })
            
    # 2. Gas/CO Leak: High CO levels + Gas detector activation
    co = sensors.get("co", 0)
    gas = sensors.get("gas", 0)
    
    if co > 50 or gas > 5: # %LEL
        severity = 0
        if gas > 20 or co > 300:
            severity = 100
        elif gas > 10 or co > 100:
            severity = 80
        else:
            severity = 50
            
        if severity > 0:
            risks.append({
                "name": "gas_co_leak",
                "severity": severity,
                "details": {"co_ppm": co, "gas_lel": gas}
            })
            
    # 3. Security/Panic (Abnormal Presence - simple logic for now)
    # Could check occupancy when profile should be empty
    
    return risks
