import React, { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import type { LongPressWordProps } from "./LongPressWord";

const LONG_PRESS_DELAY_MS = 550;

export function LongPressWord({
  children,
  accessibilityHint,
  onLongPress,
  onPressIn,
  onPressOut,
  style,
}: LongPressWordProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    cancel();
    onPressIn?.();
    timer.current = setTimeout(() => {
      timer.current = null;
      onPressOut?.();
      onLongPress();
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
      role="button"
      aria-description={accessibilityHint}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onDragStart={(event) => event.preventDefault()}
      style={StyleSheet.flatten(style) as React.CSSProperties}
    >
      {children}
    </span>
  );
}
