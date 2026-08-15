import React from "react";
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
  return (
    <Text
      accessible={false}
      accessibilityHint={accessibilityHint}
      onLongPress={(event) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onLongPress({
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          width: 0,
          height: 0,
        });
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={style}
    >
      {children}
    </Text>
  );
}
