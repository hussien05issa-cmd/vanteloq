export type AdvisoryNetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

export type CinematicSourceGate = {
  failed: boolean;
  mediaAllowed: boolean;
  motion: boolean;
  pageLoaded: boolean;
  pageVisible: boolean;
  sourceMounted: boolean;
  visible: boolean;
};

export type CinematicPlaybackGate = Pick<CinematicSourceGate,
  "failed" | "mediaAllowed" | "motion" | "pageVisible" | "sourceMounted" | "visible"
>;

type CinematicVideo = Pick<HTMLVideoElement, "pause" | "play">;

type CinematicViewportBounds = Pick<DOMRect, "bottom" | "top">;

export function connectionAllowsCinematicMedia(connection?: AdvisoryNetworkInformation) {
  return !connection?.saveData && !["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "");
}

export function readCinematicDocumentState(documentState: Pick<Document, "hidden" | "readyState">) {
  return {
    pageLoaded: documentState.readyState === "complete",
    pageVisible: !documentState.hidden,
  };
}

export function isCinematicMediaNearViewport(bounds: CinematicViewportBounds, viewportHeight: number, padding = 160) {
  return bounds.bottom >= -padding && bounds.top <= viewportHeight + padding;
}

export function shouldMountCinematicSource(gate: CinematicSourceGate) {
  return gate.motion
    && gate.mediaAllowed
    && gate.visible
    && gate.pageVisible
    && gate.pageLoaded
    && !gate.failed
    && !gate.sourceMounted;
}

export function shouldRenderCinematicSource(gate: Pick<CinematicPlaybackGate, "failed" | "mediaAllowed" | "sourceMounted">) {
  return gate.sourceMounted && gate.mediaAllowed && !gate.failed;
}

export function shouldPlayCinematicSource(gate: CinematicPlaybackGate) {
  return shouldRenderCinematicSource(gate)
    && gate.motion
    && gate.visible
    && gate.pageVisible;
}

export async function requestCinematicPlayback(element: CinematicVideo, active: boolean) {
  if (!active) {
    element.pause();
    return false;
  }
  try {
    await element.play();
    return true;
  } catch {
    return false;
  }
}
