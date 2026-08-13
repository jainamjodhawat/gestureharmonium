import { useCallback, useEffect, useRef, useState } from "react";
import type { HandTrackingResult, SmoothedState } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseHandTrackingOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  /** EMA smoothing factor. Default 0.3. Valid range: [0.1, 1.0] */
  smoothingAlpha?: number;
}

export type TrackingStatus = "idle" | "initialising" | "running" | "error";

export interface UseHandTrackingReturn {
  resultRef: React.MutableRefObject<HandTrackingResult>;
  status: TrackingStatus;
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
  setSmoothingAlpha: (alpha: number) => void;
}

// ---------------------------------------------------------------------------
// Minimal structural types for MediaPipe instances (avoids importing @mediapipe types directly)
// ---------------------------------------------------------------------------

interface HandsInstance {
  setOptions: (opts: object) => void;
  onResults: (cb: (r: unknown) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close: () => Promise<void>;
}

interface CameraInstance {
  start: () => Promise<void>;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the MediaPipe Hands lifecycle: initialisation, per-frame processing,
 * EMA smoothing, and publishing of HandTrackingResult to resultRef.
 *
 * Requirements: 2.1, 2.2
 */
export function useHandTracking({
  videoRef,
  smoothingAlpha = 0.3,
}: UseHandTrackingOptions): UseHandTrackingReturn {
  // ---- state ---------------------------------------------------------------
  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---- refs ----------------------------------------------------------------

  /** Latest published hand-tracking result; updated every frame without re-render */
  const resultRef = useRef<HandTrackingResult>({ hands: [], timestamp: 0 });

  /** EMA smoothing state; fully internal to this hook */
  const smoothedRef = useRef<SmoothedState>({
    leftWrist: null,
    rightThumbTip: null,
    rightPinkyTip: null,
    prevSmoothed: { leftWristY: 0, palmSpread: 0 },
  });

  /** Mutable alpha so setSmoothingAlpha takes effect within the next frame */
  const alphaRef = useRef<number>(smoothingAlpha);

  /** MediaPipe Hands instance — structurally typed to avoid direct @mediapipe type imports */
  const handsRef = useRef<HandsInstance | null>(null);

  /** MediaPipe Camera instance — structurally typed */
  const cameraRef = useRef<CameraInstance | null>(null);

  // ---- callbacks -----------------------------------------------------------

  /**
   * Receives raw MediaPipe Hands results, validates structures, applies EMA
   * smoothing to wrist/palm-spread coordinates, and writes a HandTrackingResult
   * to resultRef without triggering a React re-render.
   *
   * Requirements: 2.2, 2.5, 2.7, 11.1, 11.2, 11.3, 11.4, 11.7, 14.6, 14.7
   */
  const handleResults = useCallback((results: unknown): void => {
    const raw = results as {
      multiHandLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
      multiHandedness?: Array<{ label: string; score: number }>;
    };

    const landmarks = raw.multiHandLandmarks ?? [];
    const handedness = raw.multiHandedness ?? [];

    // ------------------------------------------------------------------
    // Step 1: Build DetectedHand array with validation (Req 14.6, 14.7, 2.7)
    // ------------------------------------------------------------------
    let detectedHands: import("../types").DetectedHand[] = [];

    for (let i = 0; i < Math.min(landmarks.length, handedness.length); i++) {
      const lms = landmarks[i];
      const hand = handedness[i];

      // Req 14.6: reject if not exactly 21 landmarks
      if (!lms || lms.length !== 21) continue;

      // Req 14.7: reject if invalid handedness
      const label = hand?.label;
      if (label !== "Left" && label !== "Right") continue;

      detectedHands.push({
        handedness: label as "Left" | "Right",
        confidence: hand.score,
        landmarks: lms.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z })),
      });
    }

    // Req 2.7: keep top-2 by confidence
    if (detectedHands.length > 2) {
      detectedHands = detectedHands
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 2);
    }

    const alpha = alphaRef.current;
    const smoothed = smoothedRef.current;

