import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet } from "react-native";
import type {
  LongPressWordHandle,
  LongPressWordProps,
} from "./LongPressWord";

const LONG_PRESS_DELAY_MS = 380;

export const LongPressWord = forwardRef<LongPressWordHandle, LongPressWordProps>(function LongPressWord({
  children,
  accessibilityHint,
  onLongPress,
  onPressIn,
  onPressOut,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
  style,
}, forwardedRef) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elementRef = useRef<HTMLSpanElement>(null);
  const selectingRef = useRef(false);
  const [hovered, setHovered] = useState(false);

  useImperativeHandle(forwardedRef, () => ({
    measure: async () => {
      const rect = elementRef.current?.getBoundingClientRect();
      return rect
        ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        : null;
    },
  }));

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const finish = () => {
    clearTimer();
    if (selectingRef.current) {
      selectingRef.current = false;
      onSelectionEnd?.();
    }
    onPressOut?.();
  };

  const start = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    clearTimer();
    selectingRef.current = false;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser tests and older WebViews may not expose capture for
      // the active pointer; movement still works while events target the word.
    }
    onPressIn?.();
    timer.current = setTimeout(() => {
      timer.current = null;
      const rect = element.getBoundingClientRect();
      const anchor = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      if (onSelectionStart) {
        selectingRef.current = true;
        onSelectionStart(anchor);
      } else {
        onLongPress(anchor);
      }
    }, LONG_PRESS_DELAY_MS);
  };

  useEffect(
    () => () => {
      clearTimer();
    },
    [],
  );

  return (
    <span
      ref={elementRef}
      aria-description={accessibilityHint}
      onPointerDown={start}
      onPointerMove={(event) => {
        if (!selectingRef.current) return;
        event.preventDefault();
        onSelectionMove?.({ x: event.clientX, y: event.clientY });
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onMouseEnter={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      style={{
        ...(StyleSheet.flatten(style) as React.CSSProperties),
        transition:
          "background-color 140ms ease, color 140ms ease, box-shadow 140ms ease",
        WebkitTapHighlightColor: "transparent",
        ...(hovered
          ? {
              backgroundColor: "rgba(30, 98, 88, 0.08)",
              borderRadius: 3,
              boxShadow: "0 0 0 2px rgba(30, 98, 88, 0.04)",
            }
          : {}),
      }}
    >
      {children}
    </span>
  );
});
