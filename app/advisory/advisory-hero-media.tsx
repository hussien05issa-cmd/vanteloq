"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionPreference } from "../use-motion-preference";
import {
  connectionAllowsCinematicMedia,
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
        video.current?.pause();
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

  return <div className="advisory-hero-media" ref={stage} data-video-ready={ready && mediaAllowed && motion ? "true" : "false"}>
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
      playsInline
      preload="none"
      poster="/brand/advisory/vanteloq-advisory-signal-path-1280.webp"
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setReady(true)}
      onError={() => { setFailed(true); setReady(false); }}
    >
      <source media="(max-width: 680px)" src="/brand/advisory/vanteloq-advisory-connected-systems-mobile.mp4" type="video/mp4" />
      <source src="/brand/advisory/vanteloq-advisory-connected-systems.mp4" type="video/mp4" />
    </video>}
  </div>;
}
