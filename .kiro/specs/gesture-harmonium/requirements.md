# Requirements Document

## Introduction

The Gesture Harmonium is an interactive, browser-based musical instrument that transforms hand movements captured by a web camera into real-time harmonium-like sound synthesis. The application uses Google MediaPipe Hands to track 21 skeletal landmarks on up to two hands simultaneously, then maps spatial hand data to audio control parameters via Tone.js. The left hand governs pitch (simulating the harmonium keys), while the right hand governs expression — volume and tonal brightness — by mimicking the action of pumping a harmonium's bellows. The interface is built in React with Tailwind CSS and rendered as a minimalist single-page application showing the live camera feed with landmark overlays and real-time status indicators.

---

## Glossary

- **App**: The Gesture Harmonium React single-page application running in the browser.
- **Camera_Feed**: The live video stream obtained from the user's device camera via `getUserMedia`.
- **Hand_Tracker**: The MediaPipe Hands processing pipeline responsible for detecting and returning 21 normalized landmark coordinates per hand.
- **Landmark**: A single named point in 3D space (x, y, z normalised 0–1) returned by the Hand_Tracker for a detected hand. The 21 landmarks follow the MediaPipe Hand Landmark model indices 0–20.
- **Wrist_Landmark**: Landmark index 0 — the root anchor point of the hand skeleton, used as the primary positional reference.
- **Finger_Tip_Landmarks**: Landmark indices 4 (thumb), 8 (index), 12 (middle), 16 (ring), 20 (pinky) — the distal tips of each finger.
- **Palm_Spread**: The computed Euclidean distance between the thumb tip (landmark 4) and the pinky tip (landmark 20), normalised against a per-session maximum spread value to produce a 0.0–1.0 scalar.
- **Left_Hand**: The hand detected and labelled as "Left" by the Hand_Tracker.
- **Right_Hand**: The hand detected and labelled as "Right" by the Hand_Tracker.
- **Pitch_Controller**: The subsystem that reads the Left_Hand Wrist_Landmark Y-axis position and maps it to the root note frequency of the Synth_Engine.
- **Bellows_Controller**: The subsystem that reads the Right_Hand Palm_Spread value and maps it to the Synth_Engine's volume gain and LPF cutoff frequency.
- **Synth_Engine**: The Tone.js audio graph responsible for producing the harmonium-like sound, comprising oscillators, an LPF, an ADSR envelope, and a master gain node.
- **LPF**: A low-pass biquad filter node within the Synth_Engine that attenuates high-frequency content above a variable cutoff frequency.
- **ADSR_Envelope**: The attack–decay–sustain–release amplitude envelope applied to the oscillator output within the Synth_Engine.
- **Reed_Oscillator_Bank**: A set of simultaneously active oscillators (triangle and square wave mix) that collectively approximate the timbre of harmonium reeds.
- **Note_Grid**: A discrete list of musical pitches (MIDI note numbers or frequency values in Hz) spanning the usable vertical range of the camera frame, to which the Pitch_Controller quantises the continuous Y-axis position.
- **Audio_Context**: The Web Audio API `AudioContext` instance managed by Tone.js that must be resumed after a user gesture.
- **Status_Panel**: The UI overlay component showing three binary indicators: Camera On, Hands Detected, Audio Engine Active.
- **Landmark_Overlay**: The canvas element drawn on top of the Camera_Feed that renders hand skeleton connections and landmark dots.
- **Hand_Tracking_Hook**: The `useHandTracking` custom React hook encapsulating all MediaPipe initialisation and frame-by-frame landmark data.
- **Synth_Hook**: The `useHarmoniumSynth` custom React hook encapsulating all Tone.js graph creation, parameter modulation, and lifecycle management.
- **Normalised_Y**: The Y-axis value of the Wrist_Landmark, expressed as a 0.0–1.0 scalar where 0.0 is the top of the video frame and 1.0 is the bottom.
- **Smoothing_Filter**: An exponential moving average applied to raw landmark coordinates to reduce jitter before use by the Pitch_Controller or Bellows_Controller.

