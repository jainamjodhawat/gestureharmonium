import { describe, it, expect } from 'vitest';
import { deriveSynthParams } from './controllers';

describe('deriveSynthParams', () => {
  it('keeps the synth audible when a real finger is raised on the left hand', () => {
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
    landmarks[0] = { x: 0.52, y: 0.62, z: 0 };
    landmarks[1] = { x: 0.48, y: 0.58, z: 0 };
    landmarks[4] = { x: 0.42, y: 0.57, z: 0 };
    landmarks[5] = { x: 0.46, y: 0.55, z: 0 };
    landmarks[8] = { x: 0.32, y: 0.24, z: 0 };
    landmarks[9] = { x: 0.40, y: 0.53, z: 0 };
    landmarks[12] = { x: 0.5, y: 0.6, z: 0 };
    landmarks[13] = { x: 0.52, y: 0.57, z: 0 };
    landmarks[16] = { x: 0.58, y: 0.6, z: 0 };
    landmarks[17] = { x: 0.56, y: 0.55, z: 0 };
    landmarks[20] = { x: 0.6, y: 0.62, z: 0 };

    const params = deriveSynthParams({
      hands: [
        {
          handedness: 'Left',
          confidence: 0.9,
          landmarks,
        },
      ],
      timestamp: 123,
    });

    expect(params.handsDetected).toBe(true);
    expect(params.fingerStates.filter(Boolean).length).toBeGreaterThan(0);
    expect(params.bellowsScalar).toBeGreaterThan(0.1);
  });

  it('keeps weak right-hand detection above the silent floor', () => {
    const params = deriveSynthParams({
      hands: [
        {
          handedness: 'Right',
          confidence: 0.9,
          landmarks: Array.from({ length: 21 }, (_, idx) => ({
            x: idx < 4 ? 0.2 : idx === 20 ? 0.34 : 0.7,
            y: idx < 4 ? 0.25 : idx === 20 ? 0.3 : 0.65,
            z: 0,
          })),
        },
      ],
      timestamp: 123,
    });

    expect(params.handsDetected).toBe(true);
    expect(params.bellowsScalar).toBeGreaterThan(0.1);
  });
});
