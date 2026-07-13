'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Drag-to-resize + collapse for the journal/wallet sidebars. The width and the collapsed flag are
// persisted per-key in localStorage so the layout survives a reload; both dashboards use the same
// hook so they behave identically.

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 244;

interface Stored {
  width: number;
  collapsed: boolean;
}

function read(key: string): Stored {
  if (typeof window === 'undefined') return { width: SIDEBAR_DEFAULT, collapsed: false };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { width: SIDEBAR_DEFAULT, collapsed: false };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const width =
      typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed.width))
        : SIDEBAR_DEFAULT;
    return { width, collapsed: parsed.collapsed === true };
  } catch {
    return { width: SIDEBAR_DEFAULT, collapsed: false };
  }
}

export function useSidebarResize(storageKey: string) {
  // Start at the defaults on both server and first client render, then hydrate from storage in an
  // effect — reading localStorage during render would mismatch the SSR markup.
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const stored = read(storageKey);
    setWidth(stored.width);
    setCollapsed(stored.collapsed);
  }, [storageKey]);

  const persist = useCallback(
    (next: Stored) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable (private mode / quota) — the layout just won't persist */
      }
    },
    [storageKey],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      persist({ width, collapsed: !c });
      return !c;
    });
  }, [persist, width]);

  // Teardown for an in-flight drag. Held in a ref so unmount can run it: the pointermove/pointerup
  // listeners live on `window`, so navigating away mid-drag would otherwise leave them attached,
  // firing setState on an unmounted component at the next pointerup.
  const endDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => endDragRef.current?.(), []);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return;
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startWidth = asideRef.current?.getBoundingClientRect().width ?? width;
      let latest = startWidth;

      const onMove = (ev: PointerEvent) => {
        latest = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX)));
        setWidth(latest);
      };
      const detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        endDragRef.current = null;
      };
      const onUp = () => {
        detach();
        setDragging(false);
        persist({ width: latest, collapsed: false });
      };
      endDragRef.current = detach;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [collapsed, persist, width],
  );

  // Keyboard resize for the separator (arrow keys), so the handle isn't pointer-only.
  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (collapsed) return;
      const step = e.shiftKey ? 32 : 8;
      let next: number | null = null;
      if (e.key === 'ArrowLeft') next = width - step;
      if (e.key === 'ArrowRight') next = width + step;
      if (next === null) return;
      e.preventDefault();
      const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
      setWidth(clamped);
      persist({ width: clamped, collapsed: false });
    },
    [collapsed, persist, width],
  );

  return { asideRef, width, collapsed, dragging, toggleCollapsed, startResize, onHandleKeyDown };
}
