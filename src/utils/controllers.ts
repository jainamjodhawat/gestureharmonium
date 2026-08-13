/**
 * Pure utility functions for the Gesture Harmonium pitch and bellows controllers.
 *
 * All functions are side-effect-free and have no dependencies on React, the DOM,
 * or any browser APIs. They can be tested in isolation with property-based tests.
 *
 * Requirements: 6.3, 6.6, 7.1, 7.2, 11.3
 */

import type { HandTrackingResult, SynthParams, EnvelopeState } from "../types";

// ---------------------------------------------------------------------------
// Pitch Controller Utilities
// ---------------------------------------------------------------------------

/**
 * Maps a normalised Y coordinate to the nearest MIDI note.
 *
 * 0.0 = top of frame → C5
 * 1.0 = bottom of frame → C3
 */
export function normYToMidi(normY: number): number {
  const raw = 72 - Math.round(normY * 24);
  return Math.min(72, Math.max(48, raw));
}

/**
 * Converts a MIDI note number to frequency in Hz.
 */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Bellows Controller Utilities
// ---------------------------------------------------------------------------

/**
 * Computes Euclidean distance between two 2D points.
 */
export function euclidean2D(
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

/**
 * Converts palm spread into a scalar between 0 and 1.
 */
export function normalisePalmSpread(raw: number): number {
  return Math.min(1.0, Math.max(0.0, raw / 0.4));
}

/**
 * Computes average distance between all tracked landmarks.
 */
export function averageHandSpread(hand: {
  landmarks: { x: number; y: number }[];
}): number {
  const landmarks = hand.landmarks;

  if (landmarks.length < 2) return 0;

  let total = 0;
  let count = 0;

  for (let i = 0; i < landmarks.length; i++) {
    for (let j = i + 1; j < landmarks.length; j++) {
      total += euclidean2D(
        landmarks[i].x,
        landmarks[i].y,
        landmarks[j].x,
        landmarks[j].y
      );

      count += 1;
    }
  }

  return count > 0 ? total / count : 0;
}

// ---------------------------------------------------------------------------
// Finger Detection Utilities
// ---------------------------------------------------------------------------

export function countExtendedFingers(hand: {
  landmarks: { x: number; y: number }[];
}): number {
  const fingerPairs = [
    [4, 1],
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17],
  ] as const;

  return fingerPairs.reduce((count, [tipIndex, baseIndex]) => {
    const tip = hand.landmarks[tipIndex];
    const base = hand.landmarks[baseIndex];

    if (!tip || !base) return count;

    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const distance = Math.hypot(dx, dy);

    const isRaised =
      distance > 0.09 &&
      tip.y < base.y - 0.02;

    return count + (isRaised ? 1 : 0);
  }, 0);
}

/**
 * Returns the raised/not-raised state of:
 *
 * [thumb, index, middle, ring, pinky]
 */
export function getFingerStates(hand: {
  landmarks: { x: number; y: number }[];
}): boolean[] {
  const fingerPairs = [
    [4, 1],
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17],
  ] as const;

  return fingerPairs.map(([tipIndex, baseIndex]) => {
    const tip = hand.landmarks[tipIndex];
    const base = hand.landmarks[baseIndex];

    if (!tip || !base) return false;

    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const distance = Math.hypot(dx, dy);

    return (
      distance > 0.09 &&
      tip.y < base.y - 0.02
    );
  });
}

// ---------------------------------------------------------------------------
// Legacy / Utility Pitch Functions
// ---------------------------------------------------------------------------

export function fingerCountToPitch(count: number): number {
  const notes = [
    130.81,
    146.83,
    164.81,
    196.0,
    220.0,
    261.63,
  ];

  const index = Math.min(
    notes.length - 1,
    Math.max(0, count)
  );

  return notes[index];
}

export function fingerNoteForIndex(
  index: number,
  side: "left" | "right"
): number {
  const notes =
    side === "left"
      ? [130.81, 164.81, 196.0, 220.0, 261.63]
      : [146.83, 174.61, 220.0, 246.94, 293.66];

  return notes[
    Math.max(0, Math.min(notes.length - 1, index))
  ];
}

