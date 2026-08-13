import type { IndicatorState } from "../types";

interface StatusPanelProps {
  camera: IndicatorState;
  hands: IndicatorState;
  audio: IndicatorState;
}

interface IndicatorProps {
  label: string;
  state: IndicatorState;
}

function Indicator({ label, state }: IndicatorProps) {
  const isActive = state === "active";
  const isError = state === "error";

  return (
    <div className="flex items-center gap-2 text-sm">
      {isError ? (
        // Red alert icon for error state (Req 9.4)
        <span className="w-3 h-3 text-red-500" aria-hidden="true">⚠</span>
      ) : isActive ? (
        // Green filled dot for active state (Req 9.2)
        <span className="w-3 h-3 rounded-full bg-green-400 inline-block" aria-hidden="true" />
      ) : (
        // Grey unfilled dot for inactive/loading state (Req 9.3, 9.5)
        <span className="w-3 h-3 rounded-full border border-gray-500 inline-block" aria-hidden="true" />
      )}
      <span className={isActive ? "text-green-400" : isError ? "text-red-500" : "text-gray-400"}>
        {label}
      </span>
    </div>
  );
}

/**
 * Displays three status indicators for Camera, Hands, and Audio subsystems.
 *
 * - active: green filled dot (Req 9.2)
 * - inactive/loading: grey unfilled dot (Req 9.3, 9.5)
 * - error: red alert icon (Req 9.4)
 *
 * Positioned in the top-right corner so it doesn't overlap the LandmarkOverlay (Req 9.6).
 * Updates within 16ms of state change via React rendering (Req 9.7).
 *
 * Requirements: 9.1–9.7
 */
export default function StatusPanel({ camera, hands, audio }: StatusPanelProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="System status"
      className="absolute top-3 right-3 z-10 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 flex flex-col gap-1.5 shadow-lg"
    >
      <Indicator label="Camera On" state={camera} />
      <Indicator label="Hands Detected" state={hands} />
      <Indicator label="Audio Engine Active" state={audio} />
    </div>
  );
}
