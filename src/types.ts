/**
 * Shared type contracts for the Gesture Harmonium application.
 * These types define the data structures exchanged between the
 * useHandTracking hook, useHarmoniumSynth hook, and React components.
 *
 * Requirements: 14.1, 14.3
 */

// ---------------------------------------------------------------------------
// Landmark and Hand Tracking Contracts (Requirement 14.1)
// ---------------------------------------------------------------------------

/**
 * A single 3D landmark point returned by MediaPipe Hands.
 * All coordinates are normalised to the range [0.0, 1.0] relative to the
 * video frame dimensions, except z which is a depth estimate (positive = away
 * from the camera, not clamped).
 */
export interface Landmark3D {
  /** Horizontal position: 0.0 = left edge, 1.0 = right edge of the video frame */
  x: number;
  /** Vertical position: 0.0 = top edge, 1.0 = bottom edge of the video frame */
  y: number;
  /** Depth estimate relative to the wrist; scale is approximate */
  z: number;
}

/**
 * Handedness label assigned by MediaPipe Hands.
 * Note: MediaPipe mirrors left/right relative to the camera perspective,
 * so "Left" means the user's left hand.
 */
export type Handedness = "Left" | "Right";

/**
 * A single detected hand with handedness classification, confidence score,
 * and an array of exactly 21 landmarks following the MediaPipe Hand Landmark
 * model indices 0–20.
 *
 * Invalid structures (landmarks.length !== 21, handedness outside the union)
 * are rejected before publishing (Requirements 14.6, 14.7).
 */
export interface DetectedHand {
  /** Whether this is the user's left or right hand */
  handedness: Handedness;
  /** MediaPipe handedness confidence score in [0.0, 1.0] */
  confidence: number;
  /** Exactly 21 landmark points; index matches MediaPipe landmark indices 0–20 */
  landmarks: Landmark3D[];
}

/**
 * The payload published by useHandTracking on every processed frame.
 * Contains 0, 1, or 2 detected hands (never more than 2) and a high-resolution
 * timestamp from performance.now() captured at detection time.
 *
 * Serialises to JSON without loss of precision (Requirement 14.2).
 */
export interface HandTrackingResult {
  /** 0–2 detected hands, ordered by MediaPipe confidence (highest first) */
  hands: DetectedHand[];
  /** performance.now() timestamp (ms) at the time of frame detection */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Synth and Audio Contracts (Requirement 14.3)
// ---------------------------------------------------------------------------

/**
 * The current phase of the ADSR amplitude envelope.
 * - "attack"  — envelope is ramping up toward the sustain level
 * - "sustain" — envelope is held at the sustain level
 * - "release" — envelope is ramping down to silence
 */
export type EnvelopeState = "attack" | "sustain" | "release";

/**
 * The parameter object passed to useHarmoniumSynth.updateParams() on every
 * requestAnimationFrame tick. Out-of-range values are clamped (not thrown)
 * by the synth hook before application (Requirement 14.4).
 */
export interface SynthParams {
  /**
   * Target frequency for the Reed_Oscillator_Bank in Hz.
   * Valid range: [20, 2000]. Values outside this range are clamped.
   */
  pitchHz: number;
  /**
   * Normalised bellows expression scalar derived from right-hand palm spread.
   * Valid range: [0.0, 1.0]. Maps to master gain (−60 dB → 0 dB) and LPF
   * cutoff (300 Hz → 8000 Hz) on logarithmic curves (Requirements 7.3, 7.4).
   * Values outside this range are clamped.
   */
  bellowsScalar: number;
  /** Whether any hands are currently detected (used to gate audio output) */
  handsDetected: boolean;
  /** Finger notes on the right hand: index 0-4 for fingers, true if extended */
  fingerStates: boolean[];

  /** Desired ADSR envelope phase (drives triggerAttack / triggerRelease on the synth) */
  envelopeState: EnvelopeState;
}

/**
 * ADSR envelope parameter set for the Synth_Engine's AmplitudeEnvelope node.
 * All time values are in seconds. Bounds are enforced by
 * useHarmoniumSynth.setEnvelopeParams(); out-of-bounds updates return an Error
 * and leave previous values intact (Requirement 8.5, 8.6).
 *
 * Defaults: attack = 0.08 s, decay = 0.1 s, sustain = 0.85, release = 1.2 s.
 */
export interface ADSRParams {
  /** Attack time in seconds. Valid range: [0.001, 5] (i.e., 1 ms – 5000 ms) */
  attack: number;
  /** Decay time in seconds. Valid range: [0.001, 5] (i.e., 1 ms – 5000 ms) */
  decay: number;
  /** Sustain level on a linear amplitude scale. Valid range: [0.0, 1.0] */
  sustain: number;
  /** Release time in seconds. Valid range: [0.001, 10] (i.e., 1 ms – 10000 ms) */
  release: number;
}

// ---------------------------------------------------------------------------
// Internal Smoothing State (used inside useHandTracking)
// ---------------------------------------------------------------------------

/**
 * Internal EMA smoothing state maintained inside useHandTracking.
 * Tracks the smoothed positions of landmarks used by the Pitch_Controller
 * and Bellows_Controller. All fields are null until the first detection event.
 *
 * On first detection or re-detection after loss, prev values are seeded with
 * the first raw reading to avoid a spurious ramp from zero (Requirements 11.4, 11.7).
 */
export interface SmoothedState {
  /** Smoothed position of the left wrist (landmark index 0) */
  leftWrist: Landmark3D | null;
  /** Smoothed position of the right thumb tip (landmark index 4) */
  rightThumbTip: Landmark3D | null;
  /** Smoothed position of the right pinky tip (landmark index 20) */
  rightPinkyTip: Landmark3D | null;
  /** Previous smoothed scalar values used as the EMA prior for the next frame */
  prevSmoothed: {
    /** Previous smoothed normalised Y of the left wrist; range [0.0, 1.0] */
    leftWristY: number;
    /** Previous smoothed palm spread scalar; range [0.0, 1.0] */
    palmSpread: number;
  };
}

// ---------------------------------------------------------------------------
// Application State
// ---------------------------------------------------------------------------

/**
 * Top-level lifecycle state of the App component.
 * - "idle"     — no subsystems active; "Start Harmonium" button is shown
 * - "starting" — subsystems are initialising; button is disabled
 * - "running"  — all subsystems active; "Stop" button is shown
 * - "stopping" — subsystems are shutting down; button is disabled
 */
export type AppState = "idle" | "starting" | "running" | "stopping";

/**
 * Visual state for each indicator in the StatusPanel (Requirement 9).
 * - "active"   — subsystem is live (green filled dot)
 * - "inactive" — subsystem is stopped or not yet started (grey unfilled dot)
 * - "error"    — subsystem has reported a failure (red alert icon)
 * - "loading"  — subsystem status not yet determined (grey unfilled dot)
 */
export type IndicatorState = "active" | "inactive" | "error" | "loading";
