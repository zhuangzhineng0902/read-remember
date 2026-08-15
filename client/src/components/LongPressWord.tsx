import React, { useEffect, useRef } from "react";
import { StyleProp, Text, TextStyle } from "react-native";
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
  style?: StyleProp<TextStyle>;
};

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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Text
      accessible={false}
      accessibilityHint={accessibilityHint}
      onPressIn={(event) => {
        cancel();
        onPressIn?.();
        const anchor = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          width: 0,
          height: 0,
        };
        timer.current = setTimeout(() => {
          timer.current = null;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onLongPress(anchor);
        }, 380);
      }}
      onPressOut={cancel}
      style={style}
    >
      {children}
    </Text>
  );
}
