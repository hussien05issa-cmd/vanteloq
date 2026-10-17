"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionPreference } from "../use-motion-preference";
import {
  connectionAllowsCinematicMedia,
  isUnexpectedCinematicMediaError,
  isCinematicMediaNearViewport,
  readCinematicDocumentState,
  requestCinematicPlayback,
  shouldMountCinematicSource,
  shouldPlayCinematicSource,
  shouldRenderCinematicSource,
  type AdvisoryNetworkInformation,
} from "./advisory-hero-media-policy";

type NavigatorWithConnection = Navigator & {
  connection?: AdvisoryNetworkInformation & {
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
  };
};

function allowsCinematicMedia() {
  if (typeof navigator === "undefined") return false;
  return connectionAllowsCinematicMedia((navigator as NavigatorWithConnection).connection);
}

export default function AdvisoryHeroMedia() {
  const motion = useMotionPreference();
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const intentionallySuppressedVideos = useRef(new WeakSet<HTMLVideoElement>());
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || readCinematicDocumentState(document).pageVisible);
  const [pageLoaded, setPageLoaded] = useState(() => typeof document !== "undefined" && readCinematicDocumentState(document).pageLoaded);
  const [mediaAllowed, setMediaAllowed] = useState(allowsCinematicMedia);
  const [sourceMounted, setSourceMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();

    const updateLoaded = () => setPageLoaded(true);
    if (document.readyState === "complete") updateLoaded();
    else window.addEventListener("load", updateLoaded, { once: true });

    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => {
        setVisible(entry.isIntersecting || isCinematicMediaNearViewport(entry.boundingClientRect, window.innerHeight));
      }, { rootMargin: "160px 0px", threshold: 0.08 })
      : null;
    if (stage.current) {
      setVisible(isCinematicMediaNearViewport(stage.current.getBoundingClientRect(), window.innerHeight));
      observer?.observe(stage.current);
    }
    if (!observer) queueMicrotask(() => setVisible(true));

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("load", updateLoaded);
    };
  }, []);

  useEffect(() => {
    const connection = (navigator as NavigatorWithConnection).connection;
    const updateConnection = () => {
      const allowed = connectionAllowsCinematicMedia(connection);
      if (!allowed) {
        const element = video.current;
        if (element) {
          intentionallySuppressedVideos.current.add(element);
          element.pause();
        }
        setReady(false);
        setSourceMounted(false);
      }
      setMediaAllowed(allowed);
    };
    updateConnection();
    connection?.addEventListener?.("change", updateConnection);
    return () => connection?.removeEventListener?.("change", updateConnection);
  }, []);

  useEffect(() => {
    if (!shouldMountCinematicSource({ failed, mediaAllowed, motion, pageLoaded, pageVisible, sourceMounted, visible })) return;

    let cancelled = false;
    const mount = () => { if (!cancelled) setSourceMounted(true); };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback?.(mount, { timeout: 900 });
    const timeoutId = idleId === undefined ? window.setTimeout(mount, 260) : undefined;

    return () => {
      cancelled = true;
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [failed, mediaAllowed, motion, pageLoaded, pageVisible, sourceMounted, visible]);

  useEffect(() => {
    const element = video.current;
    if (!element || !shouldRenderCinematicSource({ failed, mediaAllowed, sourceMounted })) return;
    let cancelled = false;
    const active = shouldPlayCinematicSource({ failed, mediaAllowed, motion, pageVisible, sourceMounted, visible });
    void requestCinematicPlayback(element, active).then(started => {
      if (!cancelled && !started) setReady(false);
    });
    return () => { cancelled = true; };
  }, [failed, mediaAllowed, motion, pageVisible, sourceMounted, visible]);

  const renderSource = shouldRenderCinematicSource({ failed, mediaAllowed, sourceMounted });
  const cinematicActive = motion && mediaAllowed && pageVisible && visible;

  return <div
    className="advisory-hero-media"
    ref={stage}
    data-cinematic-active={cinematicActive ? "true" : "false"}
    data-video-ready={ready && mediaAllowed && motion ? "true" : "false"}
  >
    <picture className="advisory-hero-poster">
      <source
        srcSet="/brand/advisory/vanteloq-advisory-signal-path-480.webp 480w, /brand/advisory/vanteloq-advisory-signal-path-768.webp 768w, /brand/advisory/vanteloq-advisory-signal-path-1280.webp 1280w"
        sizes="(max-width: 680px) calc(100vw - 48px), (max-width: 1184px) calc(100vw - 80px), 1040px"
        type="image/webp"
      />
      <img
        src="/brand/advisory/vanteloq-advisory-signal-path-1280.webp"
        width={1280}
        height={716}
        alt=""
        fetchPriority="high"
        decoding="async"
      />
    </picture>
    {renderSource && <video
      ref={video}
      muted
      loop
      playsInline
      preload="none"
      poster="/brand/advisory/vanteloq-advisory-signal-path-1280.webp"
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setReady(true)}
      onError={event => {
        if (!isUnexpectedCinematicMediaError(event.currentTarget, intentionallySuppressedVideos.current)) return;
        setFailed(true);
        setReady(false);
      }}
    >
      <source media="(max-width: 680px)" src="/brand/advisory/vanteloq-advisory-connected-systems-mobile.mp4" type="video/mp4" />
      <source src="/brand/advisory/vanteloq-advisory-connected-systems.mp4" type="video/mp4" />
    </video>}
    <div className="advisory-system-layer" aria-hidden="true">
      <div className="advisory-system-kicker"><span />Connected Business System</div>
      <svg className="advisory-system-routes" viewBox="0 0 1000 550" preserveAspectRatio="none">
        <path className="advisory-system-route" d="M90 306 C230 306 292 282 407 281 S604 246 734 205 S846 180 922 160" />
        <path className="advisory-system-route advisory-system-route-pulse" d="M90 306 C230 306 292 282 407 281 S604 246 734 205 S846 180 922 160" />
        <path className="advisory-system-return" d="M888 357 C764 474 486 480 278 411 S121 348 90 306" />
      </svg>

      <div className="advisory-system-node advisory-system-signals">
        <span className="advisory-system-label">Signals</span>
        <div className="advisory-system-signal-list">
          <span>Sales</span><span>Inventory</span><span>Cash</span><span>Operations</span>
        </div>
      </div>

      <div className="advisory-system-node advisory-system-analysis">
        <img src="/brand/vanteloq-mark-ui.webp" width={32} height={32} alt="" />
        <div><span className="advisory-system-label">Analysis</span><strong>One Business View</strong></div>
      </div>

      <div className="advisory-system-node advisory-system-decision">
        <span className="advisory-system-label">Decision</span>
        <strong>Clear Priority</strong>
      </div>

      <div className="advisory-system-node advisory-system-follow">
        <span className="advisory-system-label">Follow-Through</span>
        <div className="advisory-system-follow-list"><span>Priority</span><span>Owner</span><span>Review</span></div>
      </div>
    </div>
  </div>;
}
