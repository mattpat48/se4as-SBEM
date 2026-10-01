// Visual thresholds of weather and emergencies (view spec §7.7–§7.8). Visual only.

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0 at ≤ 1 % obscuration, linear up to 1 at 30 %. */
export const smokeDensity = (smoke: number) => clamp01((smoke - 1) / 29);
export const isFire = (temperature: number, smoke: number) => temperature > 60 && smoke > 10;
export const gasHaze = (gas: number) => gas > 5;
export const coWarning = (co: number) => co > 0;

export const SHAKE_M_PER_MW = 0.15;
export const shakeAmplitude = (seismic: number) => Math.max(0, seismic - 3) * SHAKE_M_PER_MW;

export const rainDensity = (rain: number) => clamp01(rain / 30);
export const windSway = (wind: number) => clamp01(wind / 80);
export const isCloudy = (rain: number) => rain > 0;