    // ------------------------------------------------------------------
    // Step 2: Apply EMA smoothing (Req 11.1–11.7)
    // ------------------------------------------------------------------
    const leftHand = detectedHands.find((h) => h.handedness === "Left");
    const rightHand = detectedHands.find((h) => h.handedness === "Right");

    if (leftHand) {
      const rawWrist = leftHand.landmarks[0];
      if (smoothed.leftWrist === null) {
        // Req 11.4: cold-start seed — initialise prev to first raw reading
        smoothed.prevSmoothed.leftWristY = rawWrist.y;
        smoothed.leftWrist = { ...rawWrist };
      }
      // Apply EMA to wrist Y (Req 11.3)
      const smoothedY =
        alpha * rawWrist.y + (1 - alpha) * smoothed.prevSmoothed.leftWristY;
      smoothed.prevSmoothed.leftWristY = smoothedY;
      smoothed.leftWrist = { x: rawWrist.x, y: smoothedY, z: rawWrist.z };
      // Replace the landmark entry with the smoothed wrist
      leftHand.landmarks[0] = smoothed.leftWrist;
    } else if (smoothed.leftWrist !== null) {
      // Req 11.7: clear state so re-detection seeds fresh
      smoothed.leftWrist = null;
    }

    if (rightHand) {
      const rawThumb = rightHand.landmarks[4];
      const rawPinky = rightHand.landmarks[20];

      if (smoothed.rightThumbTip === null) {
        // Req 11.4: cold-start seed for palm-spread landmarks
        const rawSpread = Math.sqrt(
          (rawPinky.x - rawThumb.x) ** 2 + (rawPinky.y - rawThumb.y) ** 2
        );
        smoothed.prevSmoothed.palmSpread = rawSpread;
        smoothed.rightThumbTip = { ...rawThumb };
        smoothed.rightPinkyTip = { ...rawPinky };
      }

      // Apply EMA to thumb-tip and pinky-tip x/y (Req 11.2, 11.3)
      const smoothThumbX =
        alpha * rawThumb.x +
        (1 - alpha) * (smoothed.rightThumbTip?.x ?? rawThumb.x);
      const smoothThumbY =
        alpha * rawThumb.y +
        (1 - alpha) * (smoothed.rightThumbTip?.y ?? rawThumb.y);
      const smoothPinkyX =
        alpha * rawPinky.x +
        (1 - alpha) * (smoothed.rightPinkyTip?.x ?? rawPinky.x);
      const smoothPinkyY =
        alpha * rawPinky.y +
        (1 - alpha) * (smoothed.rightPinkyTip?.y ?? rawPinky.y);

      smoothed.rightThumbTip = {
        x: smoothThumbX,
        y: smoothThumbY,
        z: rawThumb.z,
      };
      smoothed.rightPinkyTip = {
        x: smoothPinkyX,
        y: smoothPinkyY,
        z: rawPinky.z,
      };

      rightHand.landmarks[4] = smoothed.rightThumbTip;
      rightHand.landmarks[20] = smoothed.rightPinkyTip;

      // Update palm-spread scalar for reference (not used directly here)
      const newSpread = Math.sqrt(
        (smoothPinkyX - smoothThumbX) ** 2 +
          (smoothPinkyY - smoothThumbY) ** 2
      );
      smoothed.prevSmoothed.palmSpread = newSpread;
    } else if (smoothed.rightThumbTip !== null) {
      // Req 11.7: clear state so re-detection seeds fresh
      smoothed.rightThumbTip = null;
      smoothed.rightPinkyTip = null;
    }

