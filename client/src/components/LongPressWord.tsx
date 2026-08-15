import React from "react";
import { StyleProp, Text, TextStyle } from "react-native";

export type LongPressWordProps = {
  children: React.ReactNode;
  accessibilityHint?: string;
  onLongPress: () => void;
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
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={style}
    >
      {children}
    </Text>
  );
}
