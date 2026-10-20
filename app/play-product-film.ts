/** Keep play() in the visitor's click, including on browsers that require a gesture. */
export function playProductFilm(video: HTMLVideoElement | null, blocked: () => void) {
  if (!video) { blocked(); return; }
  try {
    if (video.error || video.networkState === 0) video.load();
    void video.play().catch(error => {
      // Hiding the page or returning to the preview intentionally interrupts play.
      if (error?.name !== "AbortError") blocked();
    });
  } catch { blocked(); }
}
