export function mapBellowsToGain(bellowsScalar: number): number {
  const clamped = Math.min(1, Math.max(0, bellowsScalar));
  const gainDb = -18 + clamped * 24;
  const targetGain = Math.pow(10, gainDb / 20);

  return Math.min(1, Math.max(0.18, targetGain));
}
