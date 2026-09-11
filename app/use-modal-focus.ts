"use client";

import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const openModals: HTMLElement[] = [];
const isolatedElements = new Map<HTMLElement, boolean>();
let bodyLockCount = 0;
let originalBodyOverflow = "";

function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden
        && !element.inert
        && element.getAttribute("aria-hidden") !== "true"
        && style.display !== "none"
        && style.visibility !== "hidden"
        && element.getClientRects().length > 0;
    });
}

function topmostModal() {
  const connected = openModals.filter((modal) => modal.isConnected);
  return connected.reduce<HTMLElement | null>((current, modal) => {
    if (!current) return modal;
    const currentLayer = Number.parseInt(window.getComputedStyle(current).zIndex, 10) || 0;
    const nextLayer = Number.parseInt(window.getComputedStyle(modal).zIndex, 10) || 0;
    return nextLayer >= currentLayer ? modal : current;
  }, null);
}

function restoreModalIsolation() {
  for (const [element, inert] of isolatedElements) {
    if (element.isConnected) element.inert = inert;
  }
  isolatedElements.clear();
}

function updateModalIsolation() {
  restoreModalIsolation();
  let current = topmostModal();
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      isolatedElements.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    current = parent;
  }
}

function isTopmostModal(container: HTMLElement) {
  return topmostModal() === container;
}

export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openModals.push(container);
    updateModalIsolation();
    if (bodyLockCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLockCount += 1;

    const focusFirstControl = () => {
      if (!isTopmostModal(container)) return;
      const first = focusableElements(container)[0];
      (first ?? container).focus();
    };
    queueMicrotask(focusFirstControl);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostModal(container)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = focusableElements(container);
      if (controls.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const modalIndex = openModals.lastIndexOf(container);
      if (modalIndex >= 0) openModals.splice(modalIndex, 1);
      updateModalIsolation();
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.style.overflow = originalBodyOverflow;
      if (openModals.length === 0) restoreModalIsolation();
      opener?.focus();
    };
  }, [containerRef, open]);
}