---

## Requirements

---

### Requirement 1: Camera Initialisation and Video Feed Display

**User Story:** As a musician, I want the app to access my camera and display the live video feed, so that I can see my hands while playing and verify the camera is active.

#### Acceptance Criteria

1. WHEN the App loads, THE App SHALL request camera access from the browser using `getUserMedia` with video constraints of at minimum 640×480 resolution at 30 fps.
2. WHEN the user grants camera permission, THE Camera_Feed SHALL render in the primary viewport as a mirrored (horizontally flipped) video element so that hand movements feel natural.
3. IF the user denies camera permission, THEN THE App SHALL display an error message indicating that camera access is required, cease the initialisation sequence, and preserve any previously rendered UI state without crashing or throwing an unhandled exception.
4. IF `getUserMedia` returns an error for any reason other than permission denial (e.g., device not found, hardware error), THEN THE App SHALL display an error message identifying the failure type, cease the initialisation sequence, and preserve any previously rendered UI state without crashing or throwing an unhandled exception.
5. WHEN the Camera_Feed is active and streaming video, THE Status_Panel SHALL display the "Camera On" indicator in an active state.
6. IF the Camera_Feed is not active or has errored, THEN THE Status_Panel SHALL display the "Camera On" indicator in an inactive state.
7. WHEN the user grants camera permission, THE App SHALL render the Camera_Feed video element within 3 seconds of the permission being granted.

---

### Requirement 2: Real-Time Hand Landmark Detection

**User Story:** As a musician, I want the app to detect and track both of my hands in real time, so that each hand can independently control different aspects of the sound.

#### Acceptance Criteria

1. WHEN the Camera_Feed is active, THE Hand_Tracker SHALL process each video frame and return up to two detected hand skeletons with 21 landmarks each at a rate matching the Camera_Feed frame rate (minimum 20 fps on a device meeting the minimum hardware requirements).
2. THE Hand_Tracker SHALL label each detected hand as either "Left" or "Right" using the MediaPipe Hands handedness classification.
3. WHEN one or more hands are detected in a frame, THE Status_Panel SHALL display the "Hands Detected" indicator in an active/green state.
4. WHEN no hands are detected in a frame for more than 100 ms, THE Status_Panel SHALL display the "Hands Detected" indicator in an inactive/grey state.
5. THE Hand_Tracker SHALL apply a Smoothing_Filter with an exponential moving average alpha of 0.3 to all Wrist_Landmark and Finger_Tip_Landmark coordinates before publishing them to the Pitch_Controller and Bellows_Controller.
6. WHEN the Camera_Feed stops or is unavailable, THE Hand_Tracker SHALL cease processing and release all associated MediaPipe resources.
7. WHEN more than two hands are detected simultaneously in a single frame, THE Hand_Tracker SHALL retain only the two hands with the highest MediaPipe confidence scores and SHALL discard the remaining detections for that frame.
8. IF the Hand_Tracker fails to process a video frame within 50 ms of receiving it, THEN THE Hand_Tracker SHALL discard that frame, publish no new landmark data for that frame, and preserve the most recently published landmark values.

---

### Requirement 3: Hand Skeleton Landmark Overlay

**User Story:** As a musician, I want to see a visual skeleton drawn over my hands on the camera feed, so that I can understand how the system is interpreting my hand positions.

#### Acceptance Criteria