    // ------------------------------------------------------------------
    // Step 3: Publish result — write to ref, NOT setState (avoids 60 fps re-renders)
    // ------------------------------------------------------------------
    resultRef.current = {
      hands: detectedHands,
      timestamp: performance.now(),
    };
  }, []);

  /**
   * Initialises MediaPipe Hands and the MediaPipe Camera utility, then starts
   * streaming frames from the video element.
   *
   * Requirements: 1.1, 2.1, 13.2
   */
  const start = useCallback(async (): Promise<void> => {
    if (!videoRef.current) {
      const msg = "Video element is not ready";
      setErrorMessage(msg);
      setStatus("error");
      throw new Error(msg);
    }
    setStatus("initialising");
    setErrorMessage(null);

    const loadScript = (src: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
          if (existing.dataset.loaded === "true") {
            resolve();
            return;
          }
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.crossOrigin = "anonymous";
        script.addEventListener("load", () => {
          script.dataset.loaded = "true";
          resolve();
        }, { once: true });
        script.addEventListener("error", () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
        document.head.appendChild(script);
      });

    try {
      let HandsClass: new (config: { locateFile: (file: string) => string }) => HandsInstance;
      try {
        const handsUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js";
        await loadScript(handsUrl);
        HandsClass = (window as typeof window & { Hands?: typeof HandsClass }).Hands as unknown as typeof HandsClass;

        if (!HandsClass) {
          throw new Error("@mediapipe/hands did not expose a valid constructor");
        }
      } catch (e) {
        const isNetworkError =
          e instanceof TypeError && (e as TypeError).message.includes("Failed to fetch");
        const msg = isNetworkError
          ? "Failed to load MediaPipe: network error loading WASM files"
          : `Failed to load MediaPipe: ${e instanceof Error ? e.message : String(e)}`;
        setErrorMessage(msg);
        setStatus("error");
        throw new Error(msg);
      }

      const hands = new HandsClass({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(handleResults);
      handsRef.current = hands;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      cameraRef.current = {
        start: async () => {
          if (videoRef.current && handsRef.current) {
            await handsRef.current.send({ image: videoRef.current });
          }
        },
        stop: () => {
          stream.getTracks().forEach((track) => track.stop());
          if (videoRef.current) {
            videoRef.current.srcObject = null;
          }
        },
      };

      const renderFrame = async () => {
        if (!videoRef.current || !handsRef.current) {
          return;
        }

        try {
          const frameStart = performance.now();
          await handsRef.current.send({ image: videoRef.current });
          if (performance.now() - frameStart < 50) {
            requestAnimationFrame(() => {
              void renderFrame();
            });
          } else {
            requestAnimationFrame(() => {
              void renderFrame();
            });
          }
        } catch {
          // Ignore frame failures and keep the camera loop alive.
        }
      };

      void renderFrame();
      setStatus("running");
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const permissionDenied =
        /NotAllowedError|Permission denied|permission.*camera|camera.*denied|denied.*camera|The request is not allowed/i.test(rawMessage) ||
        (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "NotAllowedError");

      const wasmInitIssue = /Module\.arguments|arguments_/.test(rawMessage);

      const friendlyMessage = permissionDenied
        ? "Camera access was blocked. Please click Start Harmonium again and allow camera access when the browser asks for permission."
        : wasmInitIssue
          ? "MediaPipe failed to initialise its WebAssembly module. Restart the dev server and reload the page so Vite can load the camera/hand model correctly."
          : rawMessage;

      setErrorMessage((prev) => {
        if (prev === null) {
          return friendlyMessage;
        }
        return prev;
      });
      setStatus("error");
      throw new Error(friendlyMessage);
    }
  }, [videoRef, handleResults]);

  /**
   * Stops the camera stream and closes the MediaPipe Hands model, releasing
   * all associated resources.
   *
   * Requirements: 2.6, 4.4
   */
  const stop = useCallback((): void => {
    cameraRef.current?.stop();
    void handsRef.current?.close();
    cameraRef.current = null;
    handsRef.current = null;
    setStatus("idle");
  }, []);

  /**
   * Updates the EMA smoothing factor. The new alpha takes effect on the very
   * next processed frame without requiring a restart.
   *
   * @param alpha - New alpha value; clamped to [0.1, 1.0] (Requirement 11.5).
   */
  const setSmoothingAlpha = useCallback((alpha: number): void => {
    alphaRef.current = Math.min(1.0, Math.max(0.1, alpha));
  }, []);

  // ---- cleanup -------------------------------------------------------------

  /** Release MediaPipe resources on unmount (Requirement 2.6) */
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  // ---- return --------------------------------------------------------------

  return {
    resultRef,
    status,
    errorMessage,
    start,
    stop,
    setSmoothingAlpha,
  };
}
