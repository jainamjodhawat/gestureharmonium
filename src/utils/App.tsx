import { useState, useRef, useEffect, useCallback } from 'react';
import { useHandTracking } from './hooks/useHandTracking';
import { useHarmoniumSynth } from './hooks/useHarmoniumSynth';
import CameraView from './components/CameraView';
import LandmarkOverlay from './components/LandmarkOverlay';
import StatusPanel from './components/StatusPanel';
import StartStopButton from './components/StartStopButton';
import { countExtendedFingers, deriveSynthParams } from './utils/controllers';
import { getMediaDeviceStatus } from './utils/media';
import { AppState, IndicatorState } from './types';

async function getDeviceAvailability() {
  const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);
  const hasAudioContext = Boolean(
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );

  let videoDevices: Array<{ kind?: string }> = [];
  let audioDevices: Array<{ kind?: string }> = [];

  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
    videoDevices = devices.filter((device) => device.kind === 'videoinput');
    audioDevices = devices.filter((device) => device.kind === 'audioinput');
  } catch {
    // Some browsers or runtime environments restrict enumeration without permission.
  }

  return getMediaDeviceStatus({
    hasGetUserMedia,
    hasAudioContext,
    videoDevices,
    audioDevices,
  });
}

function getDeviceAvailabilitySync() {
  return getMediaDeviceStatus({
    hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    hasAudioContext: Boolean(
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ),
    videoDevices: [],
    audioDevices: [],
  });
}

// MediaPipe hand connection topology pairs
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16], // Ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20] // Pinky
];

