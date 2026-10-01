import React, { useCallback, useEffect, useRef, useState } from 'react';

type OverlayScrollbarProps = {
  targetRef: React.RefObject<HTMLElement | null>;
};

type ThumbGeometry = {
  top: number;
  right: number;
  height: number;
};

const HIDE_DELAY_MS = 1000;
const MIN_THUMB_HEIGHT = 24;

/**
 * The part of the container not covered by the fixed popup header and bottom nav.
 */
const getTrack = (el: HTMLElement): { top: number; height: number } => {
  const rect = el.getBoundingClientRect();
  const header = document.querySelector('header');
  const bottomNav = document.querySelector('[data-bottom-nav]');
  const top = Math.max(rect.top, header?.getBoundingClientRect().bottom ?? rect.top);
  const bottom = Math.min(rect.bottom, window.innerHeight, bottomNav?.getBoundingClientRect().top ?? rect.bottom);
  return { top, height: bottom - top };
};

/**
 * Scroll thumb drawn over the content, so it takes no width away from the popup. Shown while scrolling, hovered or dragged.
 */
const OverlayScrollbar: React.FC<OverlayScrollbarProps> = ({ targetRef }) => {
  const [geometry, setGeometry] = useState<ThumbGeometry | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ startY: number; startScrollTop: number; scrollPerPixel: number } | null>(null);

  /**
   * Measure the container and place the thumb, or drop it when nothing scrolls.
   */
  const measure = useCallback((): void => {
    const el = targetRef.current;
    if (!el || el.scrollHeight <= el.clientHeight + 1) {
      setGeometry(null);
      return;
    }
    const track = getTrack(el);
    const height = Math.max(MIN_THUMB_HEIGHT, track.height * (el.clientHeight / el.scrollHeight));
    const progress = el.scrollTop / (el.scrollHeight - el.clientHeight);
    setGeometry({ top: track.top + (track.height - height) * progress, right: window.innerWidth - el.getBoundingClientRect().right + 2, height });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) {
      return;
    }

    /**
     * Show the thumb and hide it again once scrolling stops.
     */
    const onScroll = (): void => {
      measure();
      setIsScrolling(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = setTimeout(() => setIsScrolling(false), HIDE_DELAY_MS);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return (): void => {
      el.removeEventListener('scroll', onScroll);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [targetRef, measure]);

  /**
   * Start dragging the thumb.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = targetRef.current;
    if (!el || !geometry) {
      return;
    }
    const freeTrack = getTrack(el).height - geometry.height;
    dragRef.current = { startY: e.clientY, startScrollTop: el.scrollTop, scrollPerPixel: freeTrack > 0 ? (el.scrollHeight - el.clientHeight) / freeTrack : 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    e.preventDefault();
  };

  /**
   * Scroll the container along with the dragged thumb.
   */
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = targetRef.current;
    const drag = dragRef.current;
    if (!el || !drag) {
      return;
    }
    el.scrollTop = drag.startScrollTop + (e.clientY - drag.startY) * drag.scrollPerPixel;
  };

  /**
   * Stop dragging the thumb.
   */
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  if (!geometry) {
    return null;
  }

  const isVisible = isScrolling || isHovered || isDragging;
  return (
    <div
      aria-hidden="true"
      className={`fixed z-20 w-2.5 flex justify-center transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ top: geometry.top, right: geometry.right, height: geometry.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`h-full rounded-full transition-all ${isHovered || isDragging ? 'w-2 bg-gray-500/70 dark:bg-gray-400/70' : 'w-1.5 bg-gray-500/50 dark:bg-gray-400/50'}`} />
    </div>
  );
};

export default OverlayScrollbar;
