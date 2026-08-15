import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { LearningSettings } from "./types";

const REMINDER_ID_KEY = "rr:daily-reminder-id";
const CHANNEL_ID = "daily-reading";

let handlerConfigured = false;

export async function syncDailyReminder(
  settings: LearningSettings,
  requestPermission = false,
): Promise<"scheduled" | "disabled" | "denied" | "unsupported"> {
  if (Platform.OS === "web") return "unsupported";
  const Notifications = await import("expo-notifications");
  if (!handlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerConfigured = true;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "每日阅读提醒",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existingId = await AsyncStorage.getItem(REMINDER_ID_KEY);
  if (existingId) {
    await Notifications.cancelScheduledNotificationAsync(existingId).catch(
      () => undefined,
    );
    await AsyncStorage.removeItem(REMINDER_ID_KEY);
  }
  if (!settings.dailyReminderEnabled) return "disabled";

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted" && requestPermission) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== "granted") return "denied";

  const [hour, minute] = settings.reminderTime.split(":").map(Number);
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: "今天的英语阅读准备好了",
      body: "读一篇真题，顺手记住几个新单词。",
      data: { destination: "today" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === "android" ? CHANNEL_ID : undefined,
    },
  });
  await AsyncStorage.setItem(REMINDER_ID_KEY, identifier);
  return "scheduled";
}
