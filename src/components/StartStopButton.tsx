import type { AppState } from "../types";

interface StartStopButtonProps {
  appState: AppState;
  onStart: () => void;
  onStop: () => void;
}

/**
 * Primary control button for the Gesture Harmonium.
 *
 * - "idle"     → green "Start Harmonium" button (Req 10.1)
 * - "running"  → red "Stop" button (Req 10.3)
 * - "starting" | "stopping" → grey disabled button with spinner (Req 10.6)
 *
 * Exposes aria-label that toggles between "Start Harmonium" and
 * "Stop the instrument" so keyboard-only users know what the button does.
 * The button is reachable via Tab and activatable with Enter/Space (Req 13.4).
 *
 * Requirements: 10.1, 10.3, 10.6, 13.4
 */
export default function StartStopButton({
  appState,
  onStart,
  onStop,
}: StartStopButtonProps) {
  const isTransitioning = appState === "starting" || appState === "stopping";
  const isRunning = appState === "running";

  // Derive aria-label and visible label based on current state
  const ariaLabel = isRunning ? "Stop the instrument" : "Start Harmonium";
  const label = isRunning ? "Stop" : "Start Harmonium";

  // Tailwind class sets
  const baseClasses =
    "relative flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold text-white text-sm tracking-wide transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  const colorClasses = isTransitioning
    ? "bg-gray-600 cursor-not-allowed focus-visible:outline-gray-400"
    : isRunning
    ? "bg-red-600 hover:bg-red-500 active:bg-red-700 focus-visible:outline-red-400"
    : "bg-green-600 hover:bg-green-500 active:bg-green-700 focus-visible:outline-green-400";

  function handleClick() {
    if (isTransitioning) return;
    if (isRunning) {
      onStop();
    } else {
      onStart();
    }
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={isTransitioning}
      onClick={handleClick}
      className={`${baseClasses} ${colorClasses}`}
    >
      {/* Spinner shown only during transitioning states (Req 10.6) */}
      {isTransitioning && (
        <svg
          className="animate-spin h-4 w-4 text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      <span>{isTransitioning ? (appState === "starting" ? "Starting…" : "Stopping…") : label}</span>
    </button>
  );
}
