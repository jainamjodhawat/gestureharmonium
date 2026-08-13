export interface MediaDeviceStatus {
  cameraAvailable: boolean;
  audioAvailable: boolean;
  audioContextSupported: boolean;
  hasGetUserMedia: boolean;
}

export interface MediaDeviceCheckInput {
  hasGetUserMedia: boolean;
  hasAudioContext: boolean;
  videoDevices?: Array<{ kind?: string }>;
  audioDevices?: Array<{ kind?: string }>;
}

export function getMediaDeviceStatus(input: MediaDeviceCheckInput): MediaDeviceStatus {
  const videoDevices = input.videoDevices ?? [];
  const audioDevices = input.audioDevices ?? [];

  const cameraAvailable = input.hasGetUserMedia && videoDevices.some((device) => device.kind === 'videoinput');
  const audioAvailable = input.hasAudioContext && audioDevices.some((device) => device.kind === 'audioinput');

  return {
    cameraAvailable,
    audioAvailable,
    audioContextSupported: input.hasAudioContext,
    hasGetUserMedia: input.hasGetUserMedia,
  };
}