export function activeFingerTone(
  hand: { landmarks: { x: number; y: number }[] },
  side: "left" | "right"
) {
  const states = getFingerStates(hand);

  let activeIndex = -1;

  // Pinky wins if multiple fingers are raised.
  for (let i = states.length - 1; i >= 0; i -= 1) {
    if (states[i]) {
      activeIndex = i;
      break;
    }
  }

  if (activeIndex < 0) {
    return {
      pitchHz: 261.63,
      volume: 0.15,
    };
  }

  const pitchHz = fingerNoteForIndex(
    activeIndex,
    side
  );

  const volume = 0.2 + (activeIndex + 1) * 0.15;

  return {
    pitchHz,
    volume: Math.min(1, volume),
  };
}

// ---------------------------------------------------------------------------
// Smoothing Filter Utility
// ---------------------------------------------------------------------------

export function ema(
  raw: number,
  prev: number,
  alpha: number
): number {
  return alpha * raw + (1 - alpha) * prev;
}

// ---------------------------------------------------------------------------
// TWO-HAND MAPPING
// ---------------------------------------------------------------------------
//
// RIGHT HAND = selects the sound/note
// LEFT HAND  = continuously shapes pitch + volume
//
// Right-hand fingers:
//   Thumb  → C4
//   Index  → D4
//   Middle → E4
//   Ring   → G4
//   Pinky  → A4
//
// Left-hand wrist height:
//   Top    → +1 octave
//   Center → original pitch
//   Bottom → -1 octave
//
// Left-hand thumb ↔ pinky spread:
//   Closed → quiet
//   Open   → louder
// ---------------------------------------------------------------------------

/** Hand that selects the discrete note. */
const SOUND_HAND: "Left" | "Right" = "Right";

/** Hand that continuously controls pitch and volume. */
const MODULATOR_HAND: "Left" | "Right" = "Left";

/**
 * Base note for each finger on the SOUND_HAND.
 *
 * Order:
 *   0 = thumb
 *   1 = index
 *   2 = middle
 *   3 = ring
 *   4 = pinky
 */
const SOUND_NOTES = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.0,  // G4
  440.0,  // A4
];

/**
 * Main stateless mapping.
 *
 * RIGHT HAND selects the note.
 * LEFT HAND bends pitch and controls volume.
 */
