from collections import deque
import math
from dataclasses import dataclass
from datastructure import THRESHOLDS
from config import service as config_service
import statistics


@dataclass
class RuleResult:
    name: str
    score: float
    details: dict


def compute_slope(samples):
    """Compute simple slope (value change per minute) between first and last sample.
    samples: list of dict with 'value' and 'timestamp' (seconds)
    """
    if len(samples) < 2:
        return 0.0
    first = samples[0]
    last = samples[-1]
    dt = last['timestamp'] - first['timestamp']
    if dt <= 0:
        return 0.0
    slope_per_min = (last['value'] - first['value']) / (dt / 60.0)
    return slope_per_min


def evaluate_fire_risk(history_by_type, location):
    """Evaluate fire risk composite rule.

    history_by_type: dict[type] -> deque of samples dict(value, timestamp)
    Returns RuleResult or None
    """
    # Require temperature history
    temp_hist = history_by_type.get('temperature')
    hum_hist = history_by_type.get('humidity')

    if not temp_hist:
        return None

    # slope in degC per minute
    slope = compute_slope(list(temp_hist))

    # humidity last
    hum_val = None
    if hum_hist and len(hum_hist) > 0:
        hum_val = hum_hist[-1]['value']

    # rule heuristics
    # score components: slope_score (normalized), humidity_score
    slope_threshold = config_service.get_rule_param('fire_risk', 'slope_threshold', 0.5)
    slope_score = max(0.0, min(1.0, slope / slope_threshold))

    humidity_threshold = config_service.get_rule_param('fire_risk', 'humidity_threshold', 40.0)
    if hum_val is None:
        humidity_score = 0.0
    else:
        humidity_score = 1.0 if hum_val < humidity_threshold else max(0.0, (humidity_threshold * 2 - hum_val) / (humidity_threshold * 2))

    # combined score: weighted
    score = 0.7 * slope_score + 0.3 * humidity_score

    # require minimal evidence
    if score < 0.4:
        return None

    details = {
        'slope_per_min': slope,
        'slope_score': slope_score,
        'humidity': hum_val,
        'humidity_score': humidity_score,
    }

    return RuleResult(name='fire_risk', score=score, details=details)


def evaluate_all(history_by_type, location):
    """Run all composite rules and return list of RuleResult"""
    results = []
    r = evaluate_fire_risk(history_by_type, location)
    if r:
        results.append(r)
    # CO2 persistence rule
    r2 = evaluate_co2_persistence(history_by_type, location)
    if r2:
        results.append(r2)
    # Noise / crowd anomaly
    r3 = evaluate_noise_anomaly(history_by_type, location)
    if r3:
        results.append(r3)
    return results


def evaluate_co2_persistence(history_by_type, location):
    """Detect sustained CO2 high levels indicating poor ventilation/crowding.

    Uses fraction of recent samples above threshold and mean.
    """
    co2_hist = history_by_type.get('co2')
    if not co2_hist or len(co2_hist) < 3:
        return None

    vals = [s['value'] for s in co2_hist]
    # allow override via rule config
    thresh = config_service.get_rule_param('co2_persistence', 'threshold', THRESHOLDS.get('co2', 1000.0))
    above = sum(1 for v in vals if v > thresh)
    frac = above / len(vals)
    mean = statistics.mean(vals)

    # heuristic scoring
    score = 0.0
    if frac > 0.5:
        score += 0.6
    if mean > thresh * 0.9:
        score += 0.4

    if score < 0.4:
        return None

    details = {'mean': mean, 'fraction_above': frac, 'threshold': thresh}
    return RuleResult(name='co2_persistence', score=score, details=details)


def evaluate_noise_anomaly(history_by_type, location):
    """Detect sudden noise spikes or sustained high noise (possible crowding/events).

    Uses max-median spike and mean vs threshold.
    """
    noise_hist = history_by_type.get('noise_level')
    if not noise_hist or len(noise_hist) < 3:
        return None

    vals = [s['value'] for s in noise_hist]
    median = statistics.median(vals)
    maximum = max(vals)
    mean = statistics.mean(vals)
    thresh = config_service.get_rule_param('noise_anomaly', 'threshold', THRESHOLDS.get('noise_level', 85.0))

    spike = maximum - median
    score = 0.0
    spike_thresh = config_service.get_rule_param('noise_anomaly', 'spike_threshold', 8.0)
    if spike > spike_thresh:
        score += 0.6
    if mean > thresh * 0.9:
        score += 0.4

    if score < 0.4:
        return None

    details = {'median': median, 'max': maximum, 'mean': mean, 'spike': spike}
    return RuleResult(name='noise_anomaly', score=score, details=details)
