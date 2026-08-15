import React, { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { LongPressWordProps } from "./LongPressWord";

const LONG_PRESS_DELAY_MS = 380;

export function LongPressWord({
  children,
  accessibilityHint,
  onLongPress,
  onPressIn,
  onPressOut,
  style,
}: LongPressWordProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onPressOut?.();
  };

  const start = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    cancel();
    onPressIn?.();
    timer.current = setTimeout(() => {
      timer.current = null;
      onPressOut?.();
      const rect = element.getBoundingClientRect();
      onLongPress({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }, LONG_PRESS_DELAY_MS);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span
      aria-description={accessibilityHint}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onMouseEnter={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
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
}
