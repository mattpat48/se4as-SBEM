import time
import numpy as np
from math import sqrt


def predict_breach_probability(samples, horizon_seconds, threshold):
    """Estimate probability that sensor value will exceed `threshold` within `horizon_seconds`.

    samples: list of {'value': float, 'timestamp': int}
    Returns: probability in [0,1]
    Approach:
    - Fit a linear model value = a * t + b (t = seconds since epoch) using least squares.
    - Compute predicted value at now + horizon_seconds.
    - Estimate residual stddev and assume Gaussian noise to compute P(X > threshold).
    """
    if not samples:
        return 0.0

    if len(samples) < 3:
        # fallback: use last sample only
        last = samples[-1]['value']
        return 1.0 if last > threshold else 0.0

    # prepare arrays
    ts = np.array([s['timestamp'] for s in samples], dtype=float)
    vals = np.array([s['value'] for s in samples], dtype=float)

    # normalize time to improve numeric stability
    t0 = ts[0]
    t_rel = ts - t0

    # linear fit
    try:
        a, b = np.polyfit(t_rel, vals, 1)
    except Exception:
        # fallback
        last = vals[-1]
        return 1.0 if last > threshold else 0.0

    # predicted value at horizon
    now = time.time()
    t_pred = now - t0 + horizon_seconds
    pred = a * t_pred + b

    # residuals and stddev
    fitted = a * t_rel + b
    resid = vals - fitted
    sigma = np.std(resid, ddof=1)

    if sigma <= 0:
        return 1.0 if pred > threshold else 0.0

    # use Gaussian tail probability
    z = (threshold - pred) / sigma
    # probability of exceeding threshold = 1 - CDF(z)
    from math import erf, sqrt
    cdf = 0.5 * (1 + erf(z / sqrt(2)))
    prob = max(0.0, min(1.0, 1.0 - cdf))
    return float(prob)


if __name__ == '__main__':
    # quick local smoke test
    now = int(time.time())
    samples = [
        {'timestamp': now - 120, 'value': 25.0},
        {'timestamp': now - 60, 'value': 26.2},
        {'timestamp': now, 'value': 27.5},
    ]
    print('prob breach in 300s vs thresh 30:', predict_breach_probability(samples, 300, 30.0))