1. WHEN one or more hands are detected, THE Landmark_Overlay SHALL draw a filled circle with a diameter of 8–12 pixels at each of the 21 landmark positions for each detected hand on every rendered frame.
2. THE Landmark_Overlay SHALL draw connecting lines between landmarks following the MediaPipe Hand Landmark skeleton topology (palm connections, finger bone segments), with a line width of 2–4 pixels.
3. THE Landmark_Overlay SHALL render Left_Hand landmarks and connections in a visually distinct colour from Right_Hand landmarks and connections, where the two colours differ by a minimum contrast ratio of 3:1 against each other.
4. THE Landmark_Overlay SHALL be rendered as an HTML canvas element positioned absolutely over the Camera_Feed with matching dimensions.
5. WHEN no hands are detected, THE Landmark_Overlay SHALL clear all previously drawn landmarks and connections from the canvas within one rendered frame.
6. IF landmark coordinate data for a detected hand is unavailable or incomplete (fewer than 21 landmarks returned), THEN THE Landmark_Overlay SHALL skip rendering that hand's skeleton for that frame without clearing valid data for other detected hands.

---

### Requirement 4: Audio Engine Initialisation

**User Story:** As a musician, I want the audio engine to start when I interact with the app, so that sound is produced without violating browser autoplay policies.

#### Acceptance Criteria

1. WHEN the user performs their first deliberate interaction with the App by activating a designated start control, THE Synth_Engine SHALL initialise the Audio_Context and resume it, resulting in the Audio_Context transitioning to the "running" state within 2 seconds.
2. IF the Audio_Context fails to reach the "running" state within 2 seconds of the initialisation attempt, THEN THE Synth_Engine SHALL display an error message indicating that audio initialisation failed and the Audio_Context SHALL remain in its previous state.
3. WHEN the Audio_Context is in the "running" state, THE Status_Panel SHALL display the "Audio Engine Active" indicator in an active/green state.
4. WHEN the Audio_Context is in the "suspended" or "closed" state, THE Status_Panel SHALL display the "Audio Engine Active" indicator in an inactive/grey state.
5. WHEN the Audio_Context transitions to the "running" state, THE Synth_Hook SHALL construct the Reed_Oscillator_Bank, LPF, ADSR_Envelope, and master gain node and connect them in the signal chain: Reed_Oscillator_Bank → LPF → ADSR_Envelope → master gain → Audio_Context destination, completing construction before any note events are processed.
6. WHEN the App unmounts or navigates away, THE Synth_Hook SHALL stop audio transport and dispose of all audio nodes to prevent audio resource leaks, resulting in the Audio_Context reaching a "closed" state within 1 second.

---

### Requirement 5: Reed Oscillator Bank Timbre

**User Story:** As a musician, I want the synthesiser to produce a sound that resembles a harmonium reed, so that the instrument feels authentic and musically satisfying.

#### Acceptance Criteria

1. THE Reed_Oscillator_Bank SHALL contain at least four and no more than eight simultaneously active oscillator voices per sounding note to approximate the harmonic density of a multi-reed harmonium stop.
2. THE Reed_Oscillator_Bank SHALL use a mixture of triangle wave oscillators and square wave oscillators, with at least one oscillator of each type active per voice group.
3. THE Reed_Oscillator_Bank SHALL detune individual oscillators within a voice group by offsets between −8 and +8 cents relative to the target frequency, with a minimum separation of 1 cent between any two detuned oscillators in the same voice group, to produce the characteristic beating/chorus of a physical harmonium reed pair.
4. THE Reed_Oscillator_Bank SHALL include one oscillator tuned one octave above the root frequency to simulate the presence of the harmonium's upper register stop.
5. WHEN the target frequency changes, THE Reed_Oscillator_Bank SHALL update all oscillator frequencies within 10 ms to prevent perceptible pitch glide artefacts.
6. WHEN a note is triggered, THE Reed_Oscillator_Bank SHALL reach at least 90% of the target amplitude level within 10 ms of the trigger event.
7. IF the target frequency for any oscillator voice falls outside the range of 27.5 Hz to 4186 Hz, THEN THE Reed_Oscillator_Bank SHALL silence that voice and SHALL NOT activate it, without affecting the output of other voices in the bank.

---

### Requirement 6: Polyphonic Pitch Control via Left Hand

**User Story:** As a musician, I want the vertical position of my left hand to control the pitch of the harmonium, so that I can play melodies by raising and lowering my hand.

