# Implementation Plan: Gesture Harmonium

## Overview

Build a browser-based harmonium instrument that maps real-time hand gestures (captured via MediaPipe Hands) to Tone.js audio synthesis inside a React + TypeScript + Vite + Tailwind CSS single-page application. The left hand controls pitch; the right hand controls volume/timbre via a bellows metaphor. Implementation proceeds in dependency order: scaffolding → shared types → pure utilities → hooks → components → App wiring → accessibility/performance hardening → tests.

---

## Tasks

- [x] 1. Scaffold the Vite + React + TypeScript project with Tailwind CSS and install dependencies
  - Run `npm create vite@latest . -- --template react-ts` (or equivalent) to generate the project skeleton
  - Install production dependencies: `tone`, `@mediapipe/hands`, `@mediapipe/camera_utils`
  - Install dev dependencies: `tailwindcss`, `postcss`, `autoprefixer`, `@types/react`, `@types/react-dom`, `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `fast-check`
  - Run `npx tailwindcss init -p` and configure `tailwind.config.js` to scan `./src/**/*.{ts,tsx}`
  - Add Tailwind directives to `src/index.css`
  - Replace default `vite.config.ts` to include `test: { environment: "jsdom", globals: true }`
  - Verify `npm run build` succeeds on the empty scaffold
  - _Requirements: 1.1, 4.1, 10.1_

- [x] 2. Define shared TypeScript types in `src/types.ts`
  - [x] 2.1 Create `src/types.ts` with all shared contracts
    - Export `Landmark3D`, `Handedness`, `DetectedHand`, `HandTrackingResult` exactly as specified in the design
    - Export `EnvelopeState`, `SynthParams`, `ADSRParams`
    - Export `SmoothedState` (internal to the hand-tracking hook but typed here for testability)
    - Export `AppState`, `AppStatus`, `IndicatorState`
    - _Requirements: 14.1, 14.3_

- [x] 3. Implement pure utility functions in `src/utils/controllers.ts`
  - [x] 3.1 Implement `normYToMidi`, `midiToHz`, `euclidean2D`, `normalisePalmSpread`, `ema`
    - `normYToMidi(normY)`: `clamp(72 − round(normY × 24), 48, 72)`
    - `midiToHz(midi)`: `440 × 2^((midi − 69) / 12)`
    - `euclidean2D(ax, ay, bx, by)`: standard Euclidean distance
    - `normalisePalmSpread(raw)`: `clamp(raw / 0.4, 0.0, 1.0)`
    - `ema(raw, prev, alpha)`: `alpha × raw + (1 − alpha) × prev`
    - _Requirements: 6.3, 6.6, 7.1, 7.2, 11.3_
  - [x] 3.2 Implement `deriveSynthParams(result: HandTrackingResult): SynthParams`
    - Extract left-hand wrist Y → `normYToMidi` → `midiToHz` → `pitchHz`; default to C4 (261.63 Hz) when no left hand
    - Extract right-hand thumb tip (landmark 4) and pinky tip (landmark 20) → `euclidean2D` → `normalisePalmSpread` → `bellowsScalar`; default to 0.0 when no right hand
    - Determine `envelopeState`: "attack" when left hand first detected, "release" when absent > 500 ms threshold flag, otherwise "sustain"
    - _Requirements: 6.1, 7.1, 7.7, 14.5_
  - [ ]* 3.3 Write property-based tests for `normYToMidi` and `midiToHz`
    - Use `fast-check`; minimum 100 iterations per property
    - **Property 3 (partial): Full mapping pipeline always produces in-range SynthParams**
    - Test that for any `normY ∈ [0, 1]`, `midiToHz(normYToMidi(normY))` is in [20, 2000]
    - Test that `normYToMidi` always returns a value in [48, 72] for any finite number input
    - **Validates: Requirements 14.5, 6.6**
  - [ ]* 3.4 Write property-based tests for `ema`
    - **Property 4: EMA smoothing is a weighted average**
    - For any `raw`, `prev`, `alpha ∈ [0.1, 1.0]`: result is in `[min(raw, prev), max(raw, prev)]`
    - **Validates: Requirements 11.3**
  - [ ]* 3.5 Write property-based tests for `normalisePalmSpread` and `deriveSynthParams` clamping
    - **Property 2: SynthParams clamping preserves valid range**
    - For any arbitrary pair of numbers as `pitchHz` and `bellowsScalar`, output is in [20, 2000] × [0, 1]
    - **Property 3: Full mapping pipeline always produces in-range SynthParams**
    - Generate arbitrary valid `HandTrackingResult` objects; `deriveSynthParams` output always in range
    - **Validates: Requirements 14.4, 14.5**

- [x] 4. Implement the `useHandTracking` custom hook in `src/hooks/useHandTracking.ts`
  - [x] 4.1 Scaffold hook interface: exports `resultRef`, `status`, `errorMessage`, `start`, `stop`, `setSmoothingAlpha`
    - Wire `useRef` for `resultRef` (initial `{ hands: [], timestamp: 0 }`), `smoothedRef`, `alphaRef`, `handsRef`, `cameraRef`
    - Define `status` state as `"idle" | "initialising" | "running" | "error"`
    - _Requirements: 2.1, 2.2_
  - [x] 4.2 Implement `start()`: dynamic import of `@mediapipe/hands` and `@mediapipe/camera_utils`, construct `Hands` with correct options, attach `onResults`, start `Camera` at 640×480
    - Catch all errors from dynamic import and `camera.start()`; on failure set `status = "error"` and `errorMessage`
    - After successful `camera.start()` set `status = "running"`
    - _Requirements: 1.1, 2.1, 13.2_
  - [x] 4.3 Implement `handleResults(results)`: validation, EMA smoothing, and writing to `resultRef`
    - Validate: reject structures with ≠ 21 landmarks or invalid handedness; cap at top-2 by confidence (Req 2.7)
    - Apply EMA to `leftWrist.y`, `rightThumbTip.{x,y}`, `rightPinkyTip.{x,y}` using `smoothedRef` and `alphaRef`
    - Cold-start / re-detection: seed `prevSmoothed` with first raw value (Req 11.4, 11.7)
    - Run `deriveSynthParams` on smoothed result; write `HandTrackingResult` to `resultRef.current` (no `setState`)
    - _Requirements: 2.2, 2.5, 2.7, 11.1, 11.2, 11.3, 11.4, 11.7, 14.6, 14.7_
  - [x] 4.4 Implement `stop()`, `setSmoothingAlpha()`, and cleanup `useEffect`
    - `stop()`: call `cameraRef.current?.stop()` and `handsRef.current?.close()`; null out refs; set `status = "idle"`
    - `setSmoothingAlpha(alpha)`: clamp to [0.1, 1.0]; write to `alphaRef.current`
    - Return cleanup function from `useEffect` calling `stop()`
    - _Requirements: 2.6, 11.5_
  - [x] 4.5 Add frame timeout guard (50 ms) in `onFrame` callback
    - Record `performance.now()` before `hands.send()`; if elapsed > 50 ms, return early without updating `resultRef`
    - _Requirements: 2.8, 12.5_
  - [ ]* 4.6 Write unit tests for `handleResults` validation logic
    - Test: hand with 20 landmarks is rejected; hand with 22 landmarks is rejected
    - Test: more than 2 hands are reduced to top-2 by confidence
    - Test: invalid handedness value is rejected
    - Test: cold-start seeds `prevSmoothed` with first raw value
    - _Requirements: 2.7, 11.4, 14.6, 14.7_

- [x] 5. Implement the `useHarmoniumSynth` custom hook in `src/hooks/useHarmoniumSynth.ts`
  - [x] 5.1 Build the Tone.js signal chain in `start()`
    - Construct six `Tone.Oscillator` nodes with types `[triangle, triangle, square, square, triangle, square]` and detunes `[0, +5, -3, +8, 0, -6]` cents; connect all to a shared `Tone.Filter`
    - Connect `Filter → AmplitudeEnvelope → masterGain → Tone.getDestination()`; `masterGain` starts at linear ≈ 0.001 (−60 dB)
    - Call `Tone.start()` first to resume `AudioContext`; check `Tone.getContext().state === "running"` and throw with message if not
    - Call `envelope.triggerAttack(Tone.now())` immediately after construction to enter sustain at 0.85 (Req 8.2)
    - Set `status = "running"`
    - _Requirements: 4.1, 4.2, 4.5, 5.1, 5.2, 5.3, 5.4, 8.1, 8.2_
  - [x] 5.2 Implement `updateParams(params: SynthParams)`
    - Clamp `pitchHz` to [20, 2000] and `bellowsScalar` to [0.0, 1.0] (Req 14.4)
    - Update all oscillator frequencies: `osc.frequency.rampTo(pitchHz * octaveMultiplier[i], 0.01)` (10 ms ramp, Req 5.5, 6.4)
    - Silence voices whose target frequency falls outside [27.5, 4186] Hz by ramping their volume to −Infinity (Req 5.7)
    - Update `masterGain` and LPF only when `|bellows − lastBellows| ≥ 0.01`; use 5 ms ramps (Req 7.5)
    - Logarithmic gain: `gainLinear = 10^((-60 + bellows × 60) / 20)`; log LPF: `300 × (8000/300)^bellows`
    - Handle `envelopeState`: trigger attack or release on `AmplitudeEnvelope` (Req 8.3, 8.4)
    - _Requirements: 5.5, 5.7, 6.4, 7.3, 7.4, 7.5, 8.3, 8.4, 14.4_
  - [x] 5.3 Implement `stop()` and `setEnvelopeParams()`
    - `stop()`: trigger release → wait 1300 ms → dispose all nodes → close `AudioContext`
    - `setEnvelopeParams(params)`: validate each field against bounds; return `Error` on violation; on success `Object.assign` into `adsrRef` and call `envelope.set(...)` if graph exists
    - _Requirements: 4.6, 8.5, 8.6_
  - [ ]* 5.4 Write unit tests for `setEnvelopeParams` validation
    - Test: `attack = -1` returns `Error` and leaves previous value unchanged
    - Test: `sustain = 1.1` returns `Error`
    - Test: boundary values (attack = 0.001, release = 10) are accepted
    - **Property 5: ADSR out-of-bounds update is rejected with unchanged state**
    - Use `fast-check` to generate out-of-bounds ADSR values; verify Error returned and state unchanged
    - **Validates: Requirements 8.6**

- [x] 6. Implement presentational React components
  - [x] 6.1 Create `src/components/CameraView.tsx`
    - Render `<video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" aria-hidden="true" />`
    - Accept `CameraViewProps: { videoRef: React.RefObject<HTMLVideoElement> }`
    - _Requirements: 1.2_
  - [x] 6.2 Create `src/components/LandmarkOverlay.tsx`
    - Render `<canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />`
    - Accept `LandmarkOverlayProps: { canvasRef, videoWidth, videoHeight }`; expose the canvas but do no drawing internally (drawing is called from App's rAF loop)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 13.5_
  - [x] 6.3 Create `src/components/StatusPanel.tsx`
    - Accept `StatusPanelProps: { camera: IndicatorState; hands: IndicatorState; audio: IndicatorState }`
    - Render three named rows ("Camera On", "Hands Detected", "Audio Engine Active")
    - `"active"` → green filled dot; `"inactive"` / `"loading"` → grey unfilled dot; `"error"` → red alert icon
    - Position so bounding box does not overlap `LandmarkOverlay`; always visible
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [x] 6.4 Create `src/components/StartStopButton.tsx`
    - Accept `StartStopButtonProps: { appState: AppState; onStart: () => void; onStop: () => void }`
    - Show "Start Harmonium" when `appState === "idle"`; show "Stop" when `appState === "running"`
    - Disable + show spinner when `appState === "starting" | "stopping"`
    - Add `aria-label="Start Harmonium"` / `aria-label="Stop the instrument"` accordingly (Req 13.4)
    - _Requirements: 10.1, 10.3, 10.6, 13.4_
  - [ ]* 6.5 Write unit tests for `StatusPanel` and `StartStopButton`
    - `StatusPanel`: verify each `IndicatorState` value renders the correct CSS class / icon
    - `StartStopButton`: verify correct label per `AppState`; verify button is disabled during "starting"
    - `CameraView`: verify `scale-x-[-1]` class and ref forwarding
    - `LandmarkOverlay`: verify `aria-hidden="true"` and canvas dimensions match props
    - _Requirements: 1.2, 9.2, 9.3, 9.4, 10.1, 13.4, 13.5_

- [-] 7. Checkpoint — unit tests and builds must pass
  - Ensure `npm run build` succeeds with no TypeScript errors
  - Ensure all non-optional unit tests (`vitest --run`) pass before proceeding
  - Ask the user if any questions arise.

- [ ] 8. Wire everything together in `src/App.tsx`
  - [~] 8.1 Set up App state, refs, and hook instantiation
    - Declare `appState` (`AppState`), `errorMessage`, and derive `AppStatus` fields from hook statuses
    - Create `videoRef`, `canvasRef`, `rafRef`
    - Instantiate `useHandTracking({ videoRef })` and `useHarmoniumSynth()`
    - _Requirements: 10.1_
  - [~] 8.2 Implement `startAll()` and `stopAll()`
    - `startAll()`: set `"starting"` → `synth.start()` → `handTracking.start()` → set `"running"` → begin rAF loop; catch any error, set `errorMessage`, revert to `"idle"` (Req 10.2, 10.5)
    - `stopAll()`: set `"stopping"` → cancel rAF → `handTracking.stop()` → `synth.stop()` → set `"idle"` (Req 10.4)
    - Add 5-second timeout guard in `stopAll()`: if a subsystem has not finished within 5 s, mark it inactive and continue (Req 10.7)
    - _Requirements: 4.1, 10.2, 10.4, 10.5, 10.7_
  - [~] 8.3 Implement the `requestAnimationFrame` tick loop
    - Each tick: read `handTracking.resultRef.current` → call `deriveSynthParams` → call `synth.updateParams(params)`
    - Draw landmarks on `canvasRef`: left-hand landmarks in `#4ADE80`, right-hand in `#60A5FA`; draw 21 dots per hand and skeleton connections per MediaPipe topology
    - Clear canvas when no hands detected (Req 3.5)
    - Track frame rate; if < 15 fps for > 500 ms, log warning and halve canvas resolution (Req 12.4)
    - Log latency violation when end-to-end gesture-to-audio latency exceeds 100 ms (Req 12.7)
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 12.3, 12.4, 12.5, 12.7_
  - [~] 8.4 Implement `StatusPanel` status derivation and error display
    - Derive `camera`, `hands`, `audio` `IndicatorState` values from hook statuses and `appState`
    - Render `role="alert"` paragraph for `errorMessage` when non-null
    - Update within one React render cycle of state change (≤ 16 ms, Req 9.7)
    - _Requirements: 1.5, 1.6, 2.3, 2.4, 4.3, 4.4, 9.7, 10.5_
  - [~] 8.5 Add `useEffect` cleanup and unmount disposal
    - Cancel rAF on unmount
    - Call `handTracking.stop()` and `synth.stop()` to release resources (Req 4.6)
    - _Requirements: 2.6, 4.6_

- [ ] 9. Implement accessibility and graceful degradation
  - [~] 9.1 Add browser feature detection and user-facing messages
    - On mount, check `navigator.mediaDevices?.getUserMedia`; if absent, display "A modern browser with camera API support is required" and halt (Req 13.1)
    - Catch MediaPipe WASM load failure in `useHandTracking.start()`; distinguish WASM-unsupported vs network error in the error message (Req 13.2)
    - Catch Web Audio API unavailability in `useHarmoniumSynth.start()`; if `window.AudioContext` is undefined, continue without audio and set `StatusPanel` audio indicator to a distinct "unavailable" style (Req 13.3)
    - _Requirements: 13.1, 13.2, 13.3_
  - [~] 9.2 Verify and enforce keyboard navigation and ARIA attributes
    - Confirm Tab order reaches `StartStopButton` without a mouse
    - Confirm `aria-label` toggles between "Start Harmonium" and "Stop the instrument" correctly
    - Confirm `LandmarkOverlay` has `aria-hidden="true"` (already set in 6.2; verify in App context)
    - Add `role="status"` to `StatusPanel` wrapper so screen readers announce status changes (Req 9.7)
    - _Requirements: 13.4, 13.5_

- [ ] 10. Write integration tests and remaining property-based tests
  - [~] 10.1 Write property-based test for `HandTrackingResult` serialisation round-trip
    - Generate arbitrary valid `HandTrackingResult` objects with `fast-check`
    - Serialise to JSON, deserialise, assert structural equivalence (handedness, all 21 landmark x/y/z, hand count)
    - **Property 1: HandTrackingResult serialisation round-trip**
    - **Validates: Requirements 14.2**
  - [ ]* 10.2 Write integration test for the startup sequence
    - Mock `@mediapipe/hands`, `@mediapipe/camera_utils`, and `tone` with `vi.mock`
    - Simulate "Start Harmonium" click; assert `synth.start` called before `handTracking.start`; assert `appState` transitions `idle → starting → running`
    - _Requirements: 10.2_
  - [ ]* 10.3 Write integration test for the rAF loop wiring
    - Mock `requestAnimationFrame`; feed a synthetic `HandTrackingResult` into `resultRef`; assert `synth.updateParams` is called with `SynthParams` values in valid range
    - _Requirements: 12.3, 14.5_
  - [ ]* 10.4 Write integration test for error paths
    - Simulate `getUserMedia` permission denied; assert error message displayed and `appState = "idle"`
    - Simulate `Tone.start()` failure; assert audio error message shown and subsequent subsystems not started
    - _Requirements: 1.3, 10.5_

- [~] 11. Final checkpoint — all tests pass, build is clean
  - Run `npm run build`; confirm zero TypeScript errors and zero Vite warnings
  - Run `vitest --run`; confirm all non-optional test suites pass
  - Ask the user if any questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check` with a minimum of 100 iterations each; every test file must include the comment tag `// Feature: gesture-harmonium, Property N: <property text>`
- The `HandTrackingResult` is stored in a `useRef` inside `App` (not `useState`) to avoid triggering React re-renders at 60 fps — this is intentional per the design
- All MediaPipe WASM assets are loaded from the `cdn.jsdelivr.net` CDN via `locateFile`; no local copy is bundled
- `Tone.start()` must be called inside a user-gesture handler (the "Start Harmonium" click) to satisfy browser autoplay policy
- ADSR parameters in the design use seconds (not milliseconds) in the `ADSRParams` type; the requirements use ms in prose — the canonical values for the Tone.js API are seconds: `attack: 0.08, decay: 0.1, sustain: 0.85, release: 1.2`
- The 5-second stop timeout guard (Req 10.7) should use `Promise.race` with a `setTimeout` fallback

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1", "5.1"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "4.2", "4.3", "5.2", "6.1", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["4.4", "4.5", "5.3", "6.5"] },
    { "id": 5, "tasks": ["4.6", "5.4", "8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3"] },
    { "id": 7, "tasks": ["8.4", "8.5", "9.1", "9.2"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4"] }
  ]
}
```
