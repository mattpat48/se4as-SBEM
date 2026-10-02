/** Keep navigation responsive, but stop spending display-rate GPU time on a parked camera. */
export function frameRate(low: boolean, walking: boolean, moving: boolean): number {
  if (low) return walking || moving ? 30 : 15;
  return walking || moving ? 60 : 30;
}

export function shadowInterval(low: boolean): number {
  return low ? .1 : .05;
}