#### Acceptance Criteria

1. WHEN the Left_Hand is detected, THE Pitch_Controller SHALL read the Normalised_Y value of the Left_Hand Wrist_Landmark and map it to the nearest semitone in the Note_Grid using the quantisation rule defined in criterion 6.
2. THE Note_Grid SHALL span a two-octave range of 25 discrete MIDI notes from note number 48 (C3, ~130.8 Hz) to note number 72 (C5, ~523.3 Hz) inclusive, divided into 24 equal vertical regions across the Normalised_Y range of 0.0 to 1.0, where each region spans exactly 1/24 of the total range.
3. THE Pitch_Controller SHALL map Normalised_Y = 0.0 (top of frame) to MIDI note 72 (C5) and Normalised_Y = 1.0 (bottom of frame) to MIDI note 48 (C3), such that each semitone boundary occurs at Normalised_Y intervals of 1/24 (~0.0417).
4. WHEN the Pitch_Controller maps the Left_Hand Wrist_Landmark position to a semitone that differs from the currently active MIDI note, THE Synth_Engine SHALL transition to the new frequency using a linear ramp of no more than 20 ms and no less than 1 ms to avoid audible clicks.
5. WHEN the Left_Hand is not detected for a continuous duration exceeding 150 ms, THE Pitch_Controller SHALL retain the last successfully mapped MIDI note as the active pitch and SHALL NOT emit a note-off event.
6. THE Pitch_Controller SHALL quantise the Normalised_Y value to a MIDI note number using the formula: MIDI_note = 72 − round(Normalised_Y × 24), where round() applies standard half-up rounding, and the result SHALL be clamped to the range [48, 72] if Normalised_Y falls outside [0.0, 1.0].

---

### Requirement 7: Bellows Expression Control via Right Hand

**User Story:** As a musician, I want the spread of my right hand to control the volume and brightness of the sound, so that I can expressively shape the dynamics like a real harmonium bellows.

#### Acceptance Criteria

1. WHEN the Right_Hand is detected, THE Bellows_Controller SHALL compute Palm_Spread as the Euclidean distance between Right_Hand landmark 4 (thumb tip) and landmark 20 (pinky tip).
2. WHEN the Right_Hand is detected, THE Bellows_Controller SHALL normalise Palm_Spread against a reference maximum spread value of 0.4 (normalised landmark coordinate units) to produce a bellows scalar in the range 0.0–1.0, clamped to [0.0, 1.0].
3. WHEN the Right_Hand is detected, THE Bellows_Controller SHALL map the bellows scalar to the Synth_Engine master gain on a logarithmic scale such that a bellows scalar of 0.0 corresponds to −60 dB and a bellows scalar of 1.0 corresponds to 0 dB.
4. WHEN the Right_Hand is detected, THE Bellows_Controller SHALL map the bellows scalar to the LPF cutoff frequency on a logarithmic scale such that a bellows scalar of 0.0 corresponds to 300 Hz and a bellows scalar of 1.0 corresponds to 8000 Hz.
5. WHEN the bellows scalar changes by 0.01 or more from its previously applied value, THE Synth_Engine SHALL apply the new gain and LPF cutoff values within one audio processing block (≤ 5.8 ms at 48 kHz) using Tone.js parameter ramping.
6. WHEN the Right_Hand is not detected for more than 150 ms, THE Bellows_Controller SHALL hold the last known bellows scalar value, sustaining the current volume and filter state.
7. IF no Right_Hand detection has occurred since application start, THEN THE Bellows_Controller SHALL initialise the bellows scalar to 0.0, corresponding to −60 dB gain and a 300 Hz LPF cutoff.
8. IF the Right_Hand Palm_Spread exceeds the reference maximum of 0.4, THEN THE Bellows_Controller SHALL clamp the bellows scalar to 1.0 and the output gain SHALL not exceed 0 dB and the LPF cutoff SHALL not exceed 8000 Hz.

---

