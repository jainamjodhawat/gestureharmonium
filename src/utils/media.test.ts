import { describe, it, expect } from 'vitest';
import { getMediaDeviceStatus } from './media';

describe('getMediaDeviceStatus', () => {
  it('reports camera and audio as unavailable when no devices are present', () => {
    const status = getMediaDeviceStatus({
      hasGetUserMedia: false,
      hasAudioContext: false,
      videoDevices: [],
      audioDevices: [],
    });

    expect(status.cameraAvailable).toBe(false);
    expect(status.audioAvailable).toBe(false);
    expect(status.audioContextSupported).toBe(false);
  });

  it('reports camera and audio as available when the browser exposes devices', () => {
    const status = getMediaDeviceStatus({
      hasGetUserMedia: true,
      hasAudioContext: true,
      videoDevices: [{ kind: 'videoinput' }],
      audioDevices: [{ kind: 'audioinput' }],
    });

    expect(status.cameraAvailable).toBe(true);
    expect(status.audioAvailable).toBe(true);
    expect(status.audioContextSupported).toBe(true);
  });
});
