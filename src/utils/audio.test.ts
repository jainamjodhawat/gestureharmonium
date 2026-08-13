import { describe, it, expect } from 'vitest';
import { mapBellowsToGain } from './audio';

describe('mapBellowsToGain', () => {
  it('never drops to silent when the bellows are at minimum', () => {
    const gain = mapBellowsToGain(0);
    expect(gain).toBeGreaterThan(0.05);
  });

  it('scales up as bellows increase', () => {
    const quiet = mapBellowsToGain(0.1);
    const louder = mapBellowsToGain(0.9);
    expect(louder).toBeGreaterThan(quiet);
  });
});