### Requirement 8: ADSR Envelope for Harmonium Swell

**User Story:** As a musician, I want the notes to swell smoothly when I move my hands and decay gradually when I stop, so that the instrument feels like a real harmonium with natural air pressure dynamics.

#### Acceptance Criteria

1. THE ADSR_Envelope SHALL use an attack time of 80 ms, a decay time of 100 ms, a sustain level of 0.85 (on a normalised scale of 0.0 to 1.0), and a release time of 1200 ms as default parameter values.
2. WHEN the App initialises the Synth_Engine for the first time, THE ADSR_Envelope SHALL enter the sustain phase at level 0.85 automatically, so that sound is immediately audible when hands are detected, without requiring an explicit note-on trigger.
3. WHEN the Left_Hand is not detected for a continuous duration of more than 500 ms, THE ADSR_Envelope SHALL begin the release phase, reducing the output amplitude from the current level to 0.0 linearly over 1200 ms.
4. WHEN the Left_Hand is re-detected during the release phase, THE ADSR_Envelope SHALL immediately re-enter the attack phase from the current amplitude level, reaching the sustain level of 0.85 within 80 ms.
5. THE ADSR_Envelope attack, decay, sustain, and release parameters SHALL each be independently adjustable via the Synth_Hook API within the following bounds — attack: 1 ms to 5000 ms, decay: 1 ms to 5000 ms, sustain: 0.0 to 1.0, release: 1 ms to 10000 ms — without requiring a full Synth_Engine rebuild.
6. IF a parameter value supplied to the Synth_Hook API falls outside the defined bounds, THEN THE ADSR_Envelope SHALL reject the update, retain the previous valid parameter value, and return an error indicating which parameter was out of range.

---

### Requirement 9: Minimalist Status Panel UI

**User Story:** As a musician, I want to see clear status indicators showing whether the camera, hand tracking, and audio are active, so that I can diagnose problems without reading error logs.

#### Acceptance Criteria

1. THE Status_Panel SHALL display three named indicators: "Camera On", "Hands Detected", and "Audio Engine Active".
2. WHEN an indicator's corresponding subsystem is reporting a live signal (camera frames being received, hand landmarks being emitted, or audio context in a running state), THE Status_Panel SHALL render that indicator with a green colour and a filled dot icon.
3. WHEN an indicator's corresponding subsystem has been explicitly stopped or is not yet started, and no error condition is present, THE Status_Panel SHALL render that indicator with a grey colour and an unfilled dot icon.
4. WHEN an indicator's corresponding subsystem has reported a failure (camera device unavailable, hand tracking initialisation failed, or audio context suspended due to an error), THE Status_Panel SHALL render that indicator with a red colour and an alert icon.
5. WHILE the subsystem status has not yet been determined (e.g. during initial load), THE Status_Panel SHALL render the corresponding indicator with a grey colour and an unfilled dot icon.
6. THE Status_Panel SHALL be persistently visible in the App viewport, positioned such that its bounding box does not overlap the bounding box of the Landmark_Overlay.
7. WHEN a subsystem status value changes in application state, THE Status_Panel SHALL update the corresponding indicator's visual state within 16 ms of that state change.

---

### Requirement 10: Start/Stop Interaction Control

**User Story:** As a musician, I want a clear way to start and stop the instrument, so that I can control when audio is active and comply with browser autoplay requirements.

#### Acceptance Criteria

