import React from "react";

interface LandmarkOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  videoWidth: number;
  videoHeight: number;
}

/**
 * An absolutely-positioned canvas element overlaid on top of CameraView.
 *
 * IMPORTANT: This component only provides the canvas element. All drawing
 * (landmark dots, skeleton lines) is performed externally from the App's
 * requestAnimationFrame loop to avoid blocking the MediaPipe pipeline
 * (Requirement 12.5).
 *
 * aria-hidden="true" prevents screen readers from attempting to interpret
 * the dynamically-drawn canvas content (Requirement 13.5).
 */
export default function LandmarkOverlay({ canvasRef, videoWidth, videoHeight }: LandmarkOverlayProps) {
  return (
    <canvas
      ref={canvasRef}
      width={videoWidth}
      height={videoHeight}
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
    />
  );
}