export function deriveSynthParams(
  result: HandTrackingResult
): SynthParams {
  const soundHand = result.hands.find(
    (h) => h.handedness === SOUND_HAND
  );

  const modHand = result.hands.find(
    (h) => h.handedness === MODULATOR_HAND
  );

  // ---------------------------------------------------------
  // 1. Read fingers from the SOUND HAND
  // ---------------------------------------------------------

  const soundStates = soundHand
    ? getFingerStates(soundHand)
    : [false, false, false, false, false];

  const anyFingerActive = soundStates.some(Boolean);

  console.log(
    `👉 [DERIVE] Sound hand (${SOUND_HAND}): ${
      soundHand ? "detected" : "none"
    }, active: ${anyFingerActive}. Modulator hand (${MODULATOR_HAND}): ${
      modHand ? "detected" : "none"
    }`
  );

  // ---------------------------------------------------------
  // 2. No sound finger = silence
  // ---------------------------------------------------------

  if (!anyFingerActive) {
    return {
      pitchHz: 261.63,
      bellowsScalar: 0,
      handsDetected: false,
      fingerStates: [
        false,
        false,
        false,
        false,
        false,
      ],
      envelopeState: "sustain",
    };
  }

  // ---------------------------------------------------------
  // 3. Find which sound finger is active
  //
  // If multiple fingers are raised,
  // the pinky wins.
  // ---------------------------------------------------------

  let activeIndex = -1;

  for (
    let i = soundStates.length - 1;
    i >= 0;
    i -= 1
  ) {
    if (soundStates[i]) {
      activeIndex = i;
      break;
    }
  }

  // Safety fallback.
  if (activeIndex < 0) {
    return {
      pitchHz: 261.63,
      bellowsScalar: 0,
      handsDetected: false,
      fingerStates: [
        false,
        false,
        false,
        false,
        false,
      ],
      envelopeState: "sustain",
    };
  }

  // ---------------------------------------------------------
  // 4. Select the base note from the SOUND_HAND
  // ---------------------------------------------------------

  const baseHz = SOUND_NOTES[activeIndex];

  // ---------------------------------------------------------
  // 5. MODULATOR HAND controls pitch + volume
  // ---------------------------------------------------------

  let pitchMultiplier = 1;
  let volumeScalar = 0.6;

  if (modHand) {
    // -------------------------------------------------------
    // Pitch:
    // wrist Y controls ±1 octave.
    //
    // wristY = 0.0 → +12 semitones
    // wristY = 0.5 →  0 semitones
    // wristY = 1.0 → -12 semitones
    // -------------------------------------------------------

    const wristY = modHand.landmarks[0].y;

    const semitoneOffset =
      (0.5 - wristY) * 24;

    pitchMultiplier = Math.pow(
      2,
      semitoneOffset / 12
    );

    // -------------------------------------------------------
    // Volume:
    // thumb tip ↔ pinky tip distance
    // controls volume.
    // -------------------------------------------------------

    const thumb = modHand.landmarks[4];
    const pinky = modHand.landmarks[20];

    const spread = normalisePalmSpread(
      euclidean2D(
        thumb.x,
        thumb.y,
        pinky.x,
        pinky.y
      )
    );

    volumeScalar = Math.min(
      1,
      Math.max(0.12, spread)
    );
  }

  // ---------------------------------------------------------
  // 6. Final pitch
  // ---------------------------------------------------------

  const pitchHz = Math.min(
    2000,
    Math.max(
      20,
      baseHz * pitchMultiplier
    )
  );

  console.log(
    `👉 [DERIVE] Note: ${baseHz.toFixed(
      2
    )} Hz (finger ${activeIndex}), pitch-bent: ${pitchHz.toFixed(
      2
    )} Hz, volume: ${volumeScalar.toFixed(3)}`
  );

  return {
    pitchHz,
    bellowsScalar: volumeScalar,
    handsDetected: true,
    fingerStates: soundStates,
    envelopeState: "sustain",
  };
}

// ---------------------------------------------------------------------------
// Stateful factory: envelope state management
// ---------------------------------------------------------------------------
//
// IMPORTANT:
// This wrapper now uses the NEW two-hand mapping above.
//
// It preserves the existing envelope behavior:
//   hand present       → sustain
//   absent > 500 ms   → release
//   re-detected       → attack
// ---------------------------------------------------------------------------

export function createSynthParamsDeriver() {
  let lastSoundHandSeenAt: number | null = null;

  let currentEnvelopeState: EnvelopeState =
    "sustain";

  /**
   * Stateful derive function.
   */
  return function derive(
    result: HandTrackingResult,
    now: number = performance.now()
  ): SynthParams {
    const soundHand = result.hands.find(
      (h) => h.handedness === SOUND_HAND
    );

    // ---------------------------------------------------------
    // Envelope state management
    // ---------------------------------------------------------

    if (soundHand) {
      if (currentEnvelopeState === "release") {
        // Hand came back while releasing.
        currentEnvelopeState = "attack";
      } else {
        currentEnvelopeState = "sustain";
      }

      lastSoundHandSeenAt = now;
    } else {
      const absentMs =
        lastSoundHandSeenAt !== null
          ? now - lastSoundHandSeenAt
          : Infinity;

      if (absentMs > 500) {
        currentEnvelopeState = "release";
      }
    }

    // ---------------------------------------------------------
    // Get the NEW two-hand sound mapping.
    // ---------------------------------------------------------

    const params = deriveSynthParams(result);

    // ---------------------------------------------------------
    // Update the envelope state produced by this wrapper.
    // ---------------------------------------------------------

    return {
      ...params,
      envelopeState: currentEnvelopeState,
    };
  };
}