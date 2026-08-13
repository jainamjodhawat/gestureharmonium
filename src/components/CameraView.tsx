import React from "react";

interface CameraViewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
}

/**
 * Renders the live camera feed as a mirrored video element.
 * The `[transform:scaleX(-1)]` class horizontally flips the feed so hand movements
 * feel natural to the user (Requirement 1.2).
 */
export default function CameraView({ videoRef }: CameraViewProps) {
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover [transform:scaleX(-1)]"
      aria-hidden="true"
    />
  );
}
