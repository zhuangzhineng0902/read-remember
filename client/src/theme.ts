import { Platform } from "react-native";

export const colors = {
  background: "#F7F5EF",
  surface: "#FFFFFF",
  surfaceMuted: "#EFEEE8",
  ink: "#1C2926",
  inkMuted: "#68736F",
  primary: "#1E6258",
  primaryDark: "#154A43",
  primarySoft: "#E1EFEB",
  accent: "#E9A23B",
  highlight: "#FFF0B8",
  line: "#E4E4DD",
  danger: "#C65D4B",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: "#15322B",
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 2 },
    default: {},
  }),
};
