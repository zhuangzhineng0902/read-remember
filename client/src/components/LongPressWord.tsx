import React, { forwardRef, useImperativeHandle, useRef } from "react";
import {
  type GestureResponderEvent,
  StyleProp,
  Text,
  TextStyle,
} from "react-native";
import * as Haptics from "expo-haptics";

export type WordAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LongPressWordProps = {
  children: React.ReactNode;
  accessibilityHint?: string;
  onLongPress: (anchor?: WordAnchor) => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  onSelectionStart?: (anchor?: WordAnchor) => void;
  onSelectionMove?: (point: { x: number; y: number }) => void;
  onSelectionEnd?: () => void;
  style?: StyleProp<TextStyle>;
};

export type LongPressWordHandle = {
  measure: () => Promise<WordAnchor | null>;
};

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
  const textRef = useRef<Text>(null);
  const selectingRef = useRef(false);
  const responderMoveSeenRef = useRef(false);

  useImperativeHandle(forwardedRef, () => ({
    measure: () =>
      new Promise((resolve) => {
        const node = textRef.current;
        if (!node) {
          resolve(null);
          return;
        }
        node.measureInWindow((x, y, width, height) =>
          resolve({ x, y, width, height }),
        );
      }),
  }));

  const finishSelection = () => {
    if (!selectingRef.current) return;
    selectingRef.current = false;
    responderMoveSeenRef.current = false;
    onSelectionEnd?.();
  };

  const moveSelection = (
    event: GestureResponderEvent,
    source: "responder" | "touch",
  ) => {
    if (!selectingRef.current) return;
    if (source === "touch" && responderMoveSeenRef.current) return;
    if (source === "responder") responderMoveSeenRef.current = true;
    const x = event.nativeEvent.pageX;
    const y = event.nativeEvent.pageY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    onSelectionMove?.({
      x,
      y,
    });
  };

  return (
    <Text
      ref={textRef}
      accessible={false}
      accessibilityHint={accessibilityHint}
      onLongPress={(event) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const anchor = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          width: 0,
          height: 0,
        };
        if (onSelectionStart) {
          selectingRef.current = true;
          responderMoveSeenRef.current = false;
          onSelectionStart(anchor);
        } else {
          onLongPress(anchor);
        }
      }}
      onPressIn={onPressIn}
      onPressOut={() => {
        onPressOut?.();
      }}
      {...({
        onResponderMove: (event: GestureResponderEvent) =>
          moveSelection(event, "responder"),
        onResponderRelease: finishSelection,
        onResponderTerminate: finishSelection,
        onTouchMove: (event: GestureResponderEvent) =>
          moveSelection(event, "touch"),
        onTouchEnd: finishSelection,
        onTouchCancel: finishSelection,
      } as any)}
      style={style}
    >
      {children}
    </Text>
  );
});