export function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [handCounts, setHandCounts] = useState({ left: 0, right: 0 });

  const videoRef = useRef<HTMLVideoElement>(null!);
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const rafRef = useRef<number | null>(null);

  // Instantiating custom hooks
  const handTracking = useHandTracking({ videoRef });
  const synth = useHarmoniumSynth();

  // Browser feature check on mount
  useEffect(() => {
    void (async () => {
      const mediaStatus = await getDeviceAvailability();

      if (!mediaStatus.hasGetUserMedia) {
        setErrorMessage('A modern browser with camera API support is required.');
        return;
      }

      if (!mediaStatus.cameraAvailable) {
        setErrorMessage('No camera device was detected. Please connect a camera and refresh the page.');
        return;
      }

      if (!mediaStatus.audioContextSupported) {
        setErrorMessage('This browser does not support Web Audio; audio output cannot start.');
      }
    })();
  }, []);

  // Main render loop for smooth 60fps tracking & synthesis updates
  const tick = useCallback(() => {
    const result = handTracking.resultRef.current;

    const cameraLeftHand = result.hands
      .filter((hand) => hand.landmarks[0]?.x >= 0.5)
      .sort((a, b) => b.landmarks[0].x - a.landmarks[0].x)[0];
    const cameraRightHand = result.hands
      .filter((hand) => hand.landmarks[0]?.x < 0.5)
      .sort((a, b) => a.landmarks[0].x - b.landmarks[0].x)[0];

    const leftCount = cameraLeftHand ? countExtendedFingers(cameraLeftHand) : 0;
    const rightCount = cameraRightHand ? countExtendedFingers(cameraRightHand) : 0;

    setHandCounts((prev) => {
      if (prev.left === leftCount && prev.right === rightCount) {
        return prev;
      }
      return { left: leftCount, right: rightCount };
    });

    // 1. Audio update
    const params = deriveSynthParams(result);
    console.log("⏱️ [TICK] Calling synth.updateParams() with:", params);
    synth.updateParams(params);

    // 2. Visual Landmark drawing on overlay canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (result.hands && result.hands.length > 0) {
          result.hands.forEach((hand) => {
            const isLeft = hand.handedness === 'Left';
            const color = isLeft ? '#4ADE80' : '#60A5FA'; // Green for left hand, Blue for right hand

            // Draw connection lines
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            HAND_CONNECTIONS.forEach(([i, j]) => {
              const p1 = hand.landmarks[i];
              const p2 = hand.landmarks[j];
              if (p1 && p2) {
                // Invert X because camera view is mirrored
                ctx.beginPath();
                ctx.moveTo((1 - p1.x) * canvas.width, p1.y * canvas.height);
                ctx.lineTo((1 - p2.x) * canvas.width, p2.y * canvas.height);
                ctx.stroke();
              }
            });

            // Draw landmark dots
            ctx.fillStyle = '#FFFFFF';
            hand.landmarks.forEach((lm) => {
              ctx.beginPath();
              ctx.arc((1 - lm.x) * canvas.width, lm.y * canvas.height, 5, 0, 2 * Math.PI);
              ctx.fill();
            });
          });
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [handTracking.resultRef, synth]);

  // Start gesture tracking & sound engine
  const startAll = async () => {
    setErrorMessage(null);
    setAppState('starting');

    const mediaStatus = getDeviceAvailabilitySync();

    if (!mediaStatus.hasGetUserMedia) {
      const msg = 'A modern browser with camera API support is required.';
      setErrorMessage(msg);
      setAppState('idle');
      return;
    }

    if (!mediaStatus.audioContextSupported) {
      const msg = 'This browser does not support Web Audio; audio output cannot start.';
      setErrorMessage(msg);
      setAppState('idle');
      return;
    }

    try {
      // Keep this in the user gesture before any async work so Tone is allowed to start.
      await synth.start();

      // If camera device enumeration is needed, do it after the audio context has been resumed.
      const deviceStatus = await getDeviceAvailability();
      if (!deviceStatus.cameraAvailable) {
        const msg = 'No camera device was detected. Please connect a camera and refresh the page.';
        setErrorMessage(msg);
        setAppState('idle');
        await synth.stop();
        return;
      }

      // 2. Camera & hand tracking start
      await handTracking.start();

      const liveVideoTracks = videoRef.current?.srcObject && 'getTracks' in videoRef.current.srcObject
        ? (videoRef.current.srcObject as MediaStream).getTracks().filter((track) => track.readyState !== 'ended')
        : [];

      if (!videoRef.current || !videoRef.current.srcObject || liveVideoTracks.length === 0) {
        throw new Error('No live camera stream was detected. Please allow camera access and try again.');
      }

      setAppState('running');
      await synth.playTestTone(350);
      rafRef.current = requestAnimationFrame(tick);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to start Harmonium');
      setAppState('idle');
      stopAll();
    }
  };

  // Stop sound & release camera resources
  const stopAll = async () => {
    setAppState('stopping');

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Safety timeout fallback
    const stopPromise = Promise.all([
      handTracking.stop(),
      synth.stop()
    ]);

    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([stopPromise, timeoutPromise]);

    setAppState('idle');
  };

  // Derive status panel indicators
  const getCameraIndicator = (): IndicatorState => {
    if (appState === 'starting') return 'loading';
    if (handTracking.status === 'running') return 'active';
    if (handTracking.status === 'error') return 'error';
    return 'inactive';
  };

  const getHandsIndicator = (): IndicatorState => {
    if (appState !== 'running') return 'inactive';
    return handTracking.resultRef.current?.hands?.length > 0 ? 'active' : 'inactive';
  };

  const getAudioIndicator = (): IndicatorState => {
    if (appState === 'starting') return 'loading';
    if (synth.status === 'running') return 'active';
    if (synth.status === 'error') return 'error';
    return 'inactive';
  };

  const handleTestAudio = () => {
    synth.playTestTone(700);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      handTracking.stop();
      synth.stop();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-2 sm:p-4">
      <header className="mb-4 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-amber-400">Gesture Harmonium</h1>
        <p className="text-slate-400 text-sm mt-1">
          Left hand controls Pitch • Right hand controls Bellows (Volume & Timbre)
        </p>
      </header>

      {/* Main Container */}
      <main className="relative w-full max-w-[95vw] bg-slate-800 rounded-2xl overflow-hidden shadow-2xl border border-slate-700">
        
        {/* Video & Canvas Frame */}
        <div className="relative aspect-[16/9] w-full max-h-[78vh] bg-black">
          <CameraView videoRef={videoRef} />
          <LandmarkOverlay 
            canvasRef={canvasRef} 
            videoWidth={640} 
            videoHeight={480} 
          />

          <div className="absolute bottom-4 left-4 z-10 w-28 rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-1 text-center shadow-lg">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Left Hand</div>
            <div className="text-lg font-bold text-emerald-400">{handCounts.left}</div>
          </div>

          <div className="absolute bottom-4 right-4 z-10 w-28 rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-1 text-center shadow-lg">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Right Hand</div>
            <div className="text-lg font-bold text-sky-400">{handCounts.right}</div>
          </div>

          {/* Status Overlay Panel */}
          <div className="absolute top-4 left-4 z-10" role="status">
            <StatusPanel
              camera={getCameraIndicator()}
              hands={getHandsIndicator()}
              audio={getAudioIndicator()}
            />
          </div>
        </div>

        {/* Control Footer */}
        <div className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-800">
          <div className="text-xs text-slate-400 max-w-md">
            <p><strong>Left hand:</strong> Move wrist up/down to adjust pitch.</p>
            <p><strong>Right hand:</strong> Open/close thumb & pinky distance to pump the bellows.</p>
          </div>

          <div className="flex items-center gap-3">
            {appState === 'running' && (
              <button
                type="button"
                onClick={handleTestAudio}
                className="relative flex items-center justify-center gap-2 px-5 py-3 rounded-full font-semibold text-white text-sm tracking-wide bg-violet-600 hover:bg-violet-500 active:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 transition-colors duration-200"
              >
                Test Audio
              </button>
            )}
            <StartStopButton
              appState={appState}
              onStart={startAll}
              onStop={stopAll}
            />
          </div>
        </div>
      </main>

      {/* Error Alert Display */}
      {errorMessage && (
        <div role="alert" className="mt-4 p-3 bg-red-900/80 border border-red-500 rounded-lg text-red-200 text-sm max-w-xl text-center">
          <div className="font-medium">{errorMessage}</div>
          {errorMessage.includes("Camera access was blocked") && (
            <p className="mt-2 text-red-100/90">
              If the browser does not show a prompt, refresh the page and click Start again after enabling camera access in your browser settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;