  /**
 * useHarmoniumSynth — Tone.js audio engine hook for the Gesture Harmonium.
 *
 * Responsibilities:
 *  - Construct and own the full Tone.js signal chain (Requirements 4.5, 5.1–5.4)
 *  - Resume the AudioContext only after a user gesture (Requirement 4.1)
 *  - Trigger the envelope into sustain immediately on start (Requirement 8.2)
 *  - Expose updateParams() and setEnvelopeParams() for the rAF loop (Tasks 5.2, 5.3)
 */

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SynthParams, ADSRParams } from "../types";
import { mapBellowsToGain } from "../utils/audio";

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Detune offsets in cents for each oscillator voice (Requirement 5.3) */
const DETUNES = [0, 5, -3, 8, 0, -6] as const;

/**
 * Waveform type per oscillator voice.
 * Mix of triangle + square approximates harmonium reed timbre (Requirement 5.2).
 */
const OSC_TYPES = [
  "triangle",
  "triangle",
  "square",
  "square",
  "triangle",
  "square",
] as const;

/**
 * Frequency multiplier per voice.
 * Voices 4 and 5 are tuned one octave above root to simulate the
 * harmonium's upper register stop (Requirement 5.4).
 */
const OCTAVE_MULTIPLIERS = [1, 1, 1, 1, 2, 2] as const;