1. THE App SHALL display a prominently labelled "Start Harmonium" button before the Audio_Context has been initialised.
2. WHEN the user clicks "Start Harmonium", THE App SHALL initialise the Synth_Engine, activate the Camera_Feed, and start the Hand_Tracker in that order.
3. WHEN the Synth_Engine, Camera_Feed, and Hand_Tracker are all active, THE App SHALL replace the "Start Harmonium" button with a "Stop" button.
4. WHEN the user clicks "Stop", THE App SHALL stop the Hand_Tracker, release the Camera_Feed stream, and suspend the Audio_Context, returning the App to its pre-start state.
5. IF initialisation of any subsystem fails during start-up, THEN THE App SHALL display an error message in the Status_Panel identifying which subsystem failed and the reason for failure, and SHALL NOT attempt to initialise subsequent subsystems.
6. WHILE the Synth_Engine, Camera_Feed, or Hand_Tracker is in the process of initialising, THE App SHALL disable the "Start Harmonium" button and display a loading indicator in the Status_Panel.
7. IF the user clicks "Stop" and any subsystem fails to shut down within 5 seconds, THEN THE App SHALL mark that subsystem as inactive and continue releasing the remaining subsystems, returning the App to its pre-start state.

---

### Requirement 11: Coordinate Smoothing and Jitter Reduction

**User Story:** As a musician, I want hand position changes to feel smooth and musical, so that small involuntary tremors do not cause jarring pitch or volume jumps.

#### Acceptance Criteria

1. THE Smoothing_Filter SHALL apply an exponential moving average to all Wrist_Landmark coordinates published to the Pitch_Controller, using a configurable alpha parameter defaulting to 0.3.
2. THE Smoothing_Filter SHALL apply an exponential moving average to the raw Palm_Spread value published to the Bellows_Controller, using a configurable alpha parameter defaulting to 0.3.
3. THE Smoothing_Filter SHALL compute the smoothed value as: `smoothed = alpha × raw + (1 − alpha) × previous_smoothed`, where alpha is in the range [0.1, 1.0], raw is the current unfiltered coordinate or Palm_Spread value, and previous_smoothed is the smoothed value from the immediately preceding frame.
4. WHEN the Hand_Tracker detects a new hand for the first time in a session (no previous smoothed value exists), THE Smoothing_Filter SHALL initialise the previous smoothed value to the first raw reading, preventing a spurious ramp from zero.
5. THE alpha parameter of the Smoothing_Filter SHALL be adjustable to any value between 0.1 (maximum smoothing) and 1.0 (no smoothing) inclusive, and the new alpha value SHALL take effect within one processed frame after the change is applied, without requiring an App restart.
6. WHEN the Hand_Tracker publishes updated Wrist_Landmark coordinates or Palm_Spread values, THE Smoothing_Filter SHALL produce and publish the corresponding smoothed output within 5 milliseconds.
7. IF the Hand_Tracker loses tracking of a previously tracked hand and then redetects it, THE Smoothing_Filter SHALL reinitialise the previous smoothed value to the first raw reading of the redetected hand, discarding all smoothed state from the prior tracking session for that hand.

---

### Requirement 12: Performance and Latency Constraints

**User Story:** As a musician, I want the gesture-to-sound latency to be low enough that playing feels responsive, so that the instrument is musically usable in real time.

#### Acceptance Criteria

1. THE App SHALL achieve an end-to-end gesture-to-audio latency of no greater than 100 ms on a device with a modern multi-core CPU, a dedicated GPU capable of running MediaPipe models, and a stable 60 fps camera feed.
2. THE Hand_Tracker SHALL process frames at a sustained rate of at least 20 fps and no greater than 60 fps during normal operation to maintain playable responsiveness.
3. WHEN a gesture parameter value is computed, THE Synth_Engine SHALL apply the corresponding parameter change (frequency, gain, or LPF cutoff) within 10 ms of that computation using Tone.js scheduled parameter automation.
4. IF the camera frame rate drops below 15 fps for a continuous duration exceeding 500 ms due to JavaScript main-thread blocking during Landmark_Overlay rendering, THEN THE App SHALL log a performance warning and reduce the Landmark_Overlay rendering resolution by 50% to recover frame rate.
5. THE Landmark_Overlay canvas drawing operations SHALL be performed in a `requestAnimationFrame` callback, not in the MediaPipe results callback, to avoid blocking the Hand_Tracker processing pipeline.
6. IF the device does not meet the minimum hardware profile (multi-core CPU, GPU-capable browser), THEN THE App SHALL display a warning message to the user stating that performance may be degraded.
7. IF the measured end-to-end gesture-to-audio latency exceeds 100 ms during a session, THEN THE App SHALL log a latency violation event including the measured latency value.

