// Sun position over L'Aquila from the simulated time (view spec §7.6), NOAA approximation.
// sim_time is naive local time (Europe/Rome): converted to UTC with the CET/CEST rule.

export const LAQUILA = { lat: 42.35, lon: 13.40 };

const H = 3_600_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp1 = (x: number) => Math.min(1, Math.max(-1, x));

function lastSundayUtc(year: number, monthIndex: number): number {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return Date.UTC(year, monthIndex, last.getUTCDate() - last.getUTCDay(), 1);   // 01:00 UTC
}

/** CEST (+2) from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC, else CET (+1). */
export function romeOffsetHours(utcMs: number): 1 | 2 {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSundayUtc(y, 2) && utcMs < lastSundayUtc(y, 9) ? 2 : 1;
}

function naiveToUtc(naiveMs: number): number {
  const first = naiveMs - romeOffsetHours(naiveMs - H) * H;
  return naiveMs - romeOffsetHours(first) * H;
}

export function sunPosition(simNaiveMs: number, lat = LAQUILA.lat, lon = LAQUILA.lon): { elevationDeg: number; azimuthDeg: number } {
  const utc = naiveToUtc(simNaiveMs);
  const jc = (utc / 86_400_000 + 2440587.5 - 2451545) / 36525;
  const l0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c = Math.sin(rad(m)) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * jc) + Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(clamp1(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(m))
    + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) - 0.5 * y * y * Math.sin(4 * rad(l0))
    - 1.25 * e * e * Math.sin(2 * rad(m)));
  const minutes = (((utc % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const tst = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const phi = rad(lat);
  const zen = Math.acos(clamp1(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(rad(ha))));
  const denom = Math.cos(phi) * Math.sin(zen);
  const a = denom === 0 ? 0 : deg(Math.acos(clamp1((Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / denom)));
  const azimuthDeg = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  return { elevationDeg: 90 - deg(zen), azimuthDeg };
}

/** 1 with the sun ≤ −6°, 0 at ≥ +6°, linear in between. */
export function nightFactor(elevationDeg: number): number {
  return Math.min(1, Math.max(0, (6 - elevationDeg) / 12));
}