/** Default ADSR parameters in seconds / linear amplitude (Requirement 8.1) */
const DEFAULT_ADSR: ADSRParams = {
  attack: 0.08,   // 80 ms
  decay: 0.1,     // 100 ms
  sustain: 0.85,
  release: 1.2,   // 1200 ms
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * References to all Tone.js nodes that make up the signal chain.
 * Stored in a ref so disposal can happen without stale closures.
 */
interface AudioGraph {
  oscillators: Tone.Oscillator[];
  filter: Tone.Filter;
  envelope: Tone.AmplitudeEnvelope;
  masterGain: Tone.Gain;
}

type SynthStatus = "idle" | "initialising" | "running" | "error";

export interface UseHarmoniumSynthReturn {
  status: SynthStatus;
  errorMessage: string | null;
  /** Resume AudioContext and build signal chain. Must be called from a user gesture handler. */
  start: () => Promise<void>;
  /** Tear down signal chain and close AudioContext (Requirements 4.6). */
  stop: () => Promise<void>;
  /** Play one short test tone to validate the live browser audio path. */
  playTestTone: (durationMs?: number) => void;
  /** Apply pitch + bellows parameters to the live graph (Requirements 5.5, 6.4, 7.3–7.5). */
  updateParams: (params: SynthParams) => void;
  /** Validate and apply ADSR parameter overrides (Requirements 8.5, 8.6). */
  setEnvelopeParams: (params: Partial<ADSRParams>) => void | Error;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Custom hook encapsulating the Tone.js audio graph for the Gesture Harmonium.
 *
 * Signal chain (Requirement 4.5):
 *   Reed_Oscillator_Bank (6 voices) → LPF → AmplitudeEnvelope → masterGain → Destination
 */
export function useHarmoniumSynth(): UseHarmoniumSynthReturn {
  const [status, setStatus] = useState<SynthStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** Live Tone.js node graph; null when the synth is stopped. */
  const graphRef = useRef<AudioGraph | null>(null);

  /** Working copy of ADSR params — updated by setEnvelopeParams without rebuild. */
  const adsrRef = useRef<ADSRParams>({ ...DEFAULT_ADSR });

  /** Last applied bellows scalar — used to gate gain/LPF updates to changes ≥ 0.01 (Requirement 7.5). */
  const lastBellowsRef = useRef(0);

  // -------------------------------------------------------------------------
  // start()
  // -------------------------------------------------------------------------

  const start = useCallback(async (): Promise<void> => {
    setStatus("initialising");
    setErrorMessage(null);

    try {
      const context = Tone.getContext();
      const rawContext = context.rawContext as AudioContext | undefined;

      console.log("🎵 [SYNTH] start() called. Initial AudioContext state:", rawContext?.state);

      if (rawContext?.state === "closed") {
        Tone.setContext(new Tone.Context());
        console.log("🎵 [SYNTH] AudioContext was closed, created new Tone.Context()");
      }

      if (rawContext && rawContext.state === "suspended") {
        await rawContext.resume();
        console.log("🎵 [SYNTH] AudioContext resumed from suspended state");
      }

      // Requirement 4.1 — resume AudioContext via explicit user gesture
      await Tone.start();
      console.log("🎵 [SYNTH] Tone.start() completed. New state:", Tone.getContext().state);

      if (Tone.getContext().state !== "running") {
        const msg = "Audio context failed to reach running state after Tone.start()";
        setErrorMessage(msg);
        setStatus("error");
        throw new Error(msg);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Audio context failed to start";
      setErrorMessage(msg);
      setStatus("error");
      throw error;
    }

    // ------------------------------------------------------------------
    // Build signal chain bottom-up (destination → source) so every node
    // has a downstream target before the upstream node connects to it.
    // Requirement 4.5: Reed_Oscillator_Bank → LPF → Envelope → masterGain → Destination
    // ------------------------------------------------------------------

    // Keep the synth silent until a raised finger is actually detected.
    const masterGain = new Tone.Gain(0).toDestination();
    console.log("🎵 [SYNTH] masterGain created with gain 0, connected to destination");

    // ADSR envelope using current (possibly user-adjusted) ADSR params.
    // Requirement 8.1: defaults 80 ms / 100 ms / 0.85 / 1200 ms.
    const envelope = new Tone.AmplitudeEnvelope({
      attack: adsrRef.current.attack,
      decay: adsrRef.current.decay,
      sustain: adsrRef.current.sustain,
      release: adsrRef.current.release,
    }).connect(masterGain);
    console.log("🎵 [SYNTH] envelope created and connected to masterGain");

    // LPF initialised at 300 Hz (bellows scalar = 0.0 initial state, Requirement 7.7).
    const filter = new Tone.Filter(300, "lowpass").connect(envelope);
    console.log("🎵 [SYNTH] filter created (300 Hz LPF) and connected to envelope");

    // Reed_Oscillator_Bank — 6 voices (Requirement 5.1: 4–8 voices).
    // Each voice is a separate Tone.Oscillator connected to the shared filter.
    const oscillators: Tone.Oscillator[] = DETUNES.map((detune, i) => {
      const osc = new Tone.Oscillator({
        type: OSC_TYPES[i] as OscillatorType,
        // All voices start at C4 (261.63 Hz); upper-octave voices (i = 4, 5)
        // start at C5 (523.26 Hz) via the multiplier (Requirement 5.4).
        frequency: 261.63 * OCTAVE_MULTIPLIERS[i],
        detune,
      }).connect(filter);

      // Oscillators must be running before the envelope is triggered.
      osc.start();
      console.log(`🎵 [SYNTH] oscillator ${i} started (type: ${OSC_TYPES[i]}, freq: ${261.63 * OCTAVE_MULTIPLIERS[i]} Hz, detune: ${detune})`);
      return osc;
    });

    // Persist the graph so updateParams / stop can access nodes.
    graphRef.current = { oscillators, filter, envelope, masterGain };

    // Reset bellows tracking to sentinel value so first gain update always triggers
    lastBellowsRef.current = -1;

    setStatus("running");
  }, []);

  // -------------------------------------------------------------------------
  // stop() — full implementation (Task 5.3)
  // -------------------------------------------------------------------------

  const stop = useCallback(async (): Promise<void> => {
    const graph = graphRef.current;

    if (graph) {
      // Trigger release so the envelope decays gracefully before disposal
      // (Requirement 4.6 — no audio resource leaks).
      graph.envelope.triggerRelease(Tone.now());

      // Wait for the release tail to finish (release default is 1200 ms,
      // 1300 ms gives 100 ms headroom for any user-set release up to the
      // default).
      await new Promise<void>((resolve) => setTimeout(resolve, 1300));

      // Dispose every Tone.js node to release Web Audio API resources.
      graph.oscillators.forEach((osc) => {
        osc.stop();
        osc.dispose();
      });
      graph.filter.dispose();
      graph.envelope.dispose();
      graph.masterGain.dispose();

      // Clear the graph ref so updateParams/setEnvelopeParams no-op after stop.
      graphRef.current = null;

      // Reset bellows state so the next start() begins from silence.
      lastBellowsRef.current = 0;
    }

    // Suspend instead of closing so the same AudioContext can be resumed on
    // the next user gesture. Closing it permanently causes "cannot resume closed AudioContext".
    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext | undefined;
      if (rawCtx && rawCtx.state === "running") {
        await rawCtx.suspend();
      }
    } catch {
      // Context was already closed or unavailable; the app can still recover.
    }

    setStatus("idle");
  }, []);

  const playTestTone = useCallback(async (durationMs = 500): Promise<void> => {
    const graph = graphRef.current;
    if (!graph) {
      const msg = "Audio engine is not started yet. Click Start Harmonium first.";
      setErrorMessage(msg);
      return;
    }

    try {
      const rawContext = Tone.getContext().rawContext as AudioContext | undefined;
      if (rawContext && rawContext.state === "suspended") {
        await rawContext.resume();
      }
      if (Tone.getContext().state !== "running") {
        await Tone.start();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Audio test tone could not start";
      setErrorMessage(msg);
      return;
    }

    const now = Tone.now();
    const osc = new Tone.Oscillator(440, "sine");
    const gain = new Tone.Gain(0.14);

    osc.connect(gain);
    gain.connect(graph.masterGain);

    osc.start(now);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000 + 0.05);

    window.setTimeout(() => {
      osc.dispose();
      gain.dispose();
    }, durationMs + 150);
  }, []);

  // -------------------------------------------------------------------------
  // updateParams() — full implementation (Task 5.2)
  // -------------------------------------------------------------------------

  const updateParams = useCallback((params: SynthParams): void => {
    const graph = graphRef.current;
    
    // Guard: Only process if the audio graph exists
    // (The graph is only created after start() completes and audio is initialized)
    if (!graph) {
      console.log("🎵 [UPDATE] Audio graph not initialized yet, skipping update");
      return;
    }

    // Requirement 14.4: clamp inputs to valid ranges before use
    const pitchHz = Math.min(2000, Math.max(20, params.pitchHz));
    const bellows  = Math.min(1.0,  Math.max(0.0, params.bellowsScalar));

    console.log(`🎵 [UPDATE] handsDetected: ${params.handsDetected}, pitch: ${pitchHz.toFixed(2)} Hz, bellows: ${bellows.toFixed(3)}, masterGain: ${graph.masterGain.gain.value.toFixed(3)}`);

    const basePitchHz = params.handsDetected ? pitchHz : 261.63;
    const shiftedPitchHz = basePitchHz;

    graph.oscillators.forEach((osc, i) => {
      const targetHz = shiftedPitchHz * OCTAVE_MULTIPLIERS[i];
      if (targetHz < 27.5 || targetHz > 4186) {
        osc.volume.rampTo(-Infinity, 0.01);
      } else {
        osc.volume.rampTo(0, 0.01);
        osc.frequency.rampTo(targetHz, 0.01);
      }
    });

    if (!params.handsDetected) {
      console.log("🎵 [UPDATE] No hands detected - triggering release");
      graph.envelope.triggerRelease(Tone.now());
      if (graph.masterGain.gain.value > 0.0001) {
        graph.masterGain.gain.rampTo(0, 0.1);
      }
    } else {
      const effectiveBellows = Math.max(0.2, Math.min(1, bellows));
      const shouldUpdate =
        Math.abs(effectiveBellows - lastBellowsRef.current) >= 0.003 ||
        graph.masterGain.gain.value < 0.18;

      if (shouldUpdate) {
        lastBellowsRef.current = effectiveBellows;

        const targetGain = mapBellowsToGain(effectiveBellows);
        console.log(`🎵 [UPDATE] Bellows changed - targetGain: ${targetGain.toFixed(3)}, ramping masterGain from ${graph.masterGain.gain.value.toFixed(3)} to ${targetGain.toFixed(3)}`);
        graph.masterGain.gain.rampTo(targetGain, 0.025);

        const lpfHz = 300 * Math.pow(8000 / 300, effectiveBellows);
        graph.filter.frequency.rampTo(lpfHz, 0.025);
      }

      graph.envelope.triggerAttack(Tone.now());
      console.log(`🎵 [UPDATE] Envelope triggered, hands active. Envelope state will attack.`);
      if (graph.masterGain.gain.value < 0.18) {
        console.log(`🎵 [UPDATE] masterGain below 0.18 threshold (${graph.masterGain.gain.value.toFixed(3)}), ramping to 0.18`);
        graph.masterGain.gain.rampTo(0.18, 0.05);
      }
    }

    if (params.envelopeState === "release") {
      graph.envelope.triggerRelease(Tone.now());
    }
  }, []);

  // -------------------------------------------------------------------------
  // setEnvelopeParams() — full implementation (Task 5.3)
  // -------------------------------------------------------------------------

  const setEnvelopeParams = useCallback(
    (params: Partial<ADSRParams>): void | Error => {
      // Bounds table (Requirement 8.5).
      const BOUNDS: Record<keyof ADSRParams, [number, number]> = {
        attack:  [0.001, 5],
        decay:   [0.001, 5],
        sustain: [0.0,   1.0],
        release: [0.001, 10],
      };

      // Requirement 8.6 — validate ALL supplied params first; reject the
      // entire update if ANY value is out of bounds, leaving prior state intact.
      for (const key of Object.keys(params) as Array<keyof ADSRParams>) {
        const val = params[key];
        if (val === undefined) continue;
        const [min, max] = BOUNDS[key];
        if (val < min || val > max) {
          return new Error(
            `ADSR parameter "${key}" value ${val} is out of range [${min}, ${max}]`,
          );
        }
      }

      // All values are valid — persist them (Requirement 8.5).
      Object.assign(adsrRef.current, params);

      // If the audio graph is live, apply the new values to the envelope node
      // immediately without requiring a full Synth_Engine rebuild.
      const graph = graphRef.current;
      if (graph) {
        graph.envelope.set({
          attack:  adsrRef.current.attack,
          decay:   adsrRef.current.decay,
          sustain: adsrRef.current.sustain,
          release: adsrRef.current.release,
        });
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return { status, errorMessage, start, stop, playTestTone, updateParams, setEnvelopeParams };
}