---

### Requirement 13: Accessibility and Graceful Degradation

**User Story:** As a user without a compatible camera or GPU, I want the app to handle missing hardware gracefully, so that I receive a clear explanation rather than a broken experience.

#### Acceptance Criteria

1. IF the browser does not support `getUserMedia`, THEN THE App SHALL display a message stating that a modern browser with camera API support is required.
2. IF the MediaPipe Hands WASM runtime fails to load, THEN THE App SHALL display an error message identifying whether the failure was caused by WASM being unsupported in the current environment or by a network error, AND THE App SHALL exit the loading state within 10 seconds of the failure occurring.
3. IF the Web Audio API is unavailable, THEN THE App SHALL continue to function without audio output and SHALL display the "Audio Engine Active" indicator with visually distinct styling and text indicating that audio is unavailable, rather than crashing.
4. THE App SHALL allow keyboard-only users to reach the "Start Harmonium" and "Stop" buttons by Tab key navigation and to activate each button using the Enter and Space keys, with each button exposing an `aria-label` attribute describing its action.
5. THE Landmark_Overlay canvas element SHALL include an `aria-hidden="true"` attribute so that screen readers do not attempt to interpret the dynamically drawn canvas content.

---

### Requirement 14: Parser and Serialiser — Hand Landmark Data (Internal Data Contracts)

**User Story:** As a developer, I want clearly defined data structures for landmark payloads, so that the Hand_Tracking_Hook and Synth_Hook can be developed and tested independently.

#### Acceptance Criteria

1. THE Hand_Tracking_Hook SHALL publish hand landmark data in a typed `HandTrackingResult` structure containing: an array of 0 to 2 `DetectedHand` objects, each with a `handedness` field constrained to the enum values "Left" or "Right", and a `landmarks` array of exactly 21 `Landmark3D` objects each with `x`, `y`, and `z` fields of type `number`.
2. WHEN a `HandTrackingResult` is serialised to JSON and deserialised back to a `HandTrackingResult`, THE deserialised object SHALL be structurally equivalent to the original such that all `handedness` values, all `x`, `y`, and `z` values of all 21 landmarks per hand, and the number of `DetectedHand` objects are identical to the pre-serialisation values.
3. THE Synth_Hook SHALL expose a typed `SynthParams` structure containing: `pitchHz` of type `number` in the range 20 to 2000 inclusive, `bellowsScalar` of type `number` in the range 0.0 to 1.0 inclusive, and `envelopeState` constrained to the values "attack", "sustain", or "release".
4. WHEN a `SynthParams` object is passed to the Synth_Hook with a `pitchHz` value outside the range 20 to 2000, or a `bellowsScalar` value outside the range 0.0 to 1.0, THE Synth_Hook SHALL clamp each out-of-range value to the nearest bound of its valid range, SHALL NOT throw an exception, and SHALL return or apply a `SynthParams` object in which all values are within their defined valid ranges.
5. FOR ALL valid `HandTrackingResult` objects, parsing the landmarks array and mapping to a `SynthParams` object using the Pitch_Controller and Bellows_Controller logic SHALL produce a `SynthParams` object where `pitchHz` is in the range 20 to 2000 inclusive and `bellowsScalar` is in the range 0.0 to 1.0 inclusive.
6. IF a `HandTrackingResult` structure contains a `landmarks` array with a count other than exactly 21 `Landmark3D` objects for any `DetectedHand`, THEN the Hand_Tracking_Hook SHALL reject that structure and SHALL NOT publish it.
7. IF a `HandTrackingResult` structure contains more than 2 `DetectedHand` objects or contains a `handedness` value other than "Left" or "Right", THEN the Hand_Tracking_Hook SHALL reject that structure and SHALL NOT publish it.