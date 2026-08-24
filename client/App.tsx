import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ArrowLeft,
  Bell,
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  GraduationCap,
  Headphones,
  History as HistoryIcon,
  Home,
  Library,
  Languages,
  Menu,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Square,
  Target,
  Volume2,
  X,
} from "lucide-react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import {
  api,
  type ArticleAudioConfig,
  type ManualPush,
} from "./src/api";
import {
  articles,
  exams,
  getDailyArticles,
  getExam,
  lookupWord,
} from "./src/data";
import {
  defaultInterestIds,
  getInterestArticles,
  getInterestCategory,
  interestCategories,
} from "./src/interest-data";
import { storage } from "./src/storage";
import { syncDailyReminder } from "./src/notifications";
import { colors, radius, shadows, spacing } from "./src/theme";
import { LongPressWord } from "./src/components/LongPressWord";
import {
  isReviewDue,
  reviewIntervalLabel,
  scheduleMemoryReview,
} from "./src/memory";
import {
  AnswerResult,
  Article,
  ArticleAnswerState,
  ArticleTranslation,
  ArticleTimerSettings,
  ExamId,
  HistoryRecord,
  InterestCategory,
  InterestId,
  LearningSettings,
  LearningStats,
  MemoryRating,
  MistakeItem,
  ReaderSettings,
  ReminderStyle,
  SavedWord,
  UserProfile,
  WordInfo,
} from "./src/types";

type TabId = "today" | "history" | "words" | "profile";

const navItems: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "today", label: "今日阅读", icon: Home },
  { id: "history", label: "阅读历史", icon: HistoryIcon },
  { id: "words", label: "生词库", icon: BookMarked },
  { id: "profile", label: "我的", icon: Settings },
];

const formatDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatChineseDate = (date = new Date()) =>
  `${date.getMonth() + 1}月${date.getDate()}日 · ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]}`;

const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontScale: 1,
  lineSpacing: "standard",
  fontFamily: "serif",
  pageTone: "paper",
  columnWidth: "standard",
};

const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  dailyReminderEnabled: true,
  reminderTime: "20:30",
  pronunciationAccent: "us",
  dailyGoal: 3,
};

const EMPTY_LEARNING_STATS: LearningStats = {
  completedArticles: 0,
  learningDays: 0,
  readingSeconds: 0,
  streakDays: 0,
  savedWords: 0,
  dueWords: 0,
  answeredQuestions: 0,
  correctAnswers: 0,
};

const USE_NATIVE_DRIVER = Platform.OS !== "web";
const MOBILE_NAV_HEIGHT = Platform.OS === "ios" ? 52 : 64;

type ChoiceOption = {
  id: string;
  label: string;
  description?: string;
};

type AppNotice = {
  title: string;
  message: string;
  tone?: "info" | "error";
};

const readerTone = {
  paper: { background: "#E9E5DB", paper: "#F3F1EA" },
  white: { background: "#F7F7F5", paper: "#FFFFFF" },
  green: { background: "#EAF1E8", paper: "#F7FBF5" },
} as const;

const clampTimerMinutes = (value: number) =>
  Math.max(1, Math.min(180, Math.round(value || 1)));

const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);

  return reducedMotion;
}

function PageTransition({
  children,
  transitionKey,
}: {
  children: React.ReactNode;
  transitionKey: string;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [progress, reducedMotion, transitionKey]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.42, 1],
        }),
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [10, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function NativeChoiceSheet({
  visible,
  title,
  subtitle,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: ChoiceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;

  return (
    <Modal
      animationType={tablet ? "fade" : "slide"}
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[
          styles.nativeModalRoot,
          tablet && styles.nativeModalRootDesktop,
        ]}
      >
        <Pressable
          accessibilityLabel="关闭选择面板"
          onPress={onClose}
          style={styles.nativeModalBackdrop}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.nativeSheet,
            tablet && styles.nativeSheetDesktop,
          ]}
        >
          {!tablet && <View style={styles.nativeSheetHandle} />}
          <View style={styles.nativeSheetHeader}>
            <View style={styles.flexOne}>
              <Text style={styles.nativeSheetTitle}>{title}</Text>
              {!!subtitle && (
                <Text style={styles.nativeSheetSubtitle}>{subtitle}</Text>
              )}
            </View>
            <Pressable
              accessibilityLabel="关闭"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.nativeSheetClose,
                pressed && styles.pressed,
              ]}
            >
              <X size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
          <View style={styles.nativeChoiceList}>
            {options.map((option) => {
              const selected = option.id === selectedId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  key={option.id}
                  onPress={() => onSelect(option.id)}
                  style={({ pressed }) => [
                    styles.nativeChoiceItem,
                    selected && styles.nativeChoiceItemSelected,
                    pressed && styles.nativeChoiceItemPressed,
                  ]}
                >
                  <View style={styles.flexOne}>
                    <Text
                      style={[
                        styles.nativeChoiceLabel,
                        selected && styles.nativeChoiceLabelSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {!!option.description && (
                      <Text style={styles.nativeChoiceDescription}>
                        {option.description}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.nativeChoiceCheck,
                      selected && styles.nativeChoiceCheckSelected,
                    ]}
                  >
                    {selected && <Check size={15} color="#fff" strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function InterestPickerSheet({
  visible,
  selected,
  onSave,
  onClose,
}: {
  visible: boolean;
  selected: InterestId[];
  onSave: (value: InterestId[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [draft, setDraft] = useState<InterestId[]>(selected);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setDraft(selected);
  }, [selected, visible]);

  const save = async () => {
    if (saving || draft.length === 0) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType={tablet ? "fade" : "slide"}
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[
          styles.nativeModalRoot,
          tablet && styles.nativeModalRootDesktop,
        ]}
      >
        <Pressable
          accessibilityLabel="关闭兴趣选择"
          onPress={onClose}
          style={styles.nativeModalBackdrop}
        />
        <View
          accessibilityViewIsModal
          style={[styles.nativeSheet, tablet && styles.nativeSheetDesktop]}
        >
          {!tablet && <View style={styles.nativeSheetHandle} />}
          <View style={styles.nativeSheetHeader}>
            <View style={styles.flexOne}>
              <Text style={styles.nativeSheetTitle}>选择兴趣栏目</Text>
              <Text style={styles.nativeSheetSubtitle}>
                每日推荐会从已选栏目中混入一篇，至少选择一项
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              hitSlop={8}
              onPress={onClose}
              style={styles.nativeSheetClose}
            >
              <X size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
          <View style={styles.interestPickerGrid}>
            {interestCategories.map((category) => {
              const active = draft.includes(category.id);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  aria-checked={active}
                  key={category.id}
                  onPress={() =>
                    setDraft((current) =>
                      current.includes(category.id)
                        ? current.filter((id) => id !== category.id)
                        : [...current, category.id],
                    )
                  }
                  style={({ pressed }) => [
                    styles.interestPickerItem,
                    active && styles.interestPickerItemActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.interestPickerEmoji}>{category.emoji}</Text>
                  <View style={styles.flexOne}>
                    <Text style={styles.interestPickerTitle}>{category.name}</Text>
                    <Text style={styles.interestPickerSubtitle}>
                      {category.subtitle}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.nativeChoiceCheck,
                      active && styles.nativeChoiceCheckSelected,
                    ]}
                  >
                    {active && <Check size={15} color="#fff" strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {draft.length === 0 && (
            <Text style={styles.interestPickerError}>请至少选择一个栏目</Text>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={draft.length === 0 || saving}
            onPress={() => void save()}
            style={[
              styles.primaryButton,
              (draft.length === 0 || saving) && styles.disabledButton,
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>保存兴趣</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DailyGoalSheet({
  visible,
  value,
  onSave,
  onClose,
}: {
  visible: boolean;
  value: number;
  onSave: (value: number) => void | Promise<void>;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10;

  useEffect(() => {
    if (visible) setDraft(String(value));
  }, [value, visible]);

  const adjust = (amount: number) => {
    const base = valid ? parsed : value;
    setDraft(String(Math.min(10, Math.max(1, base + amount))));
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(parsed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType={tablet ? "fade" : "slide"}
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 12 : 0}
        style={[
          styles.nativeModalRoot,
          tablet && styles.nativeModalRootDesktop,
        ]}
      >
        <Pressable
          accessibilityLabel="关闭每日阅读目标设置"
          onPress={onClose}
          style={styles.nativeModalBackdrop}
        />
        <View
          accessibilityViewIsModal
          style={[styles.nativeSheet, tablet && styles.nativeSheetDesktop]}
        >
          {!tablet && <View style={styles.nativeSheetHandle} />}
          <View style={styles.nativeSheetHeader}>
            <View style={styles.flexOne}>
              <Text style={styles.nativeSheetTitle}>每日阅读目标</Text>
              <Text style={styles.nativeSheetSubtitle}>
                保存后会立即补足今天的推荐，文章不会重复
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              hitSlop={8}
              onPress={onClose}
              style={styles.nativeSheetClose}
            >
              <X size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
          <View style={styles.goalStepper}>
            <Pressable
              accessibilityLabel="减少一篇"
              disabled={valid && parsed <= 1}
              onPress={() => adjust(-1)}
              style={({ pressed }) => [
                styles.goalStepButton,
                pressed && styles.pressed,
              ]}
            >
              <Minus size={22} color={colors.primary} />
            </Pressable>
            <View style={styles.goalInputWrap}>
              <TextInput
                accessibilityLabel="每日阅读文章篇数"
                autoFocus
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={(text) => setDraft(text.replace(/\D/g, ""))}
                selectTextOnFocus
                style={[
                  styles.goalInput,
                  Platform.OS === "web" &&
                    ({ outlineStyle: "none" } as unknown as TextStyle),
                ]}
                value={draft}
              />
              <Text pointerEvents="none" style={styles.goalInputUnit}>
                篇 / 天
              </Text>
            </View>
            <Pressable
              accessibilityLabel="增加一篇"
              disabled={valid && parsed >= 10}
              onPress={() => adjust(1)}
              style={({ pressed }) => [
                styles.goalStepButton,
                pressed && styles.pressed,
              ]}
            >
              <Plus size={22} color={colors.primary} />
            </Pressable>
          </View>
          <Text style={[styles.goalRangeHint, !valid && styles.goalRangeError]}>
            {valid ? "可设置 1–10 篇" : "请输入 1–10 之间的整数"}
          </Text>
          <Pressable
            accessibilityLabel="保存每日阅读目标"
            disabled={!valid || saving}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.goalSaveButton,
              pressed && styles.pressed,
              (!valid || saving) && styles.disabledButton,
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.goalSaveText}>保存并更新今日推荐</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NativeNoticeModal({
  notice,
  primaryLabel = "知道了",
  secondaryLabel,
  onPrimary,
  onSecondary,
  onClose,
}: {
  notice: AppNotice | null;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  if (!notice) return null;

  const tone = notice.tone ?? "info";
  const primary = () => {
    onClose();
    onPrimary?.();
  };
  const secondary = () => {
    onClose();
    onSecondary?.();
  };

  return (
    <Modal
      animationType={tablet ? "fade" : "slide"}
      transparent
      visible
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[
          styles.nativeModalRoot,
          tablet && styles.nativeModalRootDesktop,
        ]}
      >
        <Pressable onPress={onClose} style={styles.nativeModalBackdrop} />
        <View
          accessibilityViewIsModal
          style={[
            styles.nativeNoticeSheet,
            tablet && styles.nativeNoticeSheetDesktop,
          ]}
        >
          {!tablet && <View style={styles.nativeSheetHandle} />}
          <View
            style={[
              styles.nativeNoticeIcon,
              tone === "error" && styles.nativeNoticeIconError,
            ]}
          >
            {tone === "error" ? (
              <X size={22} color={colors.danger} strokeWidth={2.5} />
            ) : (
              <Sparkles size={22} color={colors.primary} />
            )}
          </View>
          <Text style={styles.nativeNoticeTitle}>{notice.title}</Text>
          <Text style={styles.nativeNoticeText}>{notice.message}</Text>
          <View style={styles.nativeNoticeActions}>
            {!!secondaryLabel && (
              <Pressable
                onPress={secondary}
                style={({ pressed }) => [
                  styles.nativeNoticeSecondary,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.nativeNoticeSecondaryText}>
                  {secondaryLabel}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={primary}
              style={({ pressed }) => [
                styles.nativeNoticePrimary,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.nativeNoticePrimaryText}>{primaryLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type AccountMode = "login" | "register" | "profile";

function AccountSheet({
  user,
  deviceId,
  initialMode,
  dismissible = true,
  onClose,
  onAuthenticated,
  onProfileUpdated,
  onLogout,
}: {
  user: UserProfile | null;
  deviceId: string;
  initialMode: AccountMode;
  dismissible?: boolean;
  onClose: () => void;
  onAuthenticated: (
    session: UserProfile & { token: string },
    isNewAccount?: boolean,
  ) => Promise<void>;
  onProfileUpdated: (profile: UserProfile) => void;
  onLogout: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [mode, setMode] = useState<AccountMode>(initialMode);
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const switchMode = (next: AccountMode) => {
    setMode(next);
    setError("");
    setSuccess("");
    setPassword("");
  };

  const submit = async () => {
    if (submitting) return;
    setError("");
    setSuccess("");
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
      setError("用户名需为 3-24 位字母、数字或下划线");
      return;
    }
    if ((mode === "register" || mode === "profile") && !displayName.trim()) {
      setError("请输入昵称");
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (mode !== "profile" && password.length < 8) {
      setError("密码至少需要 8 位");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login") {
        const session = await api.login(username.trim(), password);
        await onAuthenticated(session, false);
        onClose();
      } else if (mode === "register") {
        const session = await api.register({
          deviceId,
          username: username.trim(),
          password,
          displayName: displayName.trim(),
          email: email.trim(),
        });
        await onAuthenticated(session, true);
        onClose();
      } else {
        const updated = await api.updateProfile({
          username: username.trim(),
          displayName: displayName.trim(),
          email: email.trim(),
        });
        onProfileUpdated(updated);
        setSuccess("个人资料已保存");
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "操作失败，请稍后再试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitPassword = async () => {
    if (passwordSubmitting) return;
    setError("");
    setSuccess("");
    if (currentPassword.length < 8) {
      setError("请输入当前密码");
      return;
    }
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位");
      return;
    }
    setPasswordSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("密码已更新，下次登录请使用新密码");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "密码修改失败",
      );
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const formTitle =
    mode === "profile" ? "编辑个人资料" : mode === "login" ? "登录拾词" : "注册拾词";
  const formSubtitle =
    mode === "profile"
      ? "修改后会同步到你的学习账号"
      : mode === "login"
        ? "登录后同步阅读历史、生词与复习进度"
        : "注册后会保留当前设备上的学习数据";

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => dismissible && onClose()}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[
          styles.nativeModalRoot,
          styles.accountModalRoot,
        ]}
      >
        {dismissible ? (
          <Pressable onPress={onClose} style={styles.nativeModalBackdrop} />
        ) : (
          <View style={styles.nativeModalBackdrop} />
        )}
        <View
          accessibilityViewIsModal
          style={[
            styles.accountSheet,
            tablet && styles.accountSheetDesktop,
          ]}
        >
          <View style={styles.nativeSheetHeader}>
            <View style={styles.flexOne}>
              <Text style={styles.nativeSheetTitle}>{formTitle}</Text>
              <Text style={styles.nativeSheetSubtitle}>{formSubtitle}</Text>
            </View>
            {dismissible && (
              <Pressable
                accessibilityLabel="关闭账号面板"
                onPress={onClose}
                style={styles.nativeSheetClose}
              >
                <X size={18} color={colors.inkMuted} />
              </Pressable>
            )}
          </View>

          {mode !== "profile" && !user?.isRegistered && (
            <View accessibilityRole="tablist" style={styles.accountModeTabs}>
              {(["login", "register"] as const).map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === item }}
                  aria-selected={mode === item}
                  key={item}
                  onPress={() => switchMode(item)}
                  style={[
                    styles.accountModeTab,
                    mode === item && styles.accountModeTabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.accountModeText,
                      mode === item && styles.accountModeTextActive,
                    ]}
                  >
                    {item === "login" ? "登录" : "注册"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.accountForm}
          >
            {(mode === "register" || mode === "profile") && (
              <View style={styles.accountField}>
                <Text style={styles.accountFieldLabel}>昵称</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="请输入昵称"
                  placeholderTextColor="#98A09D"
                  style={styles.accountInput}
                  maxLength={30}
                />
              </View>
            )}
            <View style={styles.accountField}>
              <Text style={styles.accountFieldLabel}>用户名</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="3-24 位字母、数字或下划线"
                placeholderTextColor="#98A09D"
                style={styles.accountInput}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
              />
            </View>
            {(mode === "register" || mode === "profile") && (
              <View style={styles.accountField}>
                <Text style={styles.accountFieldLabel}>邮箱（选填）</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="用于账号联系"
                  placeholderTextColor="#98A09D"
                  style={styles.accountInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </View>
            )}
            {mode !== "profile" && (
              <View style={styles.accountField}>
                <Text style={styles.accountFieldLabel}>密码</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="至少 8 位"
                  placeholderTextColor="#98A09D"
                  style={styles.accountInput}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
            )}

            {!!error && <Text style={styles.accountError}>{error}</Text>}
            {!!success && <Text style={styles.accountSuccess}>{success}</Text>}

            <Pressable
              disabled={submitting}
              onPress={submit}
              style={({ pressed }) => [
                styles.accountPrimaryButton,
                pressed && styles.primaryButtonPressed,
                submitting && styles.disabledButton,
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.accountPrimaryText}>
                  {mode === "login"
                    ? "登录"
                    : mode === "register"
                      ? "创建账号"
                      : "保存资料"}
                </Text>
              )}
            </Pressable>

            {mode === "profile" && (
              <View>
              <View style={styles.passwordSection}>
                <Text style={styles.passwordSectionTitle}>修改密码</Text>
                <Text style={styles.passwordSectionHint}>
                  修改后不会影响当前设备的登录状态
                </Text>
                <View style={styles.accountField}>
                  <Text style={styles.accountFieldLabel}>当前密码</Text>
                  <TextInput
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="输入当前密码"
                    placeholderTextColor="#98A09D"
                    style={styles.accountInput}
                    secureTextEntry
                  />
                </View>
                <View style={styles.accountField}>
                  <Text style={styles.accountFieldLabel}>新密码</Text>
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="至少 8 位"
                    placeholderTextColor="#98A09D"
                    style={styles.accountInput}
                    secureTextEntry
                  />
                </View>
                <Pressable
                  disabled={passwordSubmitting}
                  onPress={submitPassword}
                  style={({ pressed }) => [
                    styles.accountSecondaryButton,
                    pressed && styles.pressed,
                    passwordSubmitting && styles.disabledButton,
                  ]}
                >
                  {passwordSubmitting ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.accountSecondaryText}>更新密码</Text>
                  )}
                </Pressable>
              </View>
              <Pressable
                onPress={() => switchMode("login")}
                style={({ pressed }) => [
                  styles.accountSwitchButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.accountSwitchText}>登录其他账号</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="退出当前账号"
                onPress={onLogout}
                style={({ pressed }) => [
                  styles.accountLogoutButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.accountLogoutText}>退出当前账号</Text>
              </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function sentenceContainingWord(paragraph: string, word: string) {
  const sentences = paragraph.match(/[^.!?]+[.!?]?/g) ?? [paragraph];
  const matched = sentences.find((sentence) =>
    sentence
      .toLowerCase()
      .split(/[^a-z'-]+/)
      .includes(word),
  );
  return (matched ?? paragraph).trim().slice(0, 450);
}

let pronunciationPlayer: AudioPlayer | null = null;
let pronunciationReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let pronunciationStartTimer: ReturnType<typeof setTimeout> | null = null;
let pronunciationStatusSubscription: { remove: () => void } | null = null;
let pronunciationPlaybackGeneration = 0;
let stopActiveArticleNarration: (() => void) | null = null;

type AudioPlaybackState = "idle" | "loading" | "playing" | "error";

type AudioPlaybackCallbacks = {
  onLoading: () => void;
  onPlaying: () => void;
  onFinished: () => void;
  onError: () => void;
};

function stopWordAudio() {
  pronunciationPlaybackGeneration += 1;
  if (pronunciationReleaseTimer) {
    clearTimeout(pronunciationReleaseTimer);
    pronunciationReleaseTimer = null;
  }
  if (pronunciationStartTimer) {
    clearTimeout(pronunciationStartTimer);
    pronunciationStartTimer = null;
  }
  pronunciationStatusSubscription?.remove();
  pronunciationStatusSubscription = null;
  try {
    pronunciationPlayer?.pause();
    pronunciationPlayer?.release();
  } catch {
    // The player may already have stopped or released itself.
  }
  pronunciationPlayer = null;
  Speech.stop();
}

async function playWord(
  word: string,
  callbacks: AudioPlaybackCallbacks = {
    onLoading: () => {},
    onPlaying: () => {},
    onFinished: () => {},
    onError: () => {},
  },
  accent: "us" | "uk" = "us",
) {
  stopActiveArticleNarration?.();
  stopWordAudio();
  const playbackGeneration = pronunciationPlaybackGeneration;
  const isCurrent = () =>
    playbackGeneration === pronunciationPlaybackGeneration;
  const markPlaying = () => {
    if (!isCurrent()) return;
    if (pronunciationStartTimer) {
      clearTimeout(pronunciationStartTimer);
      pronunciationStartTimer = null;
    }
    callbacks.onPlaying();
  };
  const finish = () => {
    if (!isCurrent()) return;
    callbacks.onFinished();
    stopWordAudio();
  };
  const fail = () => {
    if (!isCurrent()) return;
    callbacks.onError();
    stopWordAudio();
  };
  callbacks.onLoading();
  try {
    const pronunciation = await api.getPronunciation(word, accent, "", true);
    if (!isCurrent()) return;
    const matchesRequestedAccent =
      !pronunciation.actualAccent ||
      pronunciation.actualAccent === "unknown" ||
      pronunciation.actualAccent === accent;
    if (pronunciation.audioUrl && matchesRequestedAccent) {
      pronunciationPlayer = createAudioPlayer(pronunciation.audioUrl);
      pronunciationStatusSubscription = pronunciationPlayer.addListener(
        "playbackStatusUpdate",
        (status) => {
          if (status.playing) markPlaying();
          if (status.didJustFinish) finish();
        },
      );
      pronunciationPlayer.play();
      pronunciationStartTimer = setTimeout(fail, 5_000);
      pronunciationReleaseTimer = setTimeout(() => {
        finish();
      }, 15_000);
      return;
    }
  } catch {
    // Device speech remains available when the dictionary service is offline.
  }
  if (!isCurrent()) return;
  try {
    pronunciationStartTimer = setTimeout(fail, 5_000);
    Speech.speak(word, {
      language: accent === "uk" ? "en-GB" : "en-US",
      rate: 0.82,
      pitch: 1,
      onStart: markPlaying,
      onDone: finish,
      onStopped: finish,
      onError: fail,
    });
  } catch {
    fail();
  }
}

function WordAudioButton({
  word,
  pronunciationAccent,
  variant = "popover",
}: {
  word: string;
  pronunciationAccent: LearningSettings["pronunciationAccent"];
  variant?: "popover" | "memory";
}) {
  const reducedMotion = useReducedMotion();
  const [audioState, setAudioState] = useState<AudioPlaybackState>("idle");
  const audioPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setAudioState("idle");
    stopWordAudio();
    return stopWordAudio;
  }, [pronunciationAccent, word]);

  useEffect(() => {
    audioPulse.stopAnimation();
    if (audioState !== "playing" || reducedMotion) {
      audioPulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(audioPulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(audioPulse, {
          toValue: 0,
          duration: 760,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [audioPulse, audioState, reducedMotion]);

  const toggle = () => {
    if (!word || audioState === "loading") return;
    if (audioState === "playing") {
      stopWordAudio();
      setAudioState("idle");
      return;
    }
    void playWord(
      word,
      {
        onLoading: () => setAudioState("loading"),
        onPlaying: () => setAudioState("playing"),
        onFinished: () => setAudioState("idle"),
        onError: () => setAudioState("error"),
      },
      pronunciationAccent,
    );
  };

  return (
    <Pressable
      accessibilityLabel={
        audioState === "playing"
          ? `停止播放 ${word} 的发音`
          : audioState === "loading"
            ? `正在加载 ${word} 的发音`
            : audioState === "error"
              ? `重新播放 ${word} 的发音`
              : `播放 ${word} 的发音`
      }
      accessibilityState={{
        busy: audioState === "loading",
        selected: audioState === "playing",
        disabled: audioState === "loading",
      }}
      disabled={audioState === "loading"}
      onPress={(event) => {
        event.stopPropagation();
        toggle();
      }}
      style={[
        styles.wordAudioButton,
        variant === "memory" && styles.memoryAudioButton,
        audioState === "playing" && styles.wordAudioButtonPlaying,
        audioState === "error" && styles.wordAudioButtonError,
      ]}
    >
      <View style={styles.wordAudioIcon}>
        {audioState === "playing" && !reducedMotion && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.wordAudioPulse,
              {
                opacity: audioPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.45, 0],
                }),
                transform: [
                  {
                    scale: audioPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.8, 1.45],
                    }),
                  },
                ],
              },
            ]}
          />
        )}
        {audioState === "loading" ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : audioState === "playing" ? (
          <Square size={13} color="#fff" fill="#fff" />
        ) : (
          <Volume2
            size={18}
            color={audioState === "error" ? colors.danger : colors.primary}
          />
        )}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={[
          styles.wordAudioText,
          audioState === "playing" && styles.wordAudioTextPlaying,
          audioState === "error" && styles.wordAudioTextError,
        ]}
      >
        {audioState === "loading"
          ? "加载中"
          : audioState === "playing"
            ? "播放中"
            : audioState === "error"
              ? "重试"
              : "播放"}
      </Text>
    </Pressable>
  );
}

function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.logoRow}>
      <View
        style={[
          styles.logoMark,
          compact && { width: 36, height: 36, borderRadius: 12 },
        ]}
      >
        <BookOpen color="#fff" size={compact ? 19 : 22} strokeWidth={2.4} />
      </View>
      {!compact && (
        <View>
          <Text style={styles.logoName}>拾词</Text>
          <Text style={styles.logoEnglish}>READ & REMEMBER</Text>
        </View>
      )}
    </View>
  );
}

function Onboarding({
  onComplete,
}: {
  onComplete: (
    examId: ExamId,
    dailyGoal: number,
    interests: InterestId[],
  ) => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [selected, setSelected] = useState<ExamId>("toefl");
  const [dailyGoal, setDailyGoal] = useState(3);
  const [selectedInterests, setSelectedInterests] = useState<InterestId[]>(
    defaultInterestIds,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const finish = async () => {
    if (submitting) return;
    if (selectedInterests.length === 0) {
      setError("请至少选择一个感兴趣的栏目");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onComplete(selected, dailyGoal, selectedInterests);
    } catch (finishError) {
      setError(
        finishError instanceof Error
          ? finishError.message
          : "初始化学习计划失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[
          styles.onboarding,
          tablet && styles.onboardingTablet,
        ]}
      >
        <View
          style={[
            styles.onboardingIntro,
            tablet && styles.onboardingIntroTablet,
          ]}
        >
          <AppLogo />
          <View style={styles.onboardingCopy}>
            <View style={styles.pillSoft}>
              <Sparkles size={14} color={colors.primary} />
              <Text style={styles.pillSoftText}>
                每天 {dailyGoal} 篇，读有所获
              </Text>
            </View>
            <Text style={[styles.heroTitle, tablet && styles.heroTitleTablet]}>
              从阅读里，{`\n`}把单词真正记下来。
            </Text>
            <Text style={styles.heroBody}>
              匹配你的考试目标，每日精选阅读训练。长按生词，即查即记，在语境中自然扩大词汇量。
            </Text>
          </View>
          <View style={styles.onboardingFeatures}>
            <Feature icon={Target} label="真题难度匹配" />
            <Feature icon={BookMarked} label="语境生词本" />
            <Feature icon={Flame} label="每日阅读习惯" />
          </View>
        </View>

        <View style={[styles.examPanel, tablet && styles.examPanelTablet]}>
          <Text style={styles.stepLabel}>01 / 选择目标</Text>
          <Text style={styles.panelTitle}>你正在准备什么考试？</Text>
          <Text style={styles.panelHint}>之后可以随时在“我的”中切换</Text>
          <View style={styles.examGrid}>
            {exams.map((exam) => {
              const active = selected === exam.id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  aria-checked={active}
                  key={exam.id}
                  onPress={() => setSelected(exam.id)}
                  style={({ pressed }) => [
                    styles.examOption,
                    active && styles.examOptionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.examIcon,
                      { backgroundColor: `${exam.color}16` },
                    ]}
                  >
                    <GraduationCap size={22} color={exam.color} />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.examName}>{exam.name}</Text>
                    <Text style={styles.examSubtitle}>{exam.subtitle}</Text>
                  </View>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <Check size={13} color="#fff" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.onboardingGoalSection}>
            <View style={styles.onboardingGoalCopy}>
              <Text style={styles.stepLabel}>02 / 设置篇数</Text>
              <Text style={styles.onboardingGoalTitle}>每天想读几篇？</Text>
              <Text style={styles.panelHint}>保存后会立即生成今天的推荐</Text>
            </View>
            <View style={styles.onboardingGoalStepper}>
              <Pressable
                accessibilityLabel="减少每日阅读篇数"
                accessibilityState={{ disabled: dailyGoal <= 1 }}
                disabled={dailyGoal <= 1}
                onPress={() => setDailyGoal((value) => Math.max(1, value - 1))}
                style={({ pressed }) => [
                  styles.onboardingGoalButton,
                  pressed && styles.pressed,
                  dailyGoal <= 1 && styles.disabledButton,
                ]}
              >
                <Minus size={20} color={colors.primary} />
              </Pressable>
              <View style={styles.onboardingGoalValue}>
                <Text style={styles.onboardingGoalNumber}>{dailyGoal}</Text>
                <Text style={styles.onboardingGoalUnit}>篇 / 天</Text>
              </View>
              <Pressable
                accessibilityLabel="增加每日阅读篇数"
                accessibilityState={{ disabled: dailyGoal >= 10 }}
                disabled={dailyGoal >= 10}
                onPress={() => setDailyGoal((value) => Math.min(10, value + 1))}
                style={({ pressed }) => [
                  styles.onboardingGoalButton,
                  pressed && styles.pressed,
                  dailyGoal >= 10 && styles.disabledButton,
                ]}
              >
                <Plus size={20} color={colors.primary} />
              </Pressable>
            </View>
          </View>
          <View style={styles.onboardingInterestSection}>
            <Text style={styles.stepLabel}>03 / 选择兴趣</Text>
            <Text style={styles.onboardingGoalTitle}>你喜欢读什么？</Text>
            <Text style={styles.panelHint}>
              每天会混入一篇兴趣文章，可多选
            </Text>
            <View style={styles.interestChipGrid}>
              {interestCategories.map((category) => {
                const active = selectedInterests.includes(category.id);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    aria-checked={active}
                    key={category.id}
                    onPress={() =>
                      setSelectedInterests((current) =>
                        current.includes(category.id)
                          ? current.filter((id) => id !== category.id)
                          : [...current, category.id],
                      )
                    }
                    style={({ pressed }) => [
                      styles.interestChoice,
                      active && styles.interestChoiceActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.interestChoiceEmoji}>
                      {category.emoji}
                    </Text>
                    <Text
                      style={[
                        styles.interestChoiceText,
                        active && styles.interestChoiceTextActive,
                      ]}
                    >
                      {category.name}
                    </Text>
                    {active && <Check size={14} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
          {!!error && <Text style={styles.onboardingError}>{error}</Text>}
          <Pressable
            disabled={submitting}
            onPress={() => void finish()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              submitting && styles.disabledButton,
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>开启今日阅读</Text>
                <ChevronRight color="#fff" size={20} />
              </>
            )}
          </Pressable>
          <Text style={styles.privacyNote}>学习记录会安全同步到你的账号</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Feature({
  icon: Icon,
  label,
}: {
  icon: typeof Target;
  label: string;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <Icon color={colors.primary} size={16} />
      </View>
      <Text style={styles.featureText}>{label}</Text>
    </View>
  );
}

function Header({
  title,
  subtitle,
  onMenu,
  right,
}: {
  title: string;
  subtitle?: string;
  onMenu?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {onMenu && (
          <Pressable
            accessibilityLabel="打开菜单"
            onPress={onMenu}
            style={styles.iconButton}
          >
            <Menu size={21} color={colors.ink} />
          </Pressable>
        )}
        <View>
          {subtitle && <Text style={styles.headerEyebrow}>{subtitle}</Text>}
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
      </View>
      {right}
    </View>
  );
}

function TodayScreen({
  examId,
  daily,
  interestFeed,
  selectedInterests,
  dailyGoal,
  streakDays,
  manualPushes,
  completed,
  onOpen,
  onOpenInterest,
  onOpenPush,
  onNavigate,
}: {
  examId: ExamId;
  daily: Article[];
  interestFeed: Article[];
  selectedInterests: InterestId[];
  dailyGoal: LearningSettings["dailyGoal"];
  streakDays: number;
  manualPushes: ManualPush[];
  completed: string[];
  onOpen: (a: Article) => void;
  onOpenInterest: (a: Article) => void;
  onOpenPush: (articleId: string) => void;
  onNavigate: (tab: TabId) => void;
}) {
  const [interestFilter, setInterestFilter] = useState<InterestId | "all">(
    "all",
  );
  const exam = getExam(examId);
  const done = daily.filter((item) => completed.includes(item.id)).length;
  const goalDone = Math.min(done, dailyGoal);
  const remaining = Math.max(0, dailyGoal - goalDone);
  const visibleInterestArticles = interestFeed.filter(
    (article) =>
      interestFilter === "all" || article.interestId === interestFilter,
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Header
        title="今天，读点什么？"
        subtitle={formatChineseDate()}
        right={
          <Pressable style={styles.avatar}>
            <Text style={styles.avatarText}>R</Text>
          </Pressable>
        }
      />
      <View style={styles.goalCard}>
        <View style={styles.goalTop}>
          <View>
            <Text style={styles.goalEyebrow}>今日阅读计划</Text>
            <Text style={styles.goalTitle}>
              {remaining === 0
                ? "今天的计划完成了"
                : `还剩 ${remaining} 篇，慢慢来`}
            </Text>
          </View>
          <View style={styles.streakPill}>
            <Flame size={15} color={colors.accent} fill={colors.accent} />
            <Text style={styles.streakText}>连续 {streakDays} 天</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(5, (goalDone / dailyGoal) * 100)}%` },
            ]}
          />
        </View>
        <View style={styles.goalBottom}>
          <Text style={styles.goalProgress}>{goalDone} / {dailyGoal} 篇</Text>
          <Text style={styles.goalExam}>{exam.name}</Text>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>今日精选</Text>
          <Text style={styles.sectionSubtitle}>根据你的目标与进度智能匹配</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{daily.length} 篇</Text>
        </View>
      </View>

      <View style={styles.articleList}>
        {daily.map((article, index) => (
          <ArticleCard
            key={article.id}
            article={article}
            index={index}
            completed={completed.includes(article.id)}
            onPress={() => onOpen(article)}
          />
        ))}
      </View>

      {interestFeed.length > 0 && (
        <View style={styles.interestExploreSection}>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>兴趣探索</Text>
              <Text style={styles.sectionSubtitle}>
                在喜欢的故事里遇见新单词
              </Text>
            </View>
            <View style={styles.interestSparkBadge}>
              <Sparkles size={14} color={colors.accent} />
              <Text style={styles.interestSparkText}>课外阅读</Text>
            </View>
          </View>
          <ScrollView
            horizontal
            contentContainerStyle={styles.interestFilterRow}
            showsHorizontalScrollIndicator={false}
          >
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: interestFilter === "all" }}
              onPress={() => setInterestFilter("all")}
              style={[
                styles.interestFilterChip,
                interestFilter === "all" && styles.interestFilterChipActive,
              ]}
            >
              <Text
                style={[
                  styles.interestFilterText,
                  interestFilter === "all" && styles.interestFilterTextActive,
                ]}
              >
                全部
              </Text>
            </Pressable>
            {interestCategories
              .filter((category) => selectedInterests.includes(category.id))
              .map((category) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: interestFilter === category.id }}
                  key={category.id}
                  onPress={() => setInterestFilter(category.id)}
                  style={[
                    styles.interestFilterChip,
                    interestFilter === category.id &&
                      styles.interestFilterChipActive,
                  ]}
                >
                  <Text style={styles.interestFilterEmoji}>{category.emoji}</Text>
                  <Text
                    style={[
                      styles.interestFilterText,
                      interestFilter === category.id &&
                        styles.interestFilterTextActive,
                    ]}
                  >
                    {category.name}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>
          <View style={styles.interestArticleGrid}>
            {visibleInterestArticles.map((article) => (
              <InterestArticleCard
                article={article}
                completed={completed.includes(article.id)}
                key={article.id}
                onPress={() => onOpenInterest(article)}
              />
            ))}
          </View>
        </View>
      )}

      {manualPushes.length > 0 && (
        <>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>每日推荐与运营加练</Text>
              <Text style={styles.sectionSubtitle}>
                根据考试目标自动推荐，也包含专项练习
              </Text>
            </View>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{manualPushes.length} 篇</Text>
            </View>
          </View>
          <View style={styles.articleList}>
            {manualPushes.map((push) => (
              <ManualPushCard
                key={`${push.batchId}-${push.article.id}`}
                push={push}
                completed={completed.includes(push.article.id)}
                onPress={() => onOpenPush(push.article.id)}
              />
            ))}
          </View>
        </>
      )}

      <Pressable
        onPress={() => onNavigate("history")}
        style={styles.historyShortcut}
      >
        <View style={styles.shortcutIcon}>
          <HistoryIcon size={20} color={colors.primary} />
        </View>
        <View style={styles.flexOne}>
          <Text style={styles.shortcutTitle}>想回顾之前的文章？</Text>
          <Text style={styles.shortcutText}>在阅读历史中查看已推送内容</Text>
        </View>
        <ChevronRight size={20} color={colors.inkMuted} />
      </Pressable>
    </ScrollView>
  );
}

function ManualPushCard({
  push,
  completed,
  onPress,
}: {
  push: ManualPush;
  completed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.manualPushCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.manualPushIcon}>
        <Bell size={21} color={colors.accent} />
        {completed && (
          <View style={styles.completedBadge}>
            <Check size={12} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.flexOne}>
        <Text style={styles.manualPushLabel}>{push.pushName}</Text>
        <Text style={styles.manualPushTitle}>{push.article.title}</Text>
        <Text style={styles.manualPushMessage}>{push.message}</Text>
      </View>
      <ChevronRight size={19} color={colors.primary} />
    </Pressable>
  );
}

function ArticleCard({
  article,
  index,
  completed,
  onPress,
}: {
  article: Article;
  index: number;
  completed: boolean;
  onPress: () => void;
}) {
  const cardColors = ["#DCECE7", "#F2E5CF", "#E2E7EF"];
  const interestCategory = getInterestCategory(article.interestId);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.articleCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View
        style={[
          styles.articleNumber,
          { backgroundColor: cardColors[index % 3] },
        ]}
      >
        <Text style={styles.articleNumberText}>0{index + 1}</Text>
        {completed && (
          <View style={styles.completedBadge}>
            <Check size={12} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.articleContent}>
        <View style={styles.articleMetaTop}>
          <Text style={styles.articleEyebrow}>{article.eyebrow}</Text>
          <Text style={styles.articleYear}>
            {article.contentKind === "interest"
              ? `${interestCategory?.emoji ?? "✨"} ${interestCategory?.name ?? "兴趣阅读"}`
              : `${article.year} 真题精选`}
          </Text>
        </View>
        <Text style={styles.articleTitle}>{article.title}</Text>
        <View style={styles.articleMeta}>
          <View style={styles.metaItem}>
            <Clock3 size={14} color={colors.inkMuted} />
            <Text style={styles.metaText}>{article.readMinutes} 分钟</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaText}>难度</Text>
            <Difficulty value={article.difficulty} />
          </View>
          <View style={styles.readButton}>
            <Text style={styles.readButtonText}>
              {completed ? "再读一次" : "开始阅读"}
            </Text>
            <ChevronRight size={16} color={colors.primary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function InterestArticleCard({
  article,
  completed,
  onPress,
}: {
  article: Article;
  completed: boolean;
  onPress: () => void;
}) {
  const category = getInterestCategory(article.interestId);
  return (
    <Pressable
      accessibilityLabel={`阅读${article.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.interestArticleCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View
        style={[
          styles.interestArticleVisual,
          { backgroundColor: `${category?.color ?? colors.primary}18` },
        ]}
      >
        <Text style={styles.interestArticleEmoji}>{category?.emoji ?? "✨"}</Text>
        {completed && (
          <View style={styles.completedBadge}>
            <Check size={12} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.interestArticleBody}>
        <Text style={styles.interestArticleCategory}>
          {article.seriesTitle
            ? `${article.seriesTitle} · 第 ${article.episodeNumber} 章`
            : category?.name ?? "兴趣阅读"}
        </Text>
        <Text style={styles.interestArticleTitle}>{article.title}</Text>
        <View style={styles.interestArticleMeta}>
          <Clock3 size={13} color={colors.inkMuted} />
          <Text style={styles.metaText}>{article.readMinutes} 分钟</Text>
          <Text style={styles.interestArticleDot}>·</Text>
          <Text style={styles.metaText}>初中分级</Text>
          <ChevronRight
            size={17}
            color={colors.primary}
            style={styles.interestArticleChevron}
          />
        </View>
      </View>
    </Pressable>
  );
}

function Difficulty({ value }: { value: number }) {
  return (
    <View style={styles.difficulty}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View
          key={n}
          style={[
            styles.difficultyDot,
            n <= value && styles.difficultyDotActive,
          ]}
        />
      ))}
    </View>
  );
}

type NarrationState = "idle" | "loading" | "playing" | "paused" | "error";

function playbackTime(value: number) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ArticleNarrationPlayer({ article }: { article: Article }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const requestGenerationRef = useRef(0);
  const [config, setConfig] = useState<ArticleAudioConfig | null>(null);
  const [voice, setVoice] = useState("");
  const [speed, setSpeed] = useState(1);
  const [state, setState] = useState<NarrationState>("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [message, setMessage] = useState("正在检查朗读服务…");

  const releasePlayer = () => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    try {
      playerRef.current?.pause();
      playerRef.current?.clearLockScreenControls();
      playerRef.current?.release();
    } catch {
      // The native player may already have been released after an interruption.
    }
    playerRef.current = null;
  };

  useEffect(() => {
    let active = true;
    api
      .getArticleAudioConfig()
      .then((value) => {
        if (!active) return;
        setConfig(value);
        setVoice(
          value.voices.some((item) => item.id === value.defaultVoice)
            ? value.defaultVoice
            : value.voices[0]?.id ?? "",
        );
        setMessage(
          value.enabled
            ? "首次播放会生成音频，之后直接读取缓存"
            : "服务端尚未配置 Kokoro",
        );
      })
      .catch(() => {
        if (!active) return;
        setConfig({
          enabled: false,
          provider: "kokoro",
          defaultVoice: "",
          voices: [],
          playbackSpeeds: [0.8, 1, 1.2],
        });
        setMessage("暂时无法连接朗读服务");
      });
    return () => {
      active = false;
    };
  }, [article.id]);

  useEffect(() => {
    const pause = () => {
      requestGenerationRef.current += 1;
      if (playerRef.current) {
        playerRef.current.pause();
        setState("paused");
      } else {
        setState("idle");
        setMessage("朗读已停止");
      }
    };
    stopActiveArticleNarration = pause;
    return () => {
      if (stopActiveArticleNarration === pause) {
        stopActiveArticleNarration = null;
      }
      requestGenerationRef.current += 1;
      releasePlayer();
    };
  }, [article.id]);

  useEffect(() => {
    if (!playerRef.current) return;
    playerRef.current.setPlaybackRate(speed, "high");
  }, [speed]);

  const selectVoice = (nextVoice: string) => {
    if (nextVoice === voice) return;
    requestGenerationRef.current += 1;
    releasePlayer();
    setVoice(nextVoice);
    setState("idle");
    setPosition(0);
    setDuration(0);
    setMessage("切换音色后将在播放时生成或读取对应缓存");
  };

  const start = async () => {
    if (!config?.enabled || !voice || state === "loading") return;
    if (playerRef.current) {
      if (state === "playing") {
        playerRef.current.pause();
        setState("paused");
      } else {
        stopWordAudio();
        playerRef.current.play();
        setState("playing");
      }
      return;
    }
    stopWordAudio();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setState("loading");
    setMessage("正在生成或读取整篇音频，首次播放可能需要一些时间…");
    try {
      const audio = await api.ensureArticleAudio(article.id, voice);
      if (requestGeneration !== requestGenerationRef.current) return;
      const player = createAudioPlayer(audio.audioUrl, {
        updateInterval: 250,
        downloadFirst: Platform.OS !== "web",
      });
      playerRef.current = player;
      player.setPlaybackRate(speed, "high");
      if (Platform.OS !== "web") {
        player.setActiveForLockScreen(true, {
          title: article.title,
          artist: "拾词 · 整篇朗读",
        });
      }
      subscriptionRef.current = player.addListener(
        "playbackStatusUpdate",
        (status) => {
          setPosition(status.currentTime || 0);
          if (status.duration) setDuration(status.duration);
          if (status.playing) {
            setState("playing");
            setMessage(audio.cached ? "正在播放缓存音频" : "音频已生成并缓存");
          }
          if (status.didJustFinish) {
            setState("idle");
            setPosition(0);
            setMessage("朗读完成，可以重新播放");
            void player.seekTo(0);
          }
        },
      );
      player.play();
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return;
      releasePlayer();
      setState("error");
      setMessage(error instanceof Error ? error.message : "整篇朗读生成失败");
    }
  };

  const restart = () => {
    if (!playerRef.current) return;
    void playerRef.current.seekTo(0).then(() => {
      setPosition(0);
      playerRef.current?.play();
      setState("playing");
    });
  };

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <View style={styles.articleNarrationCard}>
      <View style={styles.articleNarrationTopRow}>
        <View style={styles.articleNarrationIdentity}>
          <View style={styles.articleNarrationIcon}>
            <Headphones size={17} color={colors.primary} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.articleNarrationTitle}>整篇朗读</Text>
            <Text
              numberOfLines={2}
              style={[
                styles.articleNarrationMessage,
                state === "error" && styles.articleNarrationError,
              ]}
            >
              {message}
            </Text>
          </View>
        </View>
        <View style={styles.articleNarrationActions}>
          {playerRef.current && position > 0 && (
            <Pressable
              accessibilityLabel="从头播放"
              hitSlop={8}
              onPress={restart}
              style={({ pressed }) => [
                styles.articleNarrationRestart,
                pressed && styles.pressed,
              ]}
            >
              <RotateCcw size={15} color={colors.inkMuted} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state === "playing" ? "暂停整篇朗读" : "播放整篇朗读"}
            accessibilityState={{ disabled: !config?.enabled || !voice }}
            disabled={!config?.enabled || !voice}
            onPress={start}
            style={({ pressed }) => [
              styles.articleNarrationPlay,
              state === "playing" && styles.articleNarrationPlayActive,
              (!config?.enabled || !voice) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            {state === "loading" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : state === "playing" ? (
              <Pause size={17} color="#fff" fill="#fff" />
            ) : (
              <Play size={17} color="#fff" fill="#fff" />
            )}
          </Pressable>
        </View>
      </View>

      {(duration > 0 || state === "loading") && (
        <View style={styles.articleNarrationProgressRow}>
          <Text style={styles.articleNarrationTime}>{playbackTime(position)}</Text>
          <View style={styles.articleNarrationTrack}>
            <View
              style={[
                styles.articleNarrationTrackFill,
                { width: `${Math.max(state === "loading" ? 3 : 0, progress * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.articleNarrationTime}>
            {duration ? playbackTime(duration) : "生成中"}
          </Text>
        </View>
      )}

      {config?.enabled && config.voices.length > 0 && (
        <View style={styles.articleNarrationControls}>
          <View style={styles.articleNarrationChoiceRow}>
            {config.voices.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: voice === item.id }}
                onPress={() => selectVoice(item.id)}
                style={({ pressed }) => [
                  styles.articleNarrationChoice,
                  voice === item.id && styles.articleNarrationChoiceActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.articleNarrationChoiceText,
                    voice === item.id && styles.articleNarrationChoiceTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.articleNarrationSpeedRow}>
            <Text style={styles.articleNarrationSpeedLabel}>语速</Text>
            {config.playbackSpeeds.map((item) => (
              <Pressable
                key={item}
                accessibilityState={{ selected: speed === item }}
                onPress={() => setSpeed(item)}
                style={({ pressed }) => [
                  styles.articleNarrationSpeed,
                  speed === item && styles.articleNarrationSpeedActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.articleNarrationSpeedText,
                    speed === item && styles.articleNarrationSpeedTextActive,
                  ]}
                >
                  {item}×
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function TimeLimitReminder({
  visible,
  reminderStyle,
  onAddMinute,
  onDismiss,
}: {
  visible: boolean;
  reminderStyle: ReminderStyle;
  onAddMinute: () => void;
  onDismiss: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(0)).current;
  const blade = useRef(new Animated.Value(0)).current;
  const slash = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    entrance.setValue(reducedMotion ? 1 : 0);
    blade.setValue(reducedMotion ? 1 : 0);
    slash.setValue(reducedMotion ? 1 : 0);
    flash.setValue(0);

    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => undefined);

    let voiceTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      Speech.stop();
      Speech.speak("You're out of time.", {
        language: "en-US",
        rate: 0.68,
        pitch: 0.55,
      });
    }, reducedMotion ? 80 : 760);
    let impactTimer: ReturnType<typeof setTimeout> | null = null;

    if (!reducedMotion) {
      Animated.sequence([
        Animated.parallel([
          Animated.spring(entrance, {
            toValue: 1,
            damping: 13,
            stiffness: 180,
            mass: 0.9,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.sequence([
            Animated.timing(flash, {
              toValue: 1,
              duration: 80,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
            Animated.timing(flash, {
              toValue: 0,
              duration: 180,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
        ]),
        Animated.delay(160),
        Animated.parallel([
          Animated.timing(blade, {
            toValue: 1,
            duration: 460,
            easing: Easing.out(Easing.back(1.25)),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.sequence([
            Animated.delay(190),
            Animated.timing(slash, {
              toValue: 1,
              duration: 250,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
          ]),
        ]),
      ]).start();
      impactTimer = setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(
          () => undefined,
        );
      }, 720);
    }

    return () => {
      if (voiceTimer) clearTimeout(voiceTimer);
      if (impactTimer) clearTimeout(impactTimer);
      voiceTimer = null;
      impactTimer = null;
      entrance.stopAnimation();
      blade.stopAnimation();
      slash.stopAnimation();
      flash.stopAnimation();
      Speech.stop();
    };
  }, [blade, entrance, flash, reducedMotion, slash, visible]);

  const close = (action: () => void) => {
    Speech.stop();
    action();
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => close(onDismiss)}
    >
      <View
        accessibilityViewIsModal
        accessibilityLabel="阅读时间已到。You're out of time."
        style={styles.timeUpRoot}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.timeUpFlash, { opacity: flash }]}
        />
        <View pointerEvents="none" style={styles.timeUpGrid}>
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <View
              key={item}
              style={[styles.timeUpScanLine, { top: `${12 + item * 15}%` }]}
            />
          ))}
        </View>

        <Animated.View
          style={[
            styles.timeUpContent,
            {
              opacity: entrance,
              transform: [
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.72, 1],
                  }),
                },
                {
                  translateY: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [38, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.timeUpCodeRow}>
            <View style={styles.timeUpCodeDot} />
            <Text style={styles.timeUpCode}>ALERT // LIMIT-00</Text>
            <Text style={styles.timeUpStyleTag}>
              {reminderStyle === "mecha-blade" ? "MECHA BLADE" : "ALERT"}
            </Text>
          </View>

          <View style={styles.mechaStage}>
            <View style={styles.mechaBackGlow} />
            <View style={styles.mechaUnit}>
              <View style={styles.mechaFinLeft} />
              <View style={styles.mechaFinRight} />
              <View style={styles.mechaHead}>
                <View style={styles.mechaFace} />
                <View style={styles.mechaVisor} />
              </View>
              <View style={styles.mechaNeck} />
              <View style={styles.mechaTorso}>
                <View style={styles.mechaChestLeft} />
                <View style={styles.mechaChestCore} />
                <View style={styles.mechaChestRight} />
              </View>
              <View style={[styles.mechaShoulder, styles.mechaShoulderLeft]} />
              <View style={[styles.mechaShoulder, styles.mechaShoulderRight]} />
            </View>
            <Animated.View
              style={[
                styles.mechaSword,
                {
                  transform: [
                    { translateX: -74 },
                    {
                      rotate: blade.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["-62deg", "24deg"],
                      }),
                    },
                    {
                      translateX: blade.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-22, 34],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.mechaSwordBlade} />
              <View style={styles.mechaSwordGuard} />
              <View style={styles.mechaSwordHandle} />
            </Animated.View>
            <Animated.View
              style={[
                styles.mechaSlash,
                {
                  opacity: slash.interpolate({
                    inputRange: [0, 0.15, 0.78, 1],
                    outputRange: [0, 1, 0.9, 0],
                  }),
                  transform: [
                    { rotate: "-22deg" },
                    {
                      translateX: slash.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-260, 240],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>

          <Text style={styles.timeUpKicker}>TIME LIMIT EXCEEDED</Text>
          <Text style={styles.timeUpTitle}>YOU'RE OUT OF TIME.</Text>
          <Text style={styles.timeUpSubtitle}>本篇阅读时间已用尽</Text>

          <View style={styles.timeUpActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => close(onAddMinute)}
              style={({ pressed }) => [
                styles.timeUpSecondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Plus size={18} color="#BDEEFF" />
              <Text style={styles.timeUpSecondaryText}>加 1 分钟</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => close(onDismiss)}
              style={({ pressed }) => [
                styles.timeUpPrimaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.timeUpPrimaryText}>继续阅读</Text>
              <ChevronRight size={18} color="#071119" />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ReaderScreen({
  userId,
  article,
  savedWords,
  completed,
  pronunciationAccent,
  sequencePosition,
  sequenceTotal,
  navigatingArticle,
  initialReaderSettings,
  practiceMode,
  onPreviousArticle,
  onNextArticle,
  onBack,
  onToggleWord,
  onSubmit,
  onChangeReaderSettings,
}: {
  userId: string;
  article: Article;
  savedWords: SavedWord[];
  completed: boolean;
  pronunciationAccent: LearningSettings["pronunciationAccent"];
  sequencePosition: number;
  sequenceTotal: number;
  navigatingArticle: boolean;
  initialReaderSettings: ReaderSettings;
  practiceMode: boolean;
  onPreviousArticle?: () => void;
  onNextArticle?: () => void;
  onBack: () => void;
  onToggleWord: (word: WordInfo, article: Article) => void;
  onSubmit: (article: Article, answers: number[]) => Promise<AnswerResult[]>;
  onChangeReaderSettings: (settings: ReaderSettings) => void;
}) {
  const { width, height } = useWindowDimensions();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const scrollProgressRef = useRef(0);
  const questionsOffsetRef = useRef(0);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingSyncAtRef = useRef(Date.now());
  const answerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAnswersRef = useRef<Array<number | null> | null>(null);
  const selectedAnswersRef = useRef<Record<number, number>>({});
  const restoredProgressRef = useRef(false);
  const screenTransition = useRef(new Animated.Value(0)).current;
  const tabIndicator = useRef(new Animated.Value(0)).current;
  const tabContentTransition = useRef(new Animated.Value(1)).current;
  const wordCardTransition = useRef(new Animated.Value(0)).current;
  const sequenceBarTransition = useRef(new Animated.Value(0)).current;
  const sequenceBarVisibleRef = useRef(false);
  const closingWordRef = useRef(false);
  const timerDeadlineRef = useRef<number | null>(null);
  const translationRequestRef = useRef(0);
  const [readerTab, setReaderTab] = useState<
    "article" | "translation" | "answer"
  >("article");
  const [selectedWord, setSelectedWord] = useState<WordInfo | null>(null);
  const [wordAnchor, setWordAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [pressedWord, setPressedWord] = useState<string | null>(null);
  const [wordLoading, setWordLoading] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, number>
  >({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answerResults, setAnswerResults] = useState<AnswerResult[]>([]);
  const [answersRestored, setAnswersRestored] = useState(false);
  const [readerNotice, setReaderNotice] = useState<
    (AppNotice & { kind: "incomplete" | "submit-error" }) | null
  >(null);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(
    initialReaderSettings,
  );
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [showReaderHint, setShowReaderHint] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [sequenceBarVisible, setSequenceBarVisible] = useState(false);
  const [restoredOffset, setRestoredOffset] = useState<number | null>(null);
  const [wordCardHeight, setWordCardHeight] = useState(0);
  const [timerSettings, setTimerSettings] = useState<ArticleTimerSettings>(() => ({
    enabled: true,
    durationMinutes: clampTimerMinutes(article.readMinutes),
    reminderStyle: "mecha-blade",
  }));
  const [timerMinutesInput, setTimerMinutesInput] = useState(
    String(clampTimerMinutes(article.readMinutes)),
  );
  const [timerReady, setTimerReady] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    clampTimerMinutes(article.readMinutes) * 60,
  );
  const [timeUpVisible, setTimeUpVisible] = useState(false);
  const [articleTranslation, setArticleTranslation] = useState<
    ArticleTranslation | null | undefined
  >(undefined);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const isSaved = (word: string) =>
    savedWords.some(
      (item) =>
        item.examId === article.examId &&
        item.word === word.toLowerCase().replace(/[^a-z'-]/g, ""),
    );
  const maxColumnWidth =
    readerSettings.columnWidth === "narrow"
      ? 660
      : readerSettings.columnWidth === "wide"
        ? 880
        : 760;
  const isIPadLayout = Platform.OS === "ios" && width >= 768;
  const iPadHorizontalInset =
    readerSettings.columnWidth === "narrow"
      ? 48
      : readerSettings.columnWidth === "wide"
        ? 12
        : 24;
  const contentWidth = isIPadLayout
    ? width - iPadHorizontalInset * 2
    : Math.min(
        maxColumnWidth,
        width - (width < 480 ? 16 : width >= 768 ? 120 : 32),
      );
  const lineSpacingMultiplier =
    readerSettings.lineSpacing === "compact"
      ? 0.94
      : readerSettings.lineSpacing === "relaxed"
        ? 1.18
        : 1.06;
  const activeTone = readerTone[readerSettings.pageTone];
  const showAnchoredWordCard = width >= 768;
  const wordPopoverWidth = Math.min(380, width - 32);
  const wordPopoverGap = 12;
  const wordPopoverViewportTop = Math.max(16, safeTop + 8);
  const wordPopoverViewportBottom = height - Math.max(16, safeBottom + 8);
  const estimatedWordPopoverHeight = Math.min(
    wordCardHeight || 440,
    wordPopoverViewportBottom - wordPopoverViewportTop,
  );
  const wordPopoverLeft = Math.max(
    16,
    Math.min(
      width - wordPopoverWidth - 16,
      (wordAnchor?.x ?? width / 2) + (wordAnchor?.width ?? 0) / 2 -
        wordPopoverWidth / 2,
    ),
  );
  const wordAnchorTop = wordAnchor?.y ?? height / 2;
  const wordAnchorBottom = wordAnchor
    ? wordAnchor.y + wordAnchor.height
    : height / 2;
  const wordPopoverSpaceAbove = Math.max(
    0,
    wordAnchorTop - wordPopoverGap - wordPopoverViewportTop,
  );
  const wordPopoverSpaceBelow = Math.max(
    0,
    wordPopoverViewportBottom - wordAnchorBottom - wordPopoverGap,
  );
  const placeWordPopoverBelow =
    wordPopoverSpaceBelow >= estimatedWordPopoverHeight ||
    wordPopoverSpaceBelow >= wordPopoverSpaceAbove;
  const selectedWordPopoverSpace = placeWordPopoverBelow
    ? wordPopoverSpaceBelow
    : wordPopoverSpaceAbove;
  const wordPopoverMaxHeight = Math.min(
    520,
    Math.max(
      160,
      selectedWordPopoverSpace ||
        wordPopoverViewportBottom - wordPopoverViewportTop,
    ),
  );
  const displayedWordPopoverHeight = Math.min(
    estimatedWordPopoverHeight,
    wordPopoverMaxHeight,
  );
  const desiredWordPopoverTop = placeWordPopoverBelow
    ? wordAnchorBottom + wordPopoverGap
    : wordAnchorTop - wordPopoverGap - displayedWordPopoverHeight;
  const wordPopoverTop = Math.max(
    wordPopoverViewportTop,
    Math.min(
      wordPopoverViewportBottom - displayedWordPopoverHeight,
      desiredWordPopoverTop,
    ),
  );
  const wordSheetMaxHeight = Math.max(320, height - safeTop - 12);
  const allAnswered = article.questions.every(
    (_, index) => selectedAnswers[index] !== undefined,
  );
  const correctCount = answerResults.filter((result) => result.correct).length;

  const restoreAnswerState = (state: ArticleAnswerState) => {
    const restored = state.answers.reduce<Record<number, number>>(
      (result, answer, index) => {
        const question = article.questions[index];
        if (
          question &&
          answer !== null &&
          answer >= 0 &&
          answer < question.options.length
        ) {
          result[index] = answer;
        }
        return result;
      },
      {},
    );
    selectedAnswersRef.current = restored;
    setSelectedAnswers(restored);
    setSubmitted(state.submitted);
    setAnswerResults(state.submitted ? state.results : []);
  };

  const persistReadingState = (offsetY: number, ratio: number) => {
    const now = Date.now();
    const sessionSeconds = Math.max(
      0,
      Math.min(3600, Math.floor((now - readingSyncAtRef.current) / 1000)),
    );
    readingSyncAtRef.current = now;
    const localProgress = {
      offsetY,
      ratio,
      updatedAt: new Date(now).toISOString(),
    };
    void storage.setReadingProgress(userId, article.id, localProgress);
    void api
      .saveReadingProgress(article.id, {
        offsetY,
        ratio,
        sessionSeconds,
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (reducedMotion) {
      screenTransition.setValue(1);
      return;
    }
    Animated.spring(screenTransition, {
      toValue: 1,
      damping: 22,
      stiffness: 240,
      mass: 0.9,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [reducedMotion, screenTransition]);

  useEffect(() => {
    if (reducedMotion) {
      sequenceBarTransition.setValue(sequenceBarVisible ? 1 : 0);
      return;
    }
    Animated.timing(sequenceBarTransition, {
      toValue: sequenceBarVisible ? 1 : 0,
      duration: sequenceBarVisible ? 220 : 160,
      easing: sequenceBarVisible
        ? Easing.out(Easing.cubic)
        : Easing.in(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [reducedMotion, sequenceBarTransition, sequenceBarVisible]);

  useEffect(() => {
    const target =
      readerTab === "article" ? 0 : readerTab === "translation" ? 1 : 2;
    if (reducedMotion) {
      tabIndicator.setValue(target);
      tabContentTransition.setValue(1);
      return;
    }
    tabContentTransition.setValue(0);
    Animated.parallel([
      Animated.spring(tabIndicator, {
        toValue: target,
        damping: 24,
        stiffness: 280,
        mass: 0.8,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(tabContentTransition, {
        toValue: 1,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start();
  }, [readerTab, reducedMotion, tabContentTransition, tabIndicator]);

  useEffect(() => {
    if (!selectedWord) return;
    closingWordRef.current = false;
    if (reducedMotion) {
      wordCardTransition.setValue(1);
      return;
    }
    wordCardTransition.setValue(0);
    Animated.spring(wordCardTransition, {
      toValue: 1,
      damping: 20,
      stiffness: 260,
      mass: 0.78,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [reducedMotion, selectedWord?.word, wordCardTransition]);

  useEffect(() => {
    let active = true;
    Promise.all([
      storage.getReadingProgress(userId, article.id),
      api.getReadingProgress(article.id).catch(() => null),
      storage.getReaderHintSeen(),
    ]).then(([localProgress, remoteProgress, hintSeen]) => {
      if (!active) return;
      const progress =
        !localProgress
          ? remoteProgress
          : !remoteProgress
            ? localProgress
            : Date.parse(localProgress.updatedAt) > Date.parse(remoteProgress.updatedAt)
              ? localProgress
              : remoteProgress;
      setReaderSettings(initialReaderSettings);
      setRestoredOffset(progress?.offsetY ?? 0);
      setReadingProgress(progress?.ratio ?? 0);
      scrollProgressRef.current = progress?.ratio ?? 0;
      readingSyncAtRef.current = Date.now();
      setShowReaderHint(!hintSeen);
    });
    return () => {
      active = false;
    };
  }, [article.id, initialReaderSettings, userId]);

  useEffect(() => {
    let active = true;
    setTimerReady(false);
    storage.getArticleTimerSettings(userId, article.id).then((saved) => {
      if (!active) return;
      const durationMinutes = clampTimerMinutes(
        saved?.durationMinutes ?? article.readMinutes,
      );
      const next: ArticleTimerSettings = {
        enabled: saved?.enabled ?? true,
        durationMinutes,
        reminderStyle:
          saved?.reminderStyle === "mecha-blade"
            ? saved.reminderStyle
            : "mecha-blade",
      };
      const seconds = durationMinutes * 60;
      setTimerSettings(next);
      setTimerMinutesInput(String(durationMinutes));
      setRemainingSeconds(seconds);
      timerDeadlineRef.current = next.enabled ? Date.now() + seconds * 1000 : null;
      setTimerReady(true);
    });
    return () => {
      active = false;
      timerDeadlineRef.current = null;
    };
  }, [article.id, article.readMinutes, userId]);

  useEffect(() => {
    if (!timerReady || !timerSettings.enabled || remainingSeconds <= 0) {
      timerDeadlineRef.current = null;
      return;
    }
    if (timeUpVisible) {
      timerDeadlineRef.current = null;
      return;
    }
    if (!timerDeadlineRef.current) {
      timerDeadlineRef.current = Date.now() + remainingSeconds * 1000;
    }

    const tick = () => {
      const deadline = timerDeadlineRef.current;
      if (!deadline) return;
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next === 0) {
        timerDeadlineRef.current = null;
        setTimeUpVisible(true);
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [remainingSeconds <= 0, timeUpVisible, timerReady, timerSettings.enabled]);

  useEffect(() => {
    let active = true;
    setAnswersRestored(false);
    if (practiceMode) {
      selectedAnswersRef.current = {};
      setSelectedAnswers({});
      setSubmitted(false);
      setAnswerResults([]);
      setReaderTab("article");
      setAnswersRestored(true);
      return () => {
        active = false;
      };
    }
    Promise.allSettled([
      storage.getArticleAnswerState(userId, article.id),
      api.getArticleAnswerState(article.id),
    ]).then((settled) => {
      if (!active) return;
      const local = settled[0].status === "fulfilled" ? settled[0].value : null;
      const remote = settled[1].status === "fulfilled" ? settled[1].value : null;
      const preferred =
        remote?.submitted
          ? remote
          : local?.submitted
            ? local
            : !local
              ? remote
              : !remote
                ? local
                : Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)
                  ? local
                  : remote;
      if (preferred) {
        restoreAnswerState(preferred);
        void storage.setArticleAnswerState(userId, article.id, preferred);
        if (preferred === local && !preferred.submitted) {
          void api
            .saveArticleAnswers(article.id, preferred.answers)
            .then((synced) =>
              storage.setArticleAnswerState(userId, article.id, synced),
            )
            .catch(() => undefined);
        }
      } else {
        selectedAnswersRef.current = {};
        setSelectedAnswers({});
        setSubmitted(false);
        setAnswerResults([]);
      }
      setAnswersRestored(true);
    });
    return () => {
      active = false;
    };
  }, [article.id, practiceMode, userId]);

  useEffect(
    () => () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
      persistReadingState(scrollOffsetRef.current, scrollProgressRef.current);
    },
    [article.id, userId],
  );

  useEffect(
    () => () => {
      if (answerSaveTimerRef.current) clearTimeout(answerSaveTimerRef.current);
      const pending = pendingAnswersRef.current;
      if (pending) {
        void api.saveArticleAnswers(article.id, pending).catch(() => undefined);
      }
    },
    [article.id, userId],
  );

  const saveAnswerDraft = (answers: Record<number, number>) => {
    const values = article.questions.map((_, index) => answers[index] ?? null);
    const localState: ArticleAnswerState = {
      answers: values,
      submitted: false,
      results: [],
      updatedAt: new Date().toISOString(),
    };
    void storage.setArticleAnswerState(userId, article.id, localState);
    pendingAnswersRef.current = values;
    if (answerSaveTimerRef.current) clearTimeout(answerSaveTimerRef.current);
    answerSaveTimerRef.current = setTimeout(() => {
      answerSaveTimerRef.current = null;
      pendingAnswersRef.current = null;
      void api
        .saveArticleAnswers(article.id, values)
        .then((synced) =>
          storage.setArticleAnswerState(userId, article.id, synced),
        )
        .catch(() => undefined);
    }, 280);
  };

  const selectAnswer = (questionIndex: number, answerIndex: number) => {
    if (submitted || !answersRestored) return;
    const next = {
      ...selectedAnswersRef.current,
      [questionIndex]: answerIndex,
    };
    selectedAnswersRef.current = next;
    setSelectedAnswers(next);
    saveAnswerDraft(next);
  };

  const updateReaderSettings = (next: ReaderSettings) => {
    setReaderSettings(next);
    void storage.setReaderSettings(next);
    onChangeReaderSettings(next);
  };

  const saveTimerSettings = (next: ArticleTimerSettings) => {
    setTimerSettings(next);
    void storage.setArticleTimerSettings(userId, article.id, next);
  };

  const setTimerDuration = (value: number) => {
    const durationMinutes = clampTimerMinutes(value);
    const next = { ...timerSettings, durationMinutes };
    const seconds = durationMinutes * 60;
    saveTimerSettings(next);
    setTimerMinutesInput(String(durationMinutes));
    setRemainingSeconds(seconds);
    timerDeadlineRef.current = next.enabled ? Date.now() + seconds * 1000 : null;
    setTimeUpVisible(false);
  };

  const commitTimerInput = () => {
    const parsed = Number.parseInt(timerMinutesInput, 10);
    setTimerDuration(Number.isFinite(parsed) ? parsed : timerSettings.durationMinutes);
  };

  const toggleArticleTimer = (enabled: boolean) => {
    const next = { ...timerSettings, enabled };
    saveTimerSettings(next);
    if (!enabled) {
      timerDeadlineRef.current = null;
      return;
    }
    const seconds =
      remainingSeconds > 0
        ? remainingSeconds
        : timerSettings.durationMinutes * 60;
    setRemainingSeconds(seconds);
    timerDeadlineRef.current = Date.now() + seconds * 1000;
  };

  const resetArticleTimer = () => {
    const seconds = timerSettings.durationMinutes * 60;
    setRemainingSeconds(seconds);
    timerDeadlineRef.current = timerSettings.enabled
      ? Date.now() + seconds * 1000
      : null;
    setTimeUpVisible(false);
  };

  const selectReminderStyle = (reminderStyle: ReminderStyle) => {
    saveTimerSettings({ ...timerSettings, reminderStyle });
  };

  const previewTimeUpReminder = () => {
    setSettingsVisible(false);
    requestAnimationFrame(() => setTimeUpVisible(true));
  };

  const addOneMinute = () => {
    const seconds = Math.max(60, remainingSeconds + 60);
    setRemainingSeconds(seconds);
    timerDeadlineRef.current = timerSettings.enabled
      ? Date.now() + seconds * 1000
      : null;
    setTimeUpVisible(false);
  };

  const dismissReaderHint = () => {
    setShowReaderHint(false);
    void storage.setReaderHintSeen();
  };

  useEffect(() => {
    const commonWords = new Set([
      "about",
      "after",
      "again",
      "because",
      "before",
      "could",
      "every",
      "first",
      "from",
      "have",
      "into",
      "other",
      "should",
      "their",
      "there",
      "these",
      "they",
      "this",
      "through",
      "were",
      "which",
      "while",
      "with",
      "would",
    ]);
    const seen = new Set<string>();
    const items: Array<{ word: string; context: string }> = [];
    for (const paragraph of article.paragraphs) {
      for (const token of paragraph.split(/\s+/)) {
        const word = token.toLowerCase().replace(/[^a-z'-]/g, "");
        if (
          word.length < 5 ||
          commonWords.has(word) ||
          seen.has(word)
        ) {
          continue;
        }
        seen.add(word);
        items.push({ word, context: sentenceContainingWord(paragraph, word) });
        if (items.length >= 18) break;
      }
      if (items.length >= 18) break;
    }
    const timer = setTimeout(() => {
      void api.prefetchPronunciations(items, 3, pronunciationAccent);
    }, 350);
    return () => clearTimeout(timer);
  }, [article.id, article.paragraphs, pronunciationAccent]);

  const openWord = (
    token: string,
    paragraph: string,
    anchor?: { x: number; y: number; width: number; height: number },
  ) => {
    const normalized = token.toLowerCase().replace(/[^a-z'-]/g, "");
    const savedWord = savedWords.find(
      (item) => item.examId === article.examId && item.word === normalized,
    );
    const localWord: WordInfo = savedWord ?? lookupWord(token);
    if (!localWord.word) return;
    setWordCardHeight(0);
    setSelectedWord(localWord);
    setWordAnchor(anchor ?? null);
    setPressedWord(localWord.word);
    setWordLoading(true);
    api
      .getPronunciation(
        localWord.word,
        pronunciationAccent,
        sentenceContainingWord(paragraph, localWord.word),
      )
      .then((pronunciation) => {
        setSelectedWord((current) =>
          current?.word === localWord.word
            ? {
                ...current,
                phonetic: pronunciation.phonetic || current.phonetic,
                translation:
                  pronunciation.translation ||
                  (current.translation === "正在查询中文释义…"
                    ? "暂未查询到中文释义"
                    : current.translation),
                definition: pronunciation.definition,
                partOfSpeech: pronunciation.partOfSpeech,
                example: pronunciation.example,
                exampleTranslation: pronunciation.exampleTranslation,
              }
            : current,
        );
      })
      .catch(() =>
        setSelectedWord((current) =>
          current?.word === localWord.word &&
          current.translation === "正在查询中文释义…"
            ? { ...current, translation: "释义服务暂时不可用，请稍后重试" }
            : current,
        ),
      )
      .finally(() => setWordLoading(false));
  };

  const closeWord = () => {
    stopWordAudio();
    const finish = () => {
      closingWordRef.current = false;
      setSelectedWord(null);
      setWordAnchor(null);
      setWordCardHeight(0);
    };
    if (reducedMotion || !selectedWord) {
      finish();
      return;
    }
    if (closingWordRef.current) return;
    closingWordRef.current = true;
    Animated.timing(wordCardTransition, {
      toValue: 0,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(finish);
  };

  const loadArticleTranslation = async (force = false) => {
    if (!force && (translationLoading || articleTranslation !== undefined)) {
      return;
    }
    const requestId = ++translationRequestRef.current;
    setTranslationLoading(true);
    setTranslationError(null);
    try {
      const translation = await api.getArticleTranslation(article.id);
      if (requestId === translationRequestRef.current) {
        setArticleTranslation(translation);
      }
    } catch (error) {
      if (requestId === translationRequestRef.current) {
        setArticleTranslation(null);
        setTranslationError(
          error instanceof Error ? error.message : "译文加载失败，请稍后重试",
        );
      }
    } finally {
      if (requestId === translationRequestRef.current) {
        setTranslationLoading(false);
      }
    }
  };

  useEffect(() => {
    translationRequestRef.current += 1;
    setArticleTranslation(undefined);
    setTranslationLoading(false);
    setTranslationError(null);
    setReaderTab((current) =>
      current === "translation" ? "article" : current,
    );
  }, [article.id]);

  const openTranslation = () => {
    if (readerTab === "article") {
      persistReadingState(scrollOffsetRef.current, scrollProgressRef.current);
    }
    setReaderTab("translation");
    void loadArticleTranslation();
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: 0, animated: true }),
    );
  };

  const openOriginalArticle = () => {
    setReaderTab("article");
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({
        y: scrollOffsetRef.current,
        animated: true,
      }),
    );
  };

  const openAnswers = async () => {
    if (submitted) {
      setReaderTab("answer");
      return;
    }
    if (!allAnswered) {
      const unanswered = article.questions.filter(
        (_, index) => selectedAnswers[index] === undefined,
      ).length;
      setReaderNotice({
        kind: "incomplete",
        title: `还有 ${unanswered} 道题未完成`,
        message: "完成全部题目后即可查看答案解析。点击继续，我们会带你回到答题区域。",
      });
      return;
    }
    setSubmitting(true);
    try {
      const answers = article.questions.map(
        (_, index) => selectedAnswers[index],
      );
      const results = await onSubmit(article, answers);
      if (answerSaveTimerRef.current) {
        clearTimeout(answerSaveTimerRef.current);
        answerSaveTimerRef.current = null;
      }
      pendingAnswersRef.current = null;
      await storage.setArticleAnswerState(userId, article.id, {
        answers,
        submitted: true,
        results,
        updatedAt: new Date().toISOString(),
      });
      setAnswerResults(results);
      setSubmitted(true);
      setReaderTab("answer");
    } catch (error) {
      setReaderNotice({
        kind: "submit-error",
        title: "提交失败",
        message: error instanceof Error ? error.message : "请稍后再试",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const beginRetry = () => {
    selectedAnswersRef.current = {};
    setSelectedAnswers({});
    setAnswerResults([]);
    setSubmitted(false);
    setReaderTab("article");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, questionsOffsetRef.current - 20),
        animated: true,
      });
    });
  };

  const closeReader = () => {
    if (reducedMotion) {
      onBack();
      return;
    }
    Animated.timing(screenTransition, {
      toValue: 0,
      duration: 180,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(onBack);
  };

  return (
    <AnimatedSafeAreaView
      style={[
        styles.readerSafe,
        { backgroundColor: activeTone.background },
        {
          opacity: screenTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.72, 1],
          }),
          transform: [
            {
              translateY: screenTransition.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        },
      ]}
    >
      <ExpoStatusBar style="dark" />
      <View
        style={[
          styles.readerTopbar,
          { backgroundColor: activeTone.background },
        ]}
      >
        <Pressable
          accessibilityLabel="返回"
          onPress={closeReader}
          style={styles.iconButton}
        >
          <ArrowLeft size={22} color={colors.ink} />
        </Pressable>
        <View accessibilityRole="tablist" style={styles.readerTabs}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.readerTabIndicator,
              {
                transform: [
                  {
                    translateX: tabIndicator.interpolate({
                      inputRange: [0, 1, 2],
                      outputRange: [0, 68, 136],
                    }),
                  },
                ],
              },
            ]}
          />
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: readerTab === "article" }}
            aria-selected={readerTab === "article"}
            onPress={openOriginalArticle}
            style={({ pressed }) => [
              styles.readerTab,
              pressed && styles.readerTabPressed,
            ]}
          >
            <Text
              style={[
                styles.readerTabText,
                readerTab === "article" && styles.readerTabTextActive,
              ]}
            >
              原文
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: readerTab === "translation" }}
            aria-selected={readerTab === "translation"}
            onPress={openTranslation}
            style={({ pressed }) => [
              styles.readerTab,
              pressed && styles.readerTabPressed,
            ]}
          >
            <Text
              style={[
                styles.readerTabText,
                readerTab === "translation" && styles.readerTabTextActive,
              ]}
            >
              中文译文
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: readerTab === "answer" }}
            aria-selected={readerTab === "answer"}
            onPress={openAnswers}
            style={({ pressed }) => [
              styles.readerTab,
              pressed && styles.readerTabPressed,
            ]}
          >
            <Text
              style={[
                styles.readerTabText,
                readerTab === "answer" && styles.readerTabTextActive,
              ]}
            >
              解析
            </Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityLabel="阅读设置"
          accessibilityState={{ expanded: settingsVisible }}
          onPress={() => setSettingsVisible(true)}
          style={[styles.fontButton, settingsVisible && styles.fontButtonActive]}
        >
          <Text style={styles.fontButtonText}>Aa</Text>
        </Pressable>
      </View>
      <View style={styles.readingProgressTrack}>
        <View
          style={[
            styles.readingProgressFill,
            { width: `${Math.max(0, Math.min(100, readingProgress * 100))}%` },
          ]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`本篇限时${timerSettings.enabled ? `，剩余 ${formatCountdown(remainingSeconds)}` : "，已暂停"}`}
        accessibilityHint="打开限时与提醒风格设置"
        onPress={() => setSettingsVisible(true)}
        style={({ pressed }) => [
          styles.articleTimerBar,
          timerSettings.enabled &&
            remainingSeconds > 0 &&
            remainingSeconds <= 60 &&
            styles.articleTimerBarUrgent,
          remainingSeconds === 0 && styles.articleTimerBarExpired,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.articleTimerIcon}>
          <Clock3
            size={16}
            color={remainingSeconds <= 60 ? "#D8F7FF" : colors.primary}
          />
        </View>
        <View style={styles.articleTimerCopy}>
          <Text
            style={[
              styles.articleTimerLabel,
              remainingSeconds <= 60 && styles.articleTimerTextUrgent,
            ]}
          >
            本篇限时 · {timerSettings.durationMinutes} 分钟
          </Text>
          <Text
            style={[
              styles.articleTimerHint,
              remainingSeconds <= 60 && styles.articleTimerTextUrgent,
            ]}
          >
            {timerSettings.enabled ? "机甲提醒已待命" : "倒计时已暂停"}
          </Text>
        </View>
        <Text
          style={[
            styles.articleTimerValue,
            remainingSeconds <= 60 && styles.articleTimerTextUrgent,
          ]}
        >
          {timerReady
            ? timerSettings.enabled
              ? formatCountdown(remainingSeconds)
              : "PAUSED"
            : "--:--"}
        </Text>
        <ChevronRight
          size={16}
          color={remainingSeconds <= 60 ? "#D8F7FF" : colors.inkMuted}
        />
      </Pressable>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (restoredOffset === null || restoredProgressRef.current) return;
          restoredProgressRef.current = true;
          if (restoredOffset > 24) {
            requestAnimationFrame(() =>
              scrollRef.current?.scrollTo({ y: restoredOffset, animated: false }),
            );
          }
        }}
        onScroll={({ nativeEvent }) => {
          const maxOffset = Math.max(
            1,
            nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height,
          );
          const offsetY = Math.max(0, nativeEvent.contentOffset.y);
          const distanceFromBottom = Math.max(
            0,
            nativeEvent.contentSize.height -
              nativeEvent.layoutMeasurement.height -
              offsetY,
          );
          const shouldShowSequenceBar = sequenceBarVisibleRef.current
            ? distanceFromBottom <= 180
            : distanceFromBottom <= 96;
          if (shouldShowSequenceBar !== sequenceBarVisibleRef.current) {
            sequenceBarVisibleRef.current = shouldShowSequenceBar;
            setSequenceBarVisible(shouldShowSequenceBar);
          }
          if (readerTab !== "article") return;
          const ratio = Math.max(0, Math.min(1, offsetY / maxOffset));
          scrollOffsetRef.current = offsetY;
          scrollProgressRef.current = ratio;
          setReadingProgress(ratio);
          if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
          scrollSaveTimerRef.current = setTimeout(() => {
            persistReadingState(offsetY, ratio);
          }, 900);
        }}
        contentContainerStyle={[
          styles.readerScroll,
          width < 480 && styles.readerScrollMobile,
          sequenceBarVisible && styles.readerScrollWithFloatingNavigation,
        ]}
      >
        <View
          style={[
            styles.readerPaper,
            width < 480 && styles.readerPaperMobile,
            { width: contentWidth, backgroundColor: activeTone.paper },
          ]}
        >
          <View style={styles.readerHeading}>
            <Text style={styles.readerEyebrow}>
              {readerTab === "translation"
                ? "中文译文 · FULL TRANSLATION"
                : article.contentKind === "interest"
                  ? `${getInterestCategory(article.interestId)?.emoji ?? "✨"} ${getInterestCategory(article.interestId)?.name ?? "兴趣阅读"}${article.seriesTitle ? ` · 第 ${article.episodeNumber} 章` : ""}`
                  : `${article.eyebrow} · ${article.year}`}
            </Text>
            <Text
              style={[styles.readerTitle, width < 480 && styles.readerTitleMobile]}
            >
              {readerTab === "translation" && articleTranslation ? (
                articleTranslation.title
              ) : article.title.split(/(\s+)/).map((token, index) => {
                if (/^\s+$/.test(token)) return token;
                const clean = token.toLowerCase().replace(/[^a-z'-]/g, "");
                const marked = clean && isSaved(clean);
                return (
                  <LongPressWord
                    key={`title-${index}`}
                    accessibilityHint="长按查看标题单词的中文释义和例句"
                    onLongPress={(anchor) =>
                      clean && openWord(token, article.title, anchor)
                    }
                    onPressIn={() => clean && setPressedWord(clean)}
                    onPressOut={() =>
                      setPressedWord((current) =>
                        current === clean ? null : current,
                      )
                    }
                    style={[
                      styles.interactiveWord,
                      Platform.OS === "web" && styles.webInteractiveWord,
                      marked && styles.markedWord,
                      pressedWord === clean && styles.pressedWord,
                      selectedWord?.word === clean && styles.selectedInlineWord,
                    ]}
                  >
                    {token}
                  </LongPressWord>
                );
              })}
            </Text>
            <View style={styles.readerMeta}>
              <Text style={styles.readerMetaText}>
                {readerTab === "translation"
                  ? "整篇中文译文"
                  : article.contentKind === "interest"
                    ? "兴趣分级阅读"
                    : getExam(article.examId).name}
              </Text>
              <View style={styles.metaDivider} />
              <Text style={styles.readerMetaText}>
                {readerTab === "translation" && articleTranslation
                  ? `共 ${articleTranslation.paragraphs.length} 段`
                  : `约 ${article.readMinutes} 分钟`}
              </Text>
            </View>
            {readerTab !== "translation" && (
              <ArticleNarrationPlayer key={article.id} article={article} />
            )}
          </View>

          <Animated.View
            style={{
              opacity: tabContentTransition.interpolate({
                inputRange: [0, 1],
                outputRange: [0.42, 1],
              }),
              transform: [
                {
                  translateX: tabContentTransition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [readerTab === "article" ? -10 : 10, 0],
                  }),
                },
              ],
            }}
          >
            {readerTab === "article" ? (
              <View>
              {showReaderHint && (
                <View style={styles.longPressHint}>
                  <View style={styles.hintHand}>
                    <Text>☝</Text>
                  </View>
                  <Text style={styles.longPressHintText}>
                    {Platform.OS === "web" && width >= 768
                      ? "鼠标按住单词，查看翻译、音标和例句"
                      : "长按单词，查看翻译、音标和例句"}
                  </Text>
                  <Pressable
                    accessibilityLabel="关闭阅读提示"
                    hitSlop={8}
                    onPress={dismissReaderHint}
                    style={styles.hintClose}
                  >
                    <X size={15} color={colors.inkMuted} />
                  </Pressable>
                </View>
              )}
              {article.paragraphs.map((paragraph, pIndex) => (
                <Text
                  key={pIndex}
                  style={[
                    styles.paragraph,
                    {
                      fontSize: 18 * readerSettings.fontScale,
                      lineHeight:
                        32 * readerSettings.fontScale * lineSpacingMultiplier,
                      fontFamily:
                        readerSettings.fontFamily === "serif"
                          ? Platform.select({
                              ios: "Georgia",
                              android: "serif",
                              default: "Georgia",
                            })
                          : Platform.select({
                              ios: "System",
                              android: "sans-serif",
                              default: "system-ui",
                            }),
                    },
                  ]}
                >
                  {paragraph.split(/(\s+)/).map((token, index) => {
                    if (/^\s+$/.test(token)) return token;
                    const clean = token.toLowerCase().replace(/[^a-z'-]/g, "");
                    const marked = clean && isSaved(clean);
                    return (
                      <LongPressWord
                        key={`${pIndex}-${index}`}
                        accessibilityHint="长按查看中文释义和例句"
                        onLongPress={(anchor) =>
                          clean && openWord(token, paragraph, anchor)
                        }
                        onPressIn={() => clean && setPressedWord(clean)}
                        onPressOut={() =>
                          setPressedWord((current) =>
                            current === clean ? null : current,
                          )
                        }
                        style={[
                          styles.interactiveWord,
                          Platform.OS === "web" && styles.webInteractiveWord,
                          marked && styles.markedWord,
                          pressedWord === clean && styles.pressedWord,
                          selectedWord?.word === clean && styles.selectedInlineWord,
                        ]}
                      >
                        {token}
                      </LongPressWord>
                    );
                  })}
                </Text>
              ))}

              {article.contentKind === "interest" && (
                <View style={styles.interestActivityCard}>
                  <View style={styles.interestActivityIcon}>
                    <Text style={styles.interestActivityEmoji}>
                      {getInterestCategory(article.interestId)?.emoji ?? "✨"}
                    </Text>
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.interestActivityLabel}>读后兴趣任务</Text>
                    <Text style={styles.interestActivityText}>
                      {getInterestCategory(article.interestId)?.activityPrompt}
                    </Text>
                  </View>
                </View>
              )}

              <View
                onLayout={({ nativeEvent }) => {
                  questionsOffsetRef.current = nativeEvent.layout.y;
                }}
                style={styles.practiceHeader}
              >
                <Text style={styles.practiceEyebrow}>READING QUESTIONS</Text>
                <Text style={styles.practiceTitle}>根据文章选择正确答案</Text>
                <Text style={styles.practiceHint}>
                  {!answersRestored
                    ? "正在恢复答题记录…"
                    : submitted
                      ? `已恢复上次作答 · ${Object.keys(selectedAnswers).length} / ${article.questions.length}`
                      : `已完成 ${Object.keys(selectedAnswers).length} / ${article.questions.length}`}
                </Text>
              </View>
              <View style={styles.questions}>
                {article.questions.map((question, qIndex) => (
                  <View key={question.prompt} style={styles.questionCard}>
                    <Text style={styles.questionNumber}>
                      QUESTION {String(qIndex + 1).padStart(2, "0")}
                    </Text>
                    <Text style={styles.questionPrompt}>{question.prompt}</Text>
                    <View style={styles.options}>
                      {question.options.map((option, index) => {
                        const selected = selectedAnswers[qIndex] === index;
                        return (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{
                              checked: selected,
                              disabled: submitted || !answersRestored,
                            }}
                            aria-checked={selected}
                            disabled={submitted || !answersRestored}
                            key={option}
                            onPress={() => selectAnswer(qIndex, index)}
                            style={({ pressed }) => [
                              styles.option,
                              selected && styles.optionSelected,
                              pressed && styles.pressed,
                            ]}
                          >
                            <View
                              style={[
                                styles.optionLetter,
                                selected && styles.optionLetterSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.optionLetterText,
                                  selected && styles.optionLetterTextSelected,
                                ]}
                              >
                                {String.fromCharCode(65 + index)}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.optionText,
                                selected && styles.optionTextSelected,
                              ]}
                            >
                              {option}
                            </Text>
                            <View
                              style={[
                                styles.optionRadio,
                                selected && styles.optionRadioSelected,
                              ]}
                            >
                              {selected && (
                                <View style={styles.optionRadioDot} />
                              )}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
              <Pressable
                accessibilityState={{ disabled: !allAnswered || submitting }}
                disabled={!allAnswered || submitting}
                onPress={openAnswers}
                style={[
                  styles.answerCta,
                  (!allAnswered || submitting) && styles.answerCtaDisabled,
                ]}
              >
                <Text style={styles.answerCtaText}>
                  {submitting
                    ? "正在提交…"
                    : submitted
                      ? "查看上次答案解析"
                      : allAnswered
                      ? "提交答案并查看解析"
                      : "请完成全部题目"}
                </Text>
                <ChevronRight color="#fff" size={19} />
              </Pressable>
              </View>
            ) : readerTab === "translation" ? (
              <View style={styles.articleTranslationView}>
                {translationLoading || articleTranslation === undefined ? (
                  <View style={styles.translationStateCard}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.translationStateTitle}>
                      正在读取整篇译文
                    </Text>
                    <Text style={styles.translationStateText}>
                      正在从文章翻译数据库加载中文内容…
                    </Text>
                  </View>
                ) : translationError ? (
                  <View style={styles.translationStateCard}>
                    <View style={styles.translationStateIconError}>
                      <X size={20} color={colors.danger} />
                    </View>
                    <Text style={styles.translationStateTitle}>译文加载失败</Text>
                    <Text style={styles.translationStateText}>
                      {translationError}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void loadArticleTranslation(true)}
                      style={styles.translationRetryButton}
                    >
                      <RotateCcw size={15} color="#fff" />
                      <Text style={styles.translationRetryText}>重新加载</Text>
                    </Pressable>
                  </View>
                ) : articleTranslation === null ? (
                  <View style={styles.translationStateCard}>
                    <View style={styles.translationStateIcon}>
                      <Languages size={22} color={colors.primary} />
                    </View>
                    <Text style={styles.translationStateTitle}>
                      这篇文章暂无中文译文
                    </Text>
                    <Text style={styles.translationStateText}>
                      数据库中还没有这篇文章的完整译文。运行文章翻译脚本后，点击下方按钮即可查看。
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void loadArticleTranslation(true)}
                      style={styles.translationRetryButton}
                    >
                      <RotateCcw size={15} color="#fff" />
                      <Text style={styles.translationRetryText}>重新检查译文</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={styles.translationNoticeCard}>
                      <View style={styles.translationNoticeIcon}>
                        <Languages size={18} color={colors.primary} />
                      </View>
                      <View style={styles.flexOne}>
                        <Text style={styles.translationNoticeTitle}>整篇中文译文</Text>
                        <Text style={styles.translationNoticeText}>
                          译文已按原文段落排列，建议先读英文，再用中文核对理解。
                        </Text>
                      </View>
                    </View>
                    {articleTranslation.paragraphs.map((paragraph, index) => (
                      <View
                        key={`${article.id}-translation-${index}`}
                        style={styles.translatedParagraphBlock}
                      >
                        <Text style={styles.translatedParagraphNumber}>
                          {String(index + 1).padStart(2, "0")}
                        </Text>
                        <Text
                          style={[
                            styles.translatedParagraph,
                            {
                              fontSize: 17 * readerSettings.fontScale,
                              lineHeight:
                                30 *
                                readerSettings.fontScale *
                                lineSpacingMultiplier,
                            },
                          ]}
                        >
                          {paragraph}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.translationFooter}>
                      <Text style={styles.translationFooterText}>
                        机器翻译内容仅供英语学习参考。如有歧义，请以英文原文为准。
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={openOriginalArticle}
                        style={styles.translationOriginalButton}
                      >
                        <BookOpen size={15} color={colors.primary} />
                        <Text style={styles.translationOriginalButtonText}>
                          返回英文原文
                        </Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            ) : (
              <View style={styles.questions}>
              <View style={styles.answerIntro}>
                <View style={styles.answerIntroIcon}>
                  <Check color={colors.primary} size={20} />
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.answerIntroTitle}>答案与解析</Text>
                  <Text style={styles.answerIntroText}>
                    {submitted
                      ? `你答对了 ${correctCount} / ${article.questions.length} 题`
                      : "先完成文章下方的题目，再核对答案"}
                  </Text>
                </View>
              </View>
              {article.questions.map((question, qIndex) => {
                const result = answerResults.find(
                  (item) => item.questionId === qIndex,
                );
                return (
                  <View key={question.prompt} style={styles.questionCard}>
                    <Text style={styles.questionNumber}>
                      QUESTION {String(qIndex + 1).padStart(2, "0")}
                    </Text>
                    <Text style={styles.questionPrompt}>{question.prompt}</Text>
                    <View style={styles.options}>
                      {question.options.map((option, index) => (
                        <View
                          key={option}
                          style={[
                            styles.option,
                            index === result?.correctAnswer &&
                              styles.optionCorrect,
                            selectedAnswers[qIndex] === index &&
                              index !== result?.correctAnswer &&
                              styles.optionWrong,
                          ]}
                        >
                          <View
                            style={[
                              styles.optionLetter,
                              index === result?.correctAnswer &&
                                styles.optionLetterCorrect,
                              selectedAnswers[qIndex] === index &&
                                index !== result?.correctAnswer &&
                                styles.optionLetterWrong,
                            ]}
                          >
                            <Text
                              style={[
                                styles.optionLetterText,
                                index === result?.correctAnswer &&
                                  styles.optionLetterTextCorrect,
                              ]}
                            >
                              {String.fromCharCode(65 + index)}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.optionText,
                              index === result?.correctAnswer &&
                                styles.optionTextCorrect,
                            ]}
                          >
                            {option}
                          </Text>
                          {index === result?.correctAnswer && (
                            <Check size={18} color={colors.primary} />
                          )}
                          {selectedAnswers[qIndex] === index &&
                            index !== result?.correctAnswer && (
                              <X size={18} color={colors.danger} />
                            )}
                        </View>
                      ))}
                    </View>
                    <View style={styles.explanation}>
                      <Text style={styles.explanationLabel}>解析</Text>
                      <Text style={styles.explanationText}>
                        {result?.explanation ?? "提交答案后显示解析"}
                      </Text>
                    </View>
                  </View>
                );
              })}
              {submitted && (
                <Pressable onPress={beginRetry} style={styles.retryArticleButton}>
                  <Text style={styles.retryArticleButtonText}>重新练习这篇文章</Text>
                </Pressable>
              )}
              </View>
            )}
          </Animated.View>
        </View>
      </ScrollView>

      {sequenceTotal > 1 && (
        <Animated.View
          accessibilityElementsHidden={!sequenceBarVisible}
          importantForAccessibility={
            sequenceBarVisible ? "auto" : "no-hide-descendants"
          }
          pointerEvents={sequenceBarVisible ? "auto" : "none"}
          style={[
            styles.readerSequenceBar,
            {
              width: contentWidth,
              left: (width - contentWidth) / 2,
              opacity: sequenceBarTransition,
              transform: [
                {
                  translateY: sequenceBarTransition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            accessibilityLabel="上一篇文章"
            disabled={!onPreviousArticle || navigatingArticle}
            onPress={onPreviousArticle}
            style={({ pressed }) => [
              styles.readerSequenceButton,
              (!onPreviousArticle || navigatingArticle) &&
                styles.readerSequenceDisabled,
              pressed && styles.pressed,
            ]}
          >
            <ChevronLeft size={18} color={colors.ink} />
            <Text style={styles.readerSequenceButtonText}>上一篇</Text>
          </Pressable>
          <View style={styles.readerSequencePosition}>
            {navigatingArticle ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Text style={styles.readerSequenceCount}>
                  {sequencePosition} / {sequenceTotal}
                </Text>
                <Text style={styles.readerSequenceHint}>
                  {article.contentKind === "interest" ? "兴趣书架" : "今日文章"}
                </Text>
              </>
            )}
          </View>
          <Pressable
            accessibilityLabel="下一篇文章"
            disabled={!onNextArticle || navigatingArticle}
            onPress={onNextArticle}
            style={({ pressed }) => [
              styles.readerSequenceButton,
              styles.readerSequenceButtonNext,
              (!onNextArticle || navigatingArticle) &&
                styles.readerSequenceDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.readerSequenceButtonTextNext}>下一篇</Text>
            <ChevronRight size={18} color="#fff" />
          </Pressable>
        </Animated.View>
      )}

      <Modal
        visible={!!selectedWord}
        transparent
        animationType="fade"
        onRequestClose={closeWord}
      >
        <Pressable
          style={[
            styles.modalBackdrop,
            showAnchoredWordCard && styles.popoverBackdrop,
          ]}
          onPress={closeWord}
        />
        {selectedWord && (
          <Animated.View
            onLayout={({ nativeEvent }) => {
              if (!showAnchoredWordCard) return;
              const measuredHeight = nativeEvent.layout.height;
              if (Math.abs(measuredHeight - wordCardHeight) > 1) {
                setWordCardHeight(measuredHeight);
              }
            }}
            style={[
              showAnchoredWordCard
                ? [
                    styles.wordPopover,
                    {
                      width: wordPopoverWidth,
                      left: wordPopoverLeft,
                      top: wordPopoverTop,
                      maxHeight: wordPopoverMaxHeight,
                    },
                  ]
                : [styles.wordSheet, { maxHeight: wordSheetMaxHeight }],
              {
                opacity: wordCardTransition,
                transform: [
                  showAnchoredWordCard
                    ? {
                        scale: wordCardTransition.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.96, 1],
                        }),
                      }
                    : {
                        translateY: wordCardTransition.interpolate({
                          inputRange: [0, 1],
                          outputRange: [32, 0],
                        }),
                      },
                ],
              },
            ]}
          >
            {!showAnchoredWordCard && <View style={styles.sheetHandle} />}
            <View style={styles.wordTop}>
              <View>
                <Text style={styles.wordTitle}>{selectedWord.word}</Text>
                <Text style={styles.phonetic}>
                  {selectedWord.phonetic || "音标查询中"}
                </Text>
              </View>
              <View style={styles.wordActions}>
                <WordAudioButton
                  pronunciationAccent={pronunciationAccent}
                  word={selectedWord.word}
                />
                <Pressable
                  accessibilityLabel="关闭"
                  onPress={closeWord}
                  style={styles.roundButton}
                >
                  <X size={20} color={colors.inkMuted} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              style={styles.wordDetailsScroll}
            >
              <View style={styles.translationRow}>
                <Text style={styles.translationLabel}>释义</Text>
                <View style={styles.translationContent}>
                  {wordLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : null}
                  <Text style={styles.translation}>{selectedWord.translation}</Text>
                  {!!selectedWord.partOfSpeech && (
                    <Text style={styles.partOfSpeech}>{selectedWord.partOfSpeech}</Text>
                  )}
                  {!!selectedWord.definition && (
                    <Text style={styles.englishDefinition}>
                      {selectedWord.definition}
                    </Text>
                  )}
                </View>
              </View>
              {!!selectedWord.example && (
                <View style={styles.exampleCard}>
                  <Text style={styles.exampleLabel}>例句</Text>
                  <Text style={styles.exampleEnglish}>{selectedWord.example}</Text>
                  {!!selectedWord.exampleTranslation && (
                    <Text style={styles.exampleChinese}>
                      {selectedWord.exampleTranslation}
                    </Text>
                  )}
                </View>
              )}
            </ScrollView>
            <Pressable
              accessibilityLabel={
                isSaved(selectedWord.word) ? "移出生词库" : "标记为生词"
              }
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => {
                onToggleWord(selectedWord, article);
                closeWord();
              }}
              style={[
                styles.saveWordButton,
                isSaved(selectedWord.word) && styles.removeWordButton,
              ]}
            >
              {isSaved(selectedWord.word) ? (
                <X size={19} color={colors.danger} />
              ) : (
                <BookMarked size={19} color="#fff" />
              )}
              <Text
                style={[
                  styles.saveWordText,
                  isSaved(selectedWord.word) && styles.removeWordText,
                ]}
              >
                {isSaved(selectedWord.word) ? "移出生词库" : "标记为生词"}
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </Modal>

      <Modal
        visible={settingsVisible}
        transparent
        animationType={width >= 768 ? "fade" : "slide"}
        onRequestClose={() => setSettingsVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSettingsVisible(false)}
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={[
            styles.readerSettingsPanel,
            width >= 768 && styles.readerSettingsPanelDesktop,
          ]}
          contentContainerStyle={styles.readerSettingsContent}
        >
          <View style={styles.readerSettingsHeader}>
            <View>
              <Text style={styles.readerSettingsTitle}>阅读设置</Text>
              <Text style={styles.readerSettingsSubtitle}>
                排版应用到所有文章，限时仅应用当前文章
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭阅读设置"
              onPress={() => setSettingsVisible(false)}
              style={styles.roundButton}
            >
              <X size={20} color={colors.inkMuted} />
            </Pressable>
          </View>

          <View style={styles.timerSettingCard}>
            <View style={styles.timerSettingHeader}>
              <View style={styles.timerSettingHeading}>
                <View style={styles.timerSettingIcon}>
                  <Clock3 size={18} color="#9DE8FF" />
                </View>
                <View>
                  <Text style={styles.timerSettingTitle}>本篇限时</Text>
                  <Text style={styles.timerSettingSubtitle}>
                    时间到后播放动画与英语语音
                  </Text>
                </View>
              </View>
              <Switch
                accessibilityLabel="启用本篇倒计时"
                value={timerSettings.enabled}
                onValueChange={toggleArticleTimer}
                trackColor={{ false: "#394653", true: "#176F89" }}
                thumbColor={timerSettings.enabled ? "#B9F2FF" : "#AAB2B8"}
              />
            </View>

            <View style={styles.timerDurationRow}>
              <View style={styles.timerInputWrap}>
                <TextInput
                  accessibilityLabel="本篇阅读限时分钟数"
                  value={timerMinutesInput}
                  onChangeText={(value) =>
                    setTimerMinutesInput(value.replace(/[^0-9]/g, ""))
                  }
                  onBlur={commitTimerInput}
                  onSubmitEditing={commitTimerInput}
                  keyboardType="number-pad"
                  maxLength={3}
                  selectTextOnFocus
                  style={styles.timerMinutesInput}
                />
                <Text style={styles.timerMinutesUnit}>分钟</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重新开始本篇倒计时"
                onPress={resetArticleTimer}
                style={({ pressed }) => [
                  styles.timerResetButton,
                  pressed && styles.pressed,
                ]}
              >
                <RotateCcw size={16} color="#BDEEFF" />
                <Text style={styles.timerResetText}>重新计时</Text>
              </Pressable>
            </View>

            <View style={styles.timerPresetRow}>
              {[5, 10, 15, 20].map((minutes) => (
                <Pressable
                  key={minutes}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: timerSettings.durationMinutes === minutes,
                  }}
                  onPress={() => setTimerDuration(minutes)}
                  style={[
                    styles.timerPreset,
                    timerSettings.durationMinutes === minutes &&
                      styles.timerPresetActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.timerPresetText,
                      timerSettings.durationMinutes === minutes &&
                        styles.timerPresetTextActive,
                    ]}
                  >
                    {minutes} min
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.timerStyleLabel}>提醒风格</Text>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                checked: timerSettings.reminderStyle === "mecha-blade",
              }}
              onPress={() => selectReminderStyle("mecha-blade")}
              style={[
                styles.timerStyleChoice,
                timerSettings.reminderStyle === "mecha-blade" &&
                  styles.timerStyleChoiceActive,
              ]}
            >
              <View style={styles.timerStylePreview}>
                <View style={styles.timerStyleVisor} />
                <View style={styles.timerStyleBlade} />
              </View>
              <View style={styles.timerStyleCopy}>
                <Text style={styles.timerStyleTitle}>机甲拔刀</Text>
                <Text style={styles.timerStyleDescription}>
                  全屏警报 · 光剑斩击 · 低沉英语语音
                </Text>
              </View>
              <View style={styles.timerStyleSelected}>
                <Check size={14} color="#071119" />
              </View>
            </Pressable>
            <View style={styles.timerPreviewRow}>
              <Text style={styles.timerFutureStyles}>更多提醒风格即将加入</Text>
              <Pressable
                accessibilityRole="button"
                onPress={previewTimeUpReminder}
                style={({ pressed }) => [
                  styles.timerPreviewButton,
                  pressed && styles.pressed,
                ]}
              >
                <Play size={14} color="#071119" fill="#071119" />
                <Text style={styles.timerPreviewText}>预览提醒</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.readerSettingGroup}>
            <View style={styles.readerSettingLabelRow}>
              <Text style={styles.readerSettingLabel}>字号</Text>
              <Text style={styles.readerSettingValue}>
                {Math.round(readerSettings.fontScale * 100)}%
              </Text>
            </View>
            <View style={styles.fontScaleControls}>
              <Pressable
                accessibilityLabel="减小字号"
                disabled={readerSettings.fontScale <= 0.85}
                onPress={() =>
                  updateReaderSettings({
                    ...readerSettings,
                    fontScale: Math.max(0.85, readerSettings.fontScale - 0.1),
                  })
                }
                style={styles.fontScaleButton}
              >
                <Text style={styles.fontScaleButtonText}>A−</Text>
              </Pressable>
              <View style={styles.fontScalePreview}>
                <Text
                  style={[
                    styles.fontScalePreviewText,
                    { fontSize: 18 * readerSettings.fontScale },
                  ]}
                >
                  Reading makes words memorable.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="增大字号"
                disabled={readerSettings.fontScale >= 1.3}
                onPress={() =>
                  updateReaderSettings({
                    ...readerSettings,
                    fontScale: Math.min(1.3, readerSettings.fontScale + 0.1),
                  })
                }
                style={styles.fontScaleButton}
              >
                <Text style={styles.fontScaleButtonText}>A＋</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.readerSettingGroup}>
            <Text style={styles.readerSettingLabel}>行距</Text>
            <View style={styles.readerChoiceRow}>
              {([
                ["compact", "紧凑"],
                ["standard", "标准"],
                ["relaxed", "宽松"],
              ] as const).map(([value, label]) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: readerSettings.lineSpacing === value,
                  }}
                  aria-checked={readerSettings.lineSpacing === value}
                  key={value}
                  onPress={() =>
                    updateReaderSettings({ ...readerSettings, lineSpacing: value })
                  }
                  style={[
                    styles.readerChoice,
                    readerSettings.lineSpacing === value &&
                      styles.readerChoiceActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.readerChoiceText,
                      readerSettings.lineSpacing === value &&
                        styles.readerChoiceTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.readerSettingsGrid}>
            <View style={styles.readerSettingGroupCompact}>
              <Text style={styles.readerSettingLabel}>字体</Text>
              <View style={styles.readerChoiceRow}>
                {([
                  ["serif", "衬线"],
                  ["sans", "无衬线"],
                ] as const).map(([value, label]) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: readerSettings.fontFamily === value,
                    }}
                    aria-checked={readerSettings.fontFamily === value}
                    key={value}
                    onPress={() =>
                      updateReaderSettings({ ...readerSettings, fontFamily: value })
                    }
                    style={[
                      styles.readerChoice,
                      readerSettings.fontFamily === value &&
                        styles.readerChoiceActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.readerChoiceText,
                        readerSettings.fontFamily === value &&
                          styles.readerChoiceTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.readerSettingGroupCompact}>
              <Text style={styles.readerSettingLabel}>页面宽度</Text>
              <View style={styles.readerChoiceRow}>
                {([
                  ["narrow", "窄"],
                  ["standard", "标准"],
                  ["wide", "宽"],
                ] as const).map(([value, label]) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: readerSettings.columnWidth === value,
                    }}
                    aria-checked={readerSettings.columnWidth === value}
                    key={value}
                    onPress={() =>
                      updateReaderSettings({ ...readerSettings, columnWidth: value })
                    }
                    style={[
                      styles.readerChoice,
                      readerSettings.columnWidth === value &&
                        styles.readerChoiceActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.readerChoiceText,
                        readerSettings.columnWidth === value &&
                          styles.readerChoiceTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.readerSettingGroup}>
            <Text style={styles.readerSettingLabel}>页面色调</Text>
            <View style={styles.readerToneRow}>
              {([
                ["paper", "纸张", "#F3F1EA"],
                ["white", "柔白", "#FFFFFF"],
                ["green", "护眼", "#EAF1E8"],
              ] as const).map(([value, label, color]) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: readerSettings.pageTone === value,
                  }}
                  aria-checked={readerSettings.pageTone === value}
                  key={value}
                  onPress={() =>
                    updateReaderSettings({ ...readerSettings, pageTone: value })
                  }
                  style={[
                    styles.readerToneChoice,
                    readerSettings.pageTone === value &&
                      styles.readerToneChoiceActive,
                  ]}
                >
                  <View style={[styles.readerToneSwatch, { backgroundColor: color }]} />
                  <Text style={styles.readerToneText}>{label}</Text>
                  {readerSettings.pageTone === value && (
                    <Check size={16} color={colors.primary} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.readerSettingTip}>
            <Text style={styles.readerSettingTipText}>
              {Platform.OS === "web" && width >= 768
                ? "提示：鼠标按住正文中的单词即可查看释义和例句。"
                : "提示：长按正文中的单词即可查看释义和例句。"}
            </Text>
          </View>
        </ScrollView>
      </Modal>
      <TimeLimitReminder
        visible={timeUpVisible}
        reminderStyle={timerSettings.reminderStyle}
        onAddMinute={addOneMinute}
        onDismiss={() => setTimeUpVisible(false)}
      />
      <NativeNoticeModal
        notice={readerNotice}
        primaryLabel={
          readerNotice?.kind === "submit-error" ? "重新提交" : "继续答题"
        }
        secondaryLabel={
          readerNotice?.kind === "submit-error" ? "稍后再试" : "留在文章"
        }
        onClose={() => setReaderNotice(null)}
        onPrimary={() => {
          if (readerNotice?.kind === "submit-error") {
            void openAnswers();
            return;
          }
          setReaderTab("article");
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              y: Math.max(0, questionsOffsetRef.current - 20),
              animated: true,
            });
          });
        }}
      />
    </AnimatedSafeAreaView>
  );
}

function HistoryScreen({
  history,
  mistakes,
  stats,
  onOpen,
}: {
  history: HistoryRecord[];
  mistakes: MistakeItem[];
  stats: LearningStats;
  onOpen: (articleId: string, retry?: boolean) => void;
}) {
  const [mode, setMode] = useState<"history" | "mistakes">("history");
  const [filter, setFilter] = useState<"all" | "completed" | "pending">("all");
  const records = history
    .map((record) => {
      const historyArticles =
        record.articles ??
        record.articleIds.flatMap((id) => {
          const article = articles.find((item) => item.id === id);
          return article
            ? [{ ...article, completed: false, score: null, total: null, readingRatio: 0 }]
            : [];
        });
      return {
        ...record,
        articles: historyArticles.filter((article) =>
          filter === "all"
            ? true
            : filter === "completed"
              ? article.completed
              : !article.completed,
        ),
      };
    })
    .filter((record) => record.articles.length > 0);
  const readingMinutes = Math.round(stats.readingSeconds / 60);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Header
        title="阅读历史"
        subtitle="你的每一次阅读都算数"
        right={
          <View style={styles.iconButton}>
            <HistoryIcon size={20} color={colors.primary} />
          </View>
        }
      />
      <View style={styles.historySummary}>
        <View>
          <Text style={styles.summaryValue}>{stats.completedArticles}</Text>
          <Text style={styles.summaryLabel}>累计阅读</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.summaryValue}>{stats.learningDays}</Text>
          <Text style={styles.summaryLabel}>学习天数</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.summaryValue}>{readingMinutes}</Text>
          <Text style={styles.summaryLabel}>阅读分钟</Text>
        </View>
      </View>
      <View accessibilityRole="tablist" style={styles.historyModeTabs}>
        {([
          ["history", "阅读记录"],
          ["mistakes", `错题本 ${mistakes.length}`],
        ] as const).map(([id, label]) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === id }}
            aria-selected={mode === id}
            key={id}
            onPress={() => setMode(id)}
            style={[styles.historyModeTab, mode === id && styles.historyModeTabActive]}
          >
            <Text style={[styles.historyModeText, mode === id && styles.historyModeTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === "history" ? (
        <>
          <View style={styles.historyFilters}>
            {([
              ["all", "全部"],
              ["completed", "已完成"],
              ["pending", "未完成"],
            ] as const).map(([id, label]) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: filter === id }}
                aria-pressed={filter === id}
                key={id}
                onPress={() => setFilter(id)}
                style={[styles.historyFilter, filter === id && styles.historyFilterActive]}
              >
                <Text style={[styles.historyFilterText, filter === id && styles.historyFilterTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          {records.length === 0 && (
            <View style={styles.historyEmpty}>
              <BookOpen size={28} color={colors.inkMuted} />
              <Text style={styles.historyEmptyTitle}>暂无符合条件的文章</Text>
              <Text style={styles.historyEmptyText}>完成一篇阅读后会自动出现在这里</Text>
            </View>
          )}
          {records.map((record) => (
            <View key={`${record.date}-${record.examId}`} style={styles.historyGroup}>
              <View style={styles.historyDateRow}>
                <View style={styles.timelineDot} />
                <Text style={styles.historyDate}>
                  {record.date === formatDateKey() ? "今天" : record.date}
                </Text>
                <Text style={styles.historyExam}>{getExam(record.examId).name}</Text>
              </View>
              {record.articles.map((article) => (
                <Pressable
                  key={article.id}
                  onPress={() => onOpen(article.id)}
                  style={styles.historyArticle}
                >
                  <View style={styles.historyArticleIcon}>
                    <BookOpen size={18} color={colors.primary} />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.historyArticleTitle}>{article.title}</Text>
                    <Text style={styles.historyArticleMeta}>
                      {article.eyebrow} · {article.readMinutes} 分钟
                    </Text>
                  </View>
                  <View style={styles.historyArticleStatus}>
                    <Text style={article.completed ? styles.historyCompletedText : styles.historyPendingText}>
                      {article.completed
                        ? `${article.score ?? 0}/${article.total ?? 0}`
                        : article.readingRatio > 0
                          ? `${Math.round(article.readingRatio * 100)}%`
                          : "未开始"}
                    </Text>
                    <ChevronRight size={17} color={colors.inkMuted} />
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </>
      ) : mistakes.length === 0 ? (
        <View style={styles.historyEmpty}>
          <Check size={28} color={colors.primary} />
          <Text style={styles.historyEmptyTitle}>目前没有错题</Text>
          <Text style={styles.historyEmptyText}>继续保持，新的作答结果会自动整理</Text>
        </View>
      ) : (
        <View style={styles.mistakeList}>
          {mistakes.map((mistake) => (
            <View key={mistake.id} style={styles.mistakeCard}>
              <Text style={styles.mistakeSource}>{mistake.article.title}</Text>
              <Text style={styles.mistakePrompt}>{mistake.prompt}</Text>
              <Text style={styles.mistakeWrong}>
                你的答案：{String.fromCharCode(65 + mistake.selectedAnswer)} · {mistake.options[mistake.selectedAnswer]}
              </Text>
              <Text style={styles.mistakeCorrect}>
                正确答案：{String.fromCharCode(65 + mistake.correctAnswer)} · {mistake.options[mistake.correctAnswer]}
              </Text>
              <Text style={styles.mistakeExplanation}>{mistake.explanation}</Text>
              <Pressable
                accessibilityLabel={`重新练习：${mistake.article.title}`}
                onPress={() => onOpen(mistake.article.id, true)}
                style={styles.mistakeRetry}
              >
                <Text style={styles.mistakeRetryText}>重新练习整篇</Text>
                <ChevronRight size={16} color={colors.primary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const memoryRatings: Array<{
  id: MemoryRating;
  label: string;
  hint: string;
}> = [
  { id: "again", label: "忘记", hint: "重新学习" },
  { id: "hard", label: "模糊", hint: "加强记忆" },
  { id: "good", label: "记住", hint: "正常推进" },
  { id: "easy", label: "熟练", hint: "延长间隔" },
];

function MemoryReviewSession({
  words,
  pronunciationAccent,
  onClose,
  onReview,
}: {
  words: SavedWord[];
  pronunciationAccent: LearningSettings["pronunciationAccent"];
  onClose: () => void;
  onReview: (word: SavedWord, rating: MemoryRating) => Promise<SavedWord>;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<MemoryRating | null>(
    null,
  );
  const current = words[index];
  const finished = index >= words.length;
  const progress = words.length ? Math.min(100, (index / words.length) * 100) : 0;
  const cardWidth = Math.min(620, width - (width >= 768 ? 120 : 28));

  const closeReview = () => {
    stopWordAudio();
    onClose();
  };

  const rateWord = async (rating: MemoryRating) => {
    if (!current || submittingRating) return;
    setSubmittingRating(rating);
    try {
      await onReview(current, rating);
      setIndex((value) => value + 1);
      setRevealed(false);
    } catch {
      // The parent restores the previous state and presents the sync error.
    } finally {
      setSubmittingRating(null);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={closeReview}>
      <SafeAreaView style={styles.memoryReviewSafe}>
        <ExpoStatusBar style="dark" />
        <View style={styles.memoryReviewHeader}>
          <Pressable
            accessibilityLabel="退出记忆卡复习"
            accessibilityRole="button"
            hitSlop={10}
            onPress={closeReview}
            pressRetentionOffset={12}
            style={({ pressed }) => [
              styles.memoryExitButton,
              pressed && styles.pressed,
            ]}
          >
            <ArrowLeft size={19} color={colors.ink} />
            <Text style={styles.memoryExitText}>退出</Text>
          </Pressable>
          <View style={styles.memoryReviewHeaderCenter}>
            <Text style={styles.memoryReviewHeaderTitle}>记忆卡复习</Text>
            <Text style={styles.memoryReviewHeaderMeta}>
              {finished ? words.length : index + 1} / {words.length}
            </Text>
          </View>
          <View style={styles.memoryReviewHeaderSpacer} />
        </View>
        <View style={styles.memoryProgressTrack}>
          <View
            style={[
              styles.memoryProgressFill,
              { width: `${finished ? 100 : progress}%` },
            ]}
          />
        </View>

        {finished ? (
          <View style={styles.memoryComplete}>
            <View style={styles.memoryCompleteIcon}>
              <Check size={34} color="#fff" strokeWidth={2.5} />
            </View>
            <Text style={styles.memoryCompleteTitle}>本轮复习完成</Text>
            <Text style={styles.memoryCompleteText}>
              已复习 {words.length} 个生词。系统会根据记忆反馈，在合适的时间再次提醒你。
            </Text>
            <Pressable
              onPress={closeReview}
              style={({ pressed }) => [
                styles.memoryCompleteButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.memoryCompleteButtonText}>返回生词库</Text>
            </Pressable>
          </View>
        ) : current ? (
          <ScrollView
            style={styles.memoryReviewScroller}
            contentContainerStyle={styles.memoryReviewContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.memoryReviewEyebrow}>
              {revealed ? "查看答案并评价记忆程度" : "先在脑中回想它的含义"}
            </Text>
            <Pressable
              accessibilityLabel={
                revealed ? `${current.word} 的释义已显示` : `翻开 ${current.word} 记忆卡`
              }
              onPress={() => setRevealed(true)}
              style={({ pressed }) => [
                styles.memoryCard,
                { width: cardWidth },
                revealed && styles.memoryCardRevealed,
                pressed && !revealed && styles.cardPressed,
              ]}
            >
              <View style={styles.memoryCardBadge}>
                <Text style={styles.memoryCardBadgeText}>
                  {revealed ? "BACK · 释义" : "FRONT · 单词"}
                </Text>
              </View>
              <Text style={styles.memoryCardWord}>{current.word}</Text>
              <Text style={styles.memoryCardPhonetic}>
                {current.phonetic && current.phonetic !== "/ pronunciation /"
                  ? current.phonetic
                  : "音标待更新"}
              </Text>
              <WordAudioButton
                pronunciationAccent={pronunciationAccent}
                variant="memory"
                word={current.word}
              />

              {revealed ? (
                <View style={styles.memoryAnswer}>
                  <Text style={styles.memoryTranslation}>{current.translation}</Text>
                  {!!current.partOfSpeech && (
                    <Text style={styles.memoryPartOfSpeech}>
                      {current.partOfSpeech}
                    </Text>
                  )}
                  {!!current.definition && (
                    <Text style={styles.memoryDefinition}>{current.definition}</Text>
                  )}
                  {!!current.example && (
                    <View style={styles.memoryExample}>
                      <Text style={styles.memoryExampleEnglish}>
                        {current.example}
                      </Text>
                      {!!current.exampleTranslation && (
                        <Text style={styles.memoryExampleChinese}>
                          {current.exampleTranslation}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.memoryRevealHint}>
                  <Text style={styles.memoryRevealHintText}>点击卡片查看释义</Text>
                  <ChevronRight size={16} color={colors.inkMuted} />
                </View>
              )}
            </Pressable>

            {revealed && (
              <View style={[styles.memoryRatingArea, { width: cardWidth }]}>
                <Text style={styles.memoryRatingTitle}>你记得怎么样？</Text>
                <View style={styles.memoryRatingGrid}>
                  {memoryRatings.map((rating) => (
                    <Pressable
                      key={rating.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${rating.label}，下次复习间隔 ${reviewIntervalLabel(current.memoryStage ?? 0, rating.id)}`}
                      disabled={!!submittingRating}
                      onPress={() => rateWord(rating.id)}
                      style={({ pressed }) => [
                        styles.memoryRatingButton,
                        styles[`memoryRating_${rating.id}`],
                        pressed && styles.pressed,
                        submittingRating && styles.disabledButton,
                      ]}
                    >
                      {submittingRating === rating.id ? (
                        <ActivityIndicator size="small" color={colors.ink} />
                      ) : (
                        <>
                          <Text style={styles.memoryRatingLabel}>{rating.label}</Text>
                          <Text style={styles.memoryRatingHint}>{rating.hint}</Text>
                          <Text style={styles.memoryRatingInterval}>
                            {reviewIntervalLabel(
                              current.memoryStage ?? 0,
                              rating.id,
                            )}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function WordsScreen({
  words,
  activeExam,
  pronunciationAccent,
  onRemove,
  onReview,
  onOpenSource,
}: {
  words: SavedWord[];
  activeExam: ExamId;
  pronunciationAccent: LearningSettings["pronunciationAccent"];
  onRemove: (word: SavedWord) => Promise<void>;
  onReview: (word: SavedWord, rating: MemoryRating) => Promise<SavedWord>;
  onOpenSource: (articleId: string, examId: ExamId) => void;
}) {
  const [filter, setFilter] = useState<ExamId>(activeExam);
  const [search, setSearch] = useState("");
  const [pendingRemove, setPendingRemove] = useState<SavedWord | null>(null);
  const [removing, setRemoving] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<SavedWord[] | null>(null);
  const examWords = words.filter((word) => word.examId === filter);
  const dueWords = examWords.filter((word) => isReviewDue(word.nextReviewAt));
  const filtered = words.filter(
    (word) =>
      word.examId === filter && word.word.includes(search.toLowerCase()),
  );

  const confirmRemove = async () => {
    if (!pendingRemove || removing) return;
    setRemoving(true);
    try {
      await onRemove(pendingRemove);
      setPendingRemove(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.screenContent}
        stickyHeaderIndices={[3]}
        showsVerticalScrollIndicator={false}
      >
        <Header
          title="历史生词库"
          subtitle={`${words.length} 个词，正在成为你的词汇`}
          right={
            <View style={styles.iconButton}>
              <BookMarked size={20} color={colors.primary} />
            </View>
          }
        />
        <View style={styles.wordStatsCard}>
          <View style={styles.wordStatsIcon}>
            <Library size={24} color={colors.primary} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.wordStatsTitle}>
              本周新收录 {words.length} 个
            </Text>
            <Text style={styles.wordStatsText}>
              在原文语境里复习，记忆更牢固
            </Text>
          </View>
          <View style={styles.streakCircle}>
            <Text style={styles.streakCircleValue}>7</Text>
            <Text style={styles.streakCircleLabel}>天</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="开始记忆卡复习"
          disabled={examWords.length === 0}
          onPress={() =>
            setReviewQueue((dueWords.length ? dueWords : examWords).slice(0, 30))
          }
          style={({ pressed }) => [
            styles.memoryReviewBanner,
            pressed && styles.cardPressed,
            examWords.length === 0 && styles.disabledButton,
          ]}
        >
          <View style={styles.memoryReviewBannerIcon}>
            <Sparkles size={23} color={colors.accent} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.memoryReviewBannerTitle}>记忆卡复习</Text>
            <Text style={styles.memoryReviewBannerText}>
              {examWords.length === 0
                ? "先在阅读中标记生词，再开始记忆练习"
                : dueWords.length
                  ? `${dueWords.length} 个生词已到复习时间`
                  : "今天的到期任务已完成，可自由练习"}
            </Text>
          </View>
          <View style={styles.memoryReviewBannerAction}>
            <Text style={styles.memoryReviewBannerActionText}>
              {dueWords.length ? "开始" : "练习"}
            </Text>
            <ChevronRight size={16} color="#fff" />
          </View>
        </Pressable>
        <View style={styles.stickyArea}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.examFilters}
          >
            {exams.map((exam) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: filter === exam.id }}
                aria-pressed={filter === exam.id}
                key={exam.id}
                onPress={() => setFilter(exam.id)}
                style={[
                  styles.filterPill,
                  filter === exam.id && styles.filterPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === exam.id && styles.filterTextActive,
                  ]}
                >
                  {exam.name.replace(/ .+$/, "")}
                </Text>
                <View
                  style={[
                    styles.filterCount,
                    filter === exam.id && styles.filterCountActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterCountText,
                      filter === exam.id && styles.filterCountTextActive,
                    ]}
                  >
                    {words.filter((w) => w.examId === exam.id).length}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.searchBox}>
            <Search size={18} color={colors.inkMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="搜索生词"
              placeholderTextColor="#909995"
              style={styles.searchInput}
              autoCapitalize="none"
            />
          </View>
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIllustration}>
              <BookMarked size={32} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>
              {search ? "没有找到这个词" : "这里还没有生词"}
            </Text>
            <Text style={styles.emptyText}>
              阅读文章时长按不熟悉的单词，{`\n`}它会自动出现在这里。
            </Text>
          </View>
        ) : (
          <View style={styles.wordList}>
            {filtered.map((item) => {
              const article = articles.find((a) => a.id === item.articleId);
              return (
                <View
                  key={`${item.examId}-${item.word}`}
                  style={styles.wordCard}
                >
                  <View style={styles.wordCardTop}>
                    <View>
                      <Text style={styles.wordCardTitle}>{item.word}</Text>
                      <Text style={styles.wordCardPhonetic}>
                        {item.phonetic && item.phonetic !== "/ pronunciation /"
                          ? item.phonetic
                          : "音标待更新"}
                      </Text>
                    </View>
                    <View style={styles.wordCardActions}>
                      <Pressable
                        accessibilityLabel={`播放 ${item.word} 的发音`}
                        onPress={() =>
                          playWord(item.word, undefined, pronunciationAccent)
                        }
                        style={styles.miniRoundButton}
                      >
                        <Volume2 size={17} color={colors.primary} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`移出生词库：${item.word}`}
                        accessibilityHint="打开移出生词库确认框"
                        onPress={() => setPendingRemove(item)}
                        style={styles.miniRoundButton}
                      >
                        <X size={18} color={colors.inkMuted} />
                      </Pressable>
                    </View>
                  </View>
                  <Text style={styles.wordCardTranslation}>
                    {item.translation}
                  </Text>
                  {!!item.example && (
                    <View style={styles.wordCardExample}>
                      <Text style={styles.wordCardExampleEnglish}>
                        {item.example}
                      </Text>
                      {!!item.exampleTranslation && (
                        <Text style={styles.wordCardExampleChinese}>
                          {item.exampleTranslation}
                        </Text>
                      )}
                    </View>
                  )}
                  <Pressable
                    accessibilityLabel={`查看原文：${item.articleTitle ?? article?.title ?? "阅读文章"}`}
                    onPress={() => onOpenSource(item.articleId, item.examId)}
                    style={({ pressed }) => [
                      styles.wordSource,
                      pressed && styles.wordSourcePressed,
                    ]}
                  >
                    <BookOpen size={14} color={colors.primary} />
                    <Text numberOfLines={1} style={styles.wordSourceText}>
                      摘自：{item.articleTitle ?? article?.title ?? "阅读文章"}
                    </Text>
                    <Text style={styles.wordSourceAction}>查看原文</Text>
                    <ChevronRight size={15} color={colors.primary} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!pendingRemove}
        transparent
        animationType="fade"
        onRequestClose={() => !removing && setPendingRemove(null)}
      >
        <View style={styles.confirmModalRoot}>
          <Pressable
            accessibilityLabel="取消移除"
            style={styles.confirmBackdrop}
            onPress={() => !removing && setPendingRemove(null)}
          />
          <View
            accessibilityRole="alert"
            accessibilityViewIsModal
            style={styles.confirmDialog}
          >
            <View style={styles.confirmIcon}>
              <BookMarked size={22} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>移出生词库？</Text>
            <Text style={styles.confirmText}>
              “{pendingRemove?.word}” 将不再在文章中高亮。
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={removing}
                onPress={() => setPendingRemove(null)}
                style={({ pressed }) => [
                  styles.confirmCancelButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.confirmCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`确认移除 ${pendingRemove?.word ?? "生词"}`}
                disabled={removing}
                onPress={confirmRemove}
                style={({ pressed }) => [
                  styles.confirmRemoveButton,
                  pressed && styles.pressed,
                  removing && styles.disabledButton,
                ]}
              >
                {removing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.confirmRemoveText}>移除</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {reviewQueue && (
        <MemoryReviewSession
          words={reviewQueue}
          pronunciationAccent={pronunciationAccent}
          onClose={() => setReviewQueue(null)}
          onReview={onReview}
        />
      )}
    </View>
  );
}

function ProfileScreen({
  examId,
  settings,
  selectedInterests,
  user,
  onChangeExam,
  onChangeSettings,
  onChangeInterests,
  onOpenAccount,
}: {
  examId: ExamId;
  settings: LearningSettings;
  selectedInterests: InterestId[];
  user: UserProfile | null;
  onChangeExam: (id: ExamId) => void;
  onChangeSettings: (settings: LearningSettings) => void | Promise<void>;
  onChangeInterests: (interests: InterestId[]) => void | Promise<void>;
  onOpenAccount: () => void;
}) {
  const [activePicker, setActivePicker] = useState<
    "exam" | "interests" | "time" | "accent" | "goal" | null
  >(null);
  const accentName =
    settings.pronunciationAccent === "us" ? "美式发音" : "英式发音";
  const interestNames = interestCategories
    .filter((category) => selectedInterests.includes(category.id))
    .map((category) => category.name)
    .join("、");
  const pickerConfig =
    activePicker === "exam"
      ? {
          title: "选择考试目标",
          subtitle: "后续文章推荐与生词分类会按此目标更新",
          selectedId: examId,
          options: exams.map((exam) => ({
            id: exam.id,
            label: exam.name,
            description: exam.subtitle,
          })),
        }
      : activePicker === "time"
        ? {
            title: "每日提醒时间",
            subtitle: "选择一个适合你安静阅读的时间",
            selectedId: settings.reminderTime,
            options: [
              { id: "08:00", label: "08:00", description: "早间阅读" },
              { id: "12:30", label: "12:30", description: "午间复习" },
              { id: "20:30", label: "20:30", description: "晚间学习" },
              { id: "22:00", label: "22:00", description: "睡前巩固" },
            ],
          }
        : activePicker === "accent"
          ? {
              title: "选择单词发音",
              subtitle: "会应用到文章、生词库和记忆卡",
              selectedId: settings.pronunciationAccent,
              options: [
                { id: "us", label: "美式发音", description: "English (US)" },
                { id: "uk", label: "英式发音", description: "English (UK)" },
              ],
            }
          : {
              title: "选择单词发音",
              subtitle: "会应用到文章、生词库和记忆卡",
              selectedId: settings.pronunciationAccent,
              options: [],
            };

  const handlePickerSelect = (id: string) => {
    if (activePicker === "exam") {
      onChangeExam(id as ExamId);
    } else if (activePicker === "time") {
      onChangeSettings({ ...settings, reminderTime: id });
    } else if (activePicker === "accent") {
      onChangeSettings({
        ...settings,
        pronunciationAccent: id as "us" | "uk",
      });
    }
    setActivePicker(null);
  };

  return (
    <View style={styles.flexOne}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        showsVerticalScrollIndicator={false}
      >
        <Header title="我的学习" subtitle="保持节奏，持续积累" />
        <Pressable
          accessibilityLabel={user?.isRegistered ? "编辑个人资料" : "登录或注册"}
          onPress={onOpenAccount}
          style={({ pressed }) => [
            styles.profileCard,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {(user?.displayName || "R").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.profileName}>
              {user?.displayName || "阅读学习者"}
            </Text>
            <Text style={styles.profileSubtitle}>
              {user?.isRegistered ? `@${user.username}` : "游客账号 · 登录后同步学习数据"}
            </Text>
          </View>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>
              {user?.isRegistered ? "编辑资料" : "登录 / 注册"}
            </Text>
          </View>
        </Pressable>
        <Text style={styles.settingsTitle}>学习设置</Text>
        <View style={styles.settingsGroup}>
          <Pressable
            accessibilityLabel="修改考试目标"
            onPress={() => setActivePicker("exam")}
            style={({ pressed }) => [
              styles.settingRow,
              pressed && styles.settingRowPressed,
            ]}
          >
            <View style={styles.settingIcon}>
              <Target size={19} color={colors.primary} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.settingLabel}>考试目标</Text>
              <Text style={styles.settingValue}>{getExam(examId).name}</Text>
            </View>
            <ChevronRight size={18} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.settingSeparator} />
          <Pressable
            accessibilityLabel="修改兴趣阅读栏目"
            onPress={() => setActivePicker("interests")}
            style={({ pressed }) => [
              styles.settingRow,
              pressed && styles.settingRowPressed,
            ]}
          >
            <View style={styles.settingIcon}>
              <Sparkles size={19} color={colors.primary} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.settingLabel}>兴趣阅读</Text>
              <Text numberOfLines={1} style={styles.settingValue}>
                {interestNames || "尚未选择"}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.settingSeparator} />
          <View style={styles.settingRow}>
            <Pressable
              accessibilityLabel="修改每日提醒时间"
              onPress={() => setActivePicker("time")}
              style={({ pressed }) => [
                styles.settingRowMain,
                pressed && styles.settingRowPressed,
              ]}
            >
              <View style={styles.settingIcon}>
                <Bell size={19} color={colors.primary} />
              </View>
              <View style={styles.flexOne}>
                <Text style={styles.settingLabel}>每日提醒</Text>
                <Text style={styles.settingValue}>
                  {settings.dailyReminderEnabled
                    ? `每天 ${settings.reminderTime}`
                    : `已关闭 · ${settings.reminderTime}`}
                </Text>
              </View>
            </Pressable>
            <View style={styles.settingSwitchWrap}>
              <Switch
                accessibilityLabel="每日提醒开关"
                value={settings.dailyReminderEnabled}
                onValueChange={(dailyReminderEnabled) =>
                  onChangeSettings({ ...settings, dailyReminderEnabled })
                }
                trackColor={{ false: "#D6DCD9", true: colors.primary }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#D6DCD9"
                style={styles.settingSwitch}
              />
            </View>
          </View>
          <View style={styles.settingSeparator} />
          <Pressable
            accessibilityLabel="修改单词发音"
            onPress={() => setActivePicker("accent")}
            style={({ pressed }) => [
              styles.settingRow,
              pressed && styles.settingRowPressed,
            ]}
          >
            <View style={styles.settingIcon}>
              <Headphones size={19} color={colors.primary} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.settingLabel}>英式 / 美式发音</Text>
              <Text style={styles.settingValue}>{accentName}</Text>
            </View>
            <ChevronRight size={18} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.settingSeparator} />
          <Pressable
            accessibilityLabel="修改每日阅读目标"
            onPress={() => setActivePicker("goal")}
            style={({ pressed }) => [
              styles.settingRow,
              pressed && styles.settingRowPressed,
            ]}
          >
            <View style={styles.settingIcon}>
              <BookOpen size={19} color={colors.primary} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.settingLabel}>每日阅读目标</Text>
              <Text style={styles.settingValue}>每天 {settings.dailyGoal} 篇</Text>
            </View>
            <ChevronRight size={18} color={colors.inkMuted} />
          </Pressable>
        </View>
        <View style={styles.quoteCard}>
          <Text style={styles.quoteMark}>“</Text>
          <Text style={styles.quoteText}>
            A reader lives a thousand lives before he dies.
          </Text>
          <Text style={styles.quoteAuthor}>— George R. R. Martin</Text>
        </View>
      </ScrollView>
      {activePicker && activePicker !== "goal" && activePicker !== "interests" && (
        <NativeChoiceSheet
          visible
          title={pickerConfig.title}
          subtitle={pickerConfig.subtitle}
          options={pickerConfig.options}
          selectedId={pickerConfig.selectedId}
          onSelect={handlePickerSelect}
          onClose={() => setActivePicker(null)}
        />
      )}
      <InterestPickerSheet
        visible={activePicker === "interests"}
        selected={selectedInterests}
        onSave={onChangeInterests}
        onClose={() => setActivePicker(null)}
      />
      <DailyGoalSheet
        visible={activePicker === "goal"}
        value={settings.dailyGoal}
        onSave={(dailyGoal) =>
          onChangeSettings({ ...settings, dailyGoal })
        }
        onClose={() => setActivePicker(null)}
      />
    </View>
  );
}

function Navigation({
  active,
  tablet,
  bottomInset = 0,
  onChange,
}: {
  active: TabId;
  tablet: boolean;
  bottomInset?: number;
  onChange: (tab: TabId) => void;
}) {
  const reducedMotion = useReducedMotion();
  const indicatorAnimations = useRef<Record<TabId, Animated.Value>>({
    today: new Animated.Value(active === "today" ? 1 : 0),
    history: new Animated.Value(active === "history" ? 1 : 0),
    words: new Animated.Value(active === "words" ? 1 : 0),
    profile: new Animated.Value(active === "profile" ? 1 : 0),
  }).current;

  useEffect(() => {
    navItems.forEach(({ id }) => {
      if (reducedMotion) {
        indicatorAnimations[id].setValue(active === id ? 1 : 0);
        return;
      }
      Animated.spring(indicatorAnimations[id], {
        toValue: active === id ? 1 : 0,
        damping: 20,
        stiffness: 260,
        mass: 0.72,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
    });
  }, [active, indicatorAnimations, reducedMotion]);

  if (tablet) {
    return (
      <View style={styles.sideNav}>
        <AppLogo compact />
        <View accessibilityRole="tablist" style={styles.sideNavItems}>
          {navItems.map(({ id, label, icon: Icon }) => (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active === id }}
              aria-selected={active === id}
              key={id}
              onPress={() => onChange(id)}
              style={({ pressed }) => [
                styles.sideNavItem,
                active === id && styles.sideNavItemActive,
                pressed && styles.navItemPressed,
              ]}
            >
              <Icon
                size={22}
                color={active === id ? colors.primary : colors.inkMuted}
              />
              <Text
                style={[
                  styles.sideNavText,
                  active === id && styles.sideNavTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.sideNavFooter}>
          <Text style={styles.sideNavFooterText}>每天读一点</Text>
          <Text style={styles.sideNavFooterSub}>词汇自然多一点</Text>
        </View>
      </View>
    );
  }
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bottomNav,
        {
          height: MOBILE_NAV_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
        },
      ]}
    >
      {navItems.map(({ id, label, icon: Icon }) => (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === id }}
          aria-selected={active === id}
          key={id}
          onPress={() => onChange(id)}
          style={({ pressed }) => [
            styles.bottomNavItem,
            Platform.OS === "ios" && styles.bottomNavItemIOS,
            pressed && styles.bottomNavItemPressed,
          ]}
        >
          <View style={styles.bottomIconWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bottomIconIndicator,
                {
                  opacity: indicatorAnimations[id],
                  transform: [
                    {
                      scale: indicatorAnimations[id].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.78, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Icon
              size={21}
              color={active === id ? colors.primary : colors.inkMuted}
              strokeWidth={active === id ? 2.5 : 2}
            />
          </View>
          <Text
            style={[
              styles.bottomNavText,
              active === id && styles.bottomNavTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function AppContent() {
  const { width } = useWindowDimensions();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const tablet = width >= 768;
  const [loading, setLoading] = useState(true);
  const [examId, setExamId] = useState<ExamId | null>(null);
  const [tab, setTab] = useState<TabId>("today");
  const [reader, setReader] = useState<Article | null>(null);
  const [readerQueue, setReaderQueue] = useState<string[]>([]);
  const [readerNavigating, setReaderNavigating] = useState(false);
  const [readerPracticeMode, setReaderPracticeMode] = useState(false);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [daily, setDaily] = useState<Article[]>([]);
  const [interestFeed, setInterestFeed] = useState<Article[]>([]);
  const [selectedInterests, setSelectedInterests] = useState<InterestId[]>(
    defaultInterestIds,
  );
  const [manualPushes, setManualPushes] = useState<ManualPush[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [learningSettings, setLearningSettings] = useState<LearningSettings>(
    DEFAULT_LEARNING_SETTINGS,
  );
  const [readerPreferences, setReaderPreferences] = useState<ReaderSettings>(
    DEFAULT_READER_SETTINGS,
  );
  const [learningStats, setLearningStats] = useState<LearningStats>(
    EMPTY_LEARNING_STATS,
  );
  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      const [
        savedExam,
        cachedWords,
        cachedHistory,
        cachedCompleted,
        deviceId,
        token,
        cachedLearningSettings,
        cachedReaderSettings,
        cachedInterests,
      ] = await Promise.all([
        storage.getExam(),
        storage.getWords(),
        storage.getHistory(),
        storage.getCompleted(),
        storage.getDeviceId(),
        storage.getAuthToken(),
        storage.getLearningSettings(),
        storage.getReaderSettings(),
        storage.getInterests(),
      ]);

      setExamId(savedExam);
      setCurrentDeviceId(deviceId);
      setSavedWords(cachedWords);
      setHistory(cachedHistory);
      setCompleted(cachedCompleted);
      if (cachedLearningSettings) {
        setLearningSettings({
          ...DEFAULT_LEARNING_SETTINGS,
          ...cachedLearningSettings,
        });
      }
      if (cachedReaderSettings) {
        setReaderPreferences({
          ...DEFAULT_READER_SETTINGS,
          ...cachedReaderSettings,
        });
      }
      const initialInterests = cachedInterests.length
        ? cachedInterests
        : defaultInterestIds;
      setSelectedInterests(initialInterests);
      if (savedExam) {
        setDaily(
          getDailyArticles(
            savedExam,
            new Date(),
            [],
            cachedLearningSettings?.dailyGoal ?? 3,
            initialInterests,
          ),
        );
        setInterestFeed(getInterestArticles(savedExam, initialInterests));
      }

      if (!token) {
        api.clearAuthentication();
        setAuthRequired(true);
        setLoading(false);
        return;
      }

      try {
        const session = await api.authenticate(deviceId, token);
        if (!session.isRegistered) {
          api.clearAuthentication();
          await storage.clearAuthToken();
          setAuthRequired(true);
          return;
        }
        await storage.setAuthToken(session.token);
        setCurrentUser(session);
        if (savedExam && session.examId !== savedExam) {
          const updated = await api.setExam(savedExam);
          setCurrentUser(updated);
        }
        if (savedExam) {
          const [
            remoteDaily,
            remoteHistory,
            remoteWords,
            pushes,
            preferences,
            stats,
            remoteMistakes,
            remoteInterestFeed,
          ] =
            await Promise.all([
              api.getDaily(),
              api.getHistory(),
              api.getVocabulary(),
              api.getPushes(),
              api.getPreferences(),
              api.getLearningStats(),
              api.getMistakes(),
              api.getInterestFeed(),
            ]);
          const completedIds = [
            ...new Set([
              ...remoteHistory.completedIds,
              ...pushes
                .filter((push) => push.completedAt)
                .map((push) => push.article.id),
            ]),
          ];
          setDaily(remoteDaily);
          setManualPushes(pushes);
          setHistory(remoteHistory.records);
          setCompleted(completedIds);
          setSavedWords(remoteWords);
          setLearningSettings(preferences.learning);
          setReaderPreferences(preferences.reader);
          setLearningStats(stats);
          setMistakes(remoteMistakes);
          setSelectedInterests(preferences.interests);
          setInterestFeed(remoteInterestFeed);
          void syncDailyReminder(preferences.learning).catch(() => undefined);
          await Promise.all([
            storage.setHistory(remoteHistory.records),
            storage.setCompleted(completedIds),
            storage.setWords(remoteWords),
            storage.setLearningSettings(preferences.learning),
            storage.setReaderSettings(preferences.reader),
            storage.setInterests(preferences.interests),
          ]);
        }
        setApiOnline(true);
      } catch (error) {
        console.warn("Authentication unavailable", error);
        setAuthRequired(true);
        setApiOnline(false);
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    if (!apiOnline || !examId) return;
    const refreshPushes = async () => {
      try {
        setManualPushes(await api.getPushes());
      } catch {
        // Keep the last successful list while the app is temporarily offline.
      }
    };
    const timer = setInterval(refreshPushes, 60_000);
    return () => clearInterval(timer);
  }, [apiOnline, examId]);

  useEffect(() => {
    if (!apiOnline) return;
    const missing = savedWords
      .filter(
        (word) => !word.phonetic || word.phonetic === "/ pronunciation /",
      )
      .slice(0, 6);
    if (missing.length === 0) return;
    let active = true;
    Promise.all(
      missing.map(async (word) => {
        const result = await api
          .getPronunciation(
            word.word,
            learningSettings.pronunciationAccent,
            word.example ?? "",
          )
          .catch(() => null);
        if (!result?.phonetic) return null;
        const enriched: SavedWord = {
          ...word,
          phonetic: result.phonetic,
          translation: result.translation || word.translation,
          definition: result.definition || word.definition,
          partOfSpeech: result.partOfSpeech || word.partOfSpeech,
          example: result.example || word.example,
          exampleTranslation:
            result.exampleTranslation || word.exampleTranslation,
        };
        await api.saveWord(enriched).catch(() => enriched);
        return enriched;
      }),
    ).then((enriched) => {
      if (!active) return;
      const replacements = new Map(
        enriched
          .filter((word): word is SavedWord => Boolean(word))
          .map((word) => [`${word.examId}:${word.word}`, word]),
      );
      if (replacements.size === 0) return;
      setSavedWords((current) => {
        const next = current.map(
          (word) => replacements.get(`${word.examId}:${word.word}`) ?? word,
        );
        void storage.setWords(next);
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [apiOnline, learningSettings.pronunciationAccent, savedWords]);

  const updateLearningSettings = async (next: LearningSettings) => {
    const goalChanged = next.dailyGoal !== learningSettings.dailyGoal;
    setLearningSettings(next);
    void storage.setLearningSettings(next);
    if (apiOnline) {
      try {
        await api.updatePreferences({ learning: next });
        if (goalChanged) {
          const remoteDaily = await api.getDaily();
          setDaily(remoteDaily);
        }
      } catch (error) {
        setAppNotice({
          title: "设置已保存在本机",
          message: error instanceof Error ? error.message : "账号同步暂时失败",
        });
      }
    } else if (goalChanged && examId) {
      setDaily(
        getDailyArticles(
          examId,
          new Date(),
          [],
          next.dailyGoal,
          selectedInterests,
        ),
      );
    }
    const permissionRequested =
      next.dailyReminderEnabled &&
      (!learningSettings.dailyReminderEnabled ||
        next.reminderTime !== learningSettings.reminderTime);
    void syncDailyReminder(next, permissionRequested)
      .then((status) => {
        if (status === "unsupported" && permissionRequested) {
          setAppNotice({
            title: "提醒将在手机端生效",
            message: "Web 端不支持系统定时提醒，请在 iOS 或 Android 设备上开启。",
          });
        }
        if (status === "preview-unsupported" && permissionRequested) {
          setAppNotice({
            title: "Expo Go 暂不支持提醒",
            message: "正式安装版与开发构建中会正常启用 Android 每日提醒。",
          });
        }
        if (status === "denied" && permissionRequested) {
          const disabled = { ...next, dailyReminderEnabled: false };
          setLearningSettings(disabled);
          void storage.setLearningSettings(disabled);
          if (apiOnline) void api.updatePreferences({ learning: disabled });
          setAppNotice({
            title: "未获得通知权限",
            message: "请在系统设置中允许拾词发送通知后，再开启每日提醒。",
          });
        }
      })
      .catch((error) =>
        setAppNotice({
          title: "提醒设置失败",
          message: error instanceof Error ? error.message : "请稍后重试",
          tone: "error",
        }),
      );
  };

  const updateInterests = async (next: InterestId[]) => {
    if (next.length === 0) return;
    const previous = selectedInterests;
    setSelectedInterests(next);
    await storage.setInterests(next);
    if (!examId) return;
    if (!apiOnline) {
      setDaily(
        getDailyArticles(
          examId,
          new Date(),
          [],
          learningSettings.dailyGoal,
          next,
        ),
      );
      setInterestFeed(getInterestArticles(examId, next));
      return;
    }
    try {
      await api.updatePreferences({ interests: next });
      const [remoteDaily, remoteInterestFeed] = await Promise.all([
        api.getDaily(),
        api.getInterestFeed(),
      ]);
      setDaily(remoteDaily);
      setInterestFeed(remoteInterestFeed);
    } catch (error) {
      setSelectedInterests(previous);
      await storage.setInterests(previous);
      setAppNotice({
        title: "兴趣设置同步失败",
        message: error instanceof Error ? error.message : "请稍后重试",
        tone: "error",
      });
      throw error;
    }
  };

  const updateReaderPreferences = (next: ReaderSettings) => {
    setReaderPreferences(next);
    void storage.setReaderSettings(next);
    if (apiOnline) {
      void api.updatePreferences({ reader: next }).catch(() => undefined);
    }
  };

  const refreshInsights = async () => {
    if (!apiOnline) return;
    try {
      const [stats, remoteMistakes] = await Promise.all([
        api.getLearningStats(),
        api.getMistakes(),
      ]);
      setLearningStats(stats);
      setMistakes(remoteMistakes);
    } catch {
      // Keep the latest successful insight snapshot while temporarily offline.
    }
  };

  const applyRemoteSnapshot = async () => {
    const [
      remoteDaily,
      remoteHistory,
      remoteWords,
      pushes,
      preferences,
      stats,
      remoteMistakes,
      remoteInterestFeed,
    ] = await Promise.all([
      api.getDaily(),
      api.getHistory(),
      api.getVocabulary(),
      api.getPushes(),
      api.getPreferences(),
      api.getLearningStats(),
      api.getMistakes(),
      api.getInterestFeed(),
    ]);
    const completedIds = [
      ...new Set([
        ...remoteHistory.completedIds,
        ...pushes
          .filter((push) => push.completedAt)
          .map((push) => push.article.id),
      ]),
    ];
    setDaily(remoteDaily);
    setManualPushes(pushes);
    setHistory(remoteHistory.records);
    setCompleted(completedIds);
    setSavedWords(remoteWords);
    setLearningSettings(preferences.learning);
    setReaderPreferences(preferences.reader);
    setLearningStats(stats);
    setMistakes(remoteMistakes);
    setSelectedInterests(preferences.interests);
    setInterestFeed(remoteInterestFeed);
    void syncDailyReminder(preferences.learning).catch(() => undefined);
    await Promise.all([
      storage.setHistory(remoteHistory.records),
      storage.setCompleted(completedIds),
      storage.setWords(remoteWords),
      storage.setLearningSettings(preferences.learning),
      storage.setReaderSettings(preferences.reader),
      storage.setInterests(preferences.interests),
    ]);
  };

  const handleAuthenticated = async (
    session: UserProfile & { token: string },
    isNewAccount = false,
  ) => {
    await storage.setAuthToken(session.token);
    setCurrentUser(session);
    if (isNewAccount) {
      await Promise.all([
        storage.clearExam(),
        storage.setLearningSettings(DEFAULT_LEARNING_SETTINGS),
        storage.setInterests(defaultInterestIds),
      ]);
      setExamId(null);
      setLearningSettings(DEFAULT_LEARNING_SETTINGS);
      setSelectedInterests(defaultInterestIds);
      setInterestFeed([]);
      setApiOnline(true);
      setAuthRequired(false);
      return;
    }
    setExamId(session.examId);
    await storage.setExam(session.examId);
    await applyRemoteSnapshot();
    setApiOnline(true);
    setAuthRequired(false);
  };

  const completeOnboarding = async (
    nextExam: ExamId,
    dailyGoal: number,
    interests: InterestId[],
  ) => {
    const nextLearning = { ...learningSettings, dailyGoal };
    const updatedUser = await api.setExam(nextExam);
    await api.updatePreferences({ learning: nextLearning, interests });
    setCurrentUser(updatedUser);
    setExamId(nextExam);
    setLearningSettings(nextLearning);
    setSelectedInterests(interests);
    await Promise.all([
      storage.setExam(nextExam),
      storage.setLearningSettings(nextLearning),
      storage.setInterests(interests),
    ]);
    await applyRemoteSnapshot();
    setApiOnline(true);
    setTab("today");
  };

  const logout = async () => {
    api.clearAuthentication();
    await storage.clearAuthToken();
    setCurrentUser(null);
    setReader(null);
    setAccountMode(null);
    setAuthRequired(true);
  };

  const selectExam = async (nextExam: ExamId, navigateToToday = true) => {
    setExamId(nextExam);
    setCurrentUser((user) => (user ? { ...user, examId: nextExam } : user));
    await storage.setExam(nextExam);
    setDaily(
      getDailyArticles(nextExam, new Date(), [], learningSettings.dailyGoal, selectedInterests),
    );
    setInterestFeed(getInterestArticles(nextExam, selectedInterests));
    if (navigateToToday) setTab("today");
    try {
      const updatedUser = await api.setExam(nextExam);
      setCurrentUser(updatedUser);
      const [remoteDaily, remoteHistory, remoteWords, pushes, remoteInterestFeed] =
        await Promise.all([
          api.getDaily(),
          api.getHistory(),
          api.getVocabulary(),
          api.getPushes(),
          api.getInterestFeed(),
        ]);
      const completedIds = [
        ...new Set([
          ...remoteHistory.completedIds,
          ...pushes
            .filter((push) => push.completedAt)
            .map((push) => push.article.id),
        ]),
      ];
      setDaily(remoteDaily);
      setManualPushes(pushes);
      setHistory(remoteHistory.records);
      setCompleted(completedIds);
      setSavedWords(remoteWords);
      setInterestFeed(remoteInterestFeed);
      setApiOnline(true);
      await Promise.all([
        storage.setHistory(remoteHistory.records),
        storage.setCompleted(completedIds),
        storage.setWords(remoteWords),
      ]);
    } catch (error) {
      setApiOnline(false);
      setAppNotice({
        title: "正在使用离线内容",
        message:
          error instanceof Error ? error.message : "暂时无法连接服务器",
      });
    }
  };

  const toggleWord = async (word: WordInfo, article: Article) => {
    const existing = savedWords.some(
      (item) => item.examId === article.examId && item.word === word.word,
    );
    let enrichedWord = word;
    if (!word.phonetic || word.phonetic === "/ pronunciation /") {
      try {
        const pronunciation = await api.getPronunciation(
          word.word,
          learningSettings.pronunciationAccent,
        );
        if (pronunciation.phonetic) {
          enrichedWord = { ...word, phonetic: pronunciation.phonetic };
        }
      } catch {
        // Saving a word should still work when pronunciation lookup is offline.
      }
    }
    const savedWord: SavedWord = {
      ...enrichedWord,
      examId: article.examId,
      articleId: article.id,
      articleTitle: article.title,
      savedAt: new Date().toISOString(),
      memoryStage: 0,
      nextReviewAt: new Date().toISOString(),
      lastReviewedAt: null,
      reviewCount: 0,
      lapseCount: 0,
    };
    const next = existing
      ? savedWords.filter(
          (item) =>
            !(item.examId === article.examId && item.word === word.word),
        )
      : [savedWord, ...savedWords];
    setSavedWords(next);
    await storage.setWords(next);
    if (apiOnline) {
      try {
        if (existing) {
          await api.removeWord(savedWord);
        } else {
          await api.saveWord(savedWord);
        }
      } catch (error) {
        setSavedWords(savedWords);
        await storage.setWords(savedWords);
        setAppNotice({
          title: "生词同步失败",
          message: error instanceof Error ? error.message : "请稍后再试",
          tone: "error",
        });
      }
    }
  };

  const removeWord = async (word: SavedWord) => {
    const next = savedWords.filter(
      (item) => !(item.examId === word.examId && item.word === word.word),
    );
    setSavedWords(next);
    await storage.setWords(next);
    if (apiOnline) {
      try {
        await api.removeWord(word);
      } catch (error) {
        setSavedWords(savedWords);
        await storage.setWords(savedWords);
        setAppNotice({
          title: "移除失败",
          message: error instanceof Error ? error.message : "请稍后再试",
          tone: "error",
        });
      }
    }
  };

  const reviewWord = async (word: SavedWord, rating: MemoryRating) => {
    const schedule = scheduleMemoryReview(word.memoryStage ?? 0, rating);
    const optimistic: SavedWord = {
      ...word,
      ...schedule,
      reviewCount: (word.reviewCount ?? 0) + 1,
      lapseCount: (word.lapseCount ?? 0) + (rating === "again" ? 1 : 0),
    };
    const replaceWord = (items: SavedWord[], replacement: SavedWord) =>
      items.map((item) =>
        item.examId === word.examId && item.word === word.word
          ? replacement
          : item,
      );
    const optimisticWords = replaceWord(savedWords, optimistic);
    setSavedWords(optimisticWords);
    await storage.setWords(optimisticWords);

    if (!apiOnline) return optimistic;
    try {
      const synced = await api.reviewWord(word, rating);
      const syncedWords = replaceWord(optimisticWords, synced);
      setSavedWords(syncedWords);
      await storage.setWords(syncedWords);
      return synced;
    } catch (error) {
      setSavedWords(savedWords);
      await storage.setWords(savedWords);
      setAppNotice({
        title: "复习记录同步失败",
        message: error instanceof Error ? error.message : "请稍后再试",
        tone: "error",
      });
      throw error;
    }
  };

  const submitArticle = async (article: Article, answers: number[]) => {
    let results: AnswerResult[];
    if (apiOnline) {
      const response = await api.completeArticle(article.id, answers);
      results = response.results;
    } else {
      const localArticle =
        articles.find((item) => item.id === article.id) ?? article;
      results = localArticle.questions.map((question, index) => ({
        questionId: index,
        selectedAnswer: answers[index],
        correctAnswer: question.answer,
        correct: answers[index] === question.answer,
        explanation: question.explanation,
      }));
    }
    const next = completed.includes(article.id)
      ? completed
      : [...completed, article.id];
    setCompleted(next);
    await storage.setCompleted(next);
    if (apiOnline) {
      const [remoteHistory, pushes, stats, remoteMistakes] = await Promise.all([
        api.getHistory(),
        api.getPushes(),
        api.getLearningStats(),
        api.getMistakes(),
      ]);
      const completedIds = [
        ...new Set([...remoteHistory.completedIds, article.id]),
      ];
      setHistory(remoteHistory.records);
      setManualPushes(pushes);
      setCompleted(completedIds);
      setLearningStats(stats);
      setMistakes(remoteMistakes);
      await Promise.all([
        storage.setHistory(remoteHistory.records),
        storage.setCompleted(completedIds),
      ]);
    }
    return results;
  };

  const openHistoryArticle = async (articleId: string, retry = false) => {
    setReaderPracticeMode(retry);
    const defaultQueue = history.flatMap((record) => record.articleIds);
    const queue = defaultQueue.includes(articleId) ? defaultQueue : [articleId];
    const cached = daily.find((item) => item.id === articleId);
    if (cached) {
      setReaderQueue(queue);
      setReader(cached);
      return;
    }
    try {
      const loaded = apiOnline
        ? await api.getArticle(articleId)
        : (articles.find((item) => item.id === articleId) ?? null);
      if (loaded) {
        setReaderQueue(queue);
        setReader(loaded);
      }
    } catch (error) {
      setAppNotice({
        title: "文章加载失败",
        message: error instanceof Error ? error.message : "请稍后再试",
        tone: "error",
      });
    }
  };

  const openDailyArticle = (article: Article) => {
    setReaderPracticeMode(false);
    setReaderQueue(daily.map((item) => item.id));
    setReader(article);
  };

  const openInterestArticle = (article: Article) => {
    setReaderPracticeMode(false);
    setReaderQueue(interestFeed.map((item) => item.id));
    setReader(article);
  };

  const openPushedArticle = async (articleId: string) => {
    setReaderPracticeMode(false);
    const queue = manualPushes.map((push) => push.article.id);
    try {
      const loaded =
        daily.find((item) => item.id === articleId) ??
        (apiOnline
          ? await api.getArticle(articleId)
          : (articles.find((item) => item.id === articleId) ?? null));
      if (loaded) {
        setReaderQueue(queue);
        setReader(loaded);
      }
    } catch (error) {
      setAppNotice({
        title: "文章加载失败",
        message: error instanceof Error ? error.message : "请稍后再试",
        tone: "error",
      });
    }
  };

  const openWordSourceArticle = async (articleId: string, sourceExam: ExamId) => {
    setReaderPracticeMode(false);
    const queue = [
      ...new Set(
        savedWords
          .filter((word) => word.examId === sourceExam)
          .map((word) => word.articleId),
      ),
    ];
    try {
      const loaded =
        daily.find((item) => item.id === articleId) ??
        (apiOnline
          ? await api.getArticle(articleId)
          : (articles.find((item) => item.id === articleId) ?? null));
      if (loaded) {
        setReaderQueue(queue.length ? queue : [articleId]);
        setReader(loaded);
      }
    } catch (error) {
      setAppNotice({
        title: "原文加载失败",
        message: error instanceof Error ? error.message : "请稍后再试",
        tone: "error",
      });
    }
  };

  const readerIndex = reader ? readerQueue.indexOf(reader.id) : -1;
  const navigateReader = async (offset: -1 | 1) => {
    if (!reader || readerNavigating || readerIndex < 0) return;
    const targetId = readerQueue[readerIndex + offset];
    if (!targetId) return;
    setReaderNavigating(true);
    setReaderPracticeMode(false);
    try {
      const loaded =
        daily.find((item) => item.id === targetId) ??
        (apiOnline
          ? await api.getArticle(targetId)
          : (articles.find((item) => item.id === targetId) ?? null));
      if (loaded) setReader(loaded);
    } catch (error) {
      setAppNotice({
        title: "文章切换失败",
        message: error instanceof Error ? error.message : "请稍后再试",
        tone: "error",
      });
    } finally {
      setReaderNavigating(false);
    }
  };

  if (loading)
    return (
      <View style={styles.loading}>
        <AppLogo />
        <ActivityIndicator
          color={colors.primary}
          style={{ marginTop: spacing.xl }}
        />
      </View>
    );
  if (authRequired || !currentUser?.isRegistered)
    return (
      <SafeAreaView style={styles.authGateSafe}>
        <ExpoStatusBar style="dark" />
        <View style={styles.authGateBackground}>
          <AppLogo />
          <View style={styles.authGateCopy}>
            <Text style={styles.authGateEyebrow}>READ · REMEMBER · GROW</Text>
            <Text style={styles.authGateTitle}>登录后，开始你的{`\n`}每日英语阅读</Text>
            <Text style={styles.authGateText}>
              阅读历史、生词和记忆进度会安全保存在你的账号中。
            </Text>
          </View>
        </View>
        <AccountSheet
          user={null}
          deviceId={currentDeviceId}
          initialMode="login"
          dismissible={false}
          onClose={() => {}}
          onAuthenticated={handleAuthenticated}
          onProfileUpdated={() => {}}
          onLogout={() => {}}
        />
      </SafeAreaView>
    );
  if (!examId) return <Onboarding onComplete={completeOnboarding} />;
  if (reader)
    return (
      <>
        <ReaderScreen
          key={reader.id}
          userId={currentUser.id}
          article={reader}
          savedWords={savedWords}
          completed={completed.includes(reader.id)}
          pronunciationAccent={learningSettings.pronunciationAccent}
          sequencePosition={Math.max(1, readerIndex + 1)}
          sequenceTotal={Math.max(1, readerQueue.length)}
          navigatingArticle={readerNavigating}
          initialReaderSettings={readerPreferences}
          practiceMode={readerPracticeMode}
          onPreviousArticle={readerIndex > 0 ? () => void navigateReader(-1) : undefined}
          onNextArticle={
            readerIndex >= 0 && readerIndex < readerQueue.length - 1
              ? () => void navigateReader(1)
              : undefined
          }
          onBack={() => {
            setReader(null);
            void refreshInsights();
          }}
          onToggleWord={toggleWord}
          onSubmit={submitArticle}
          onChangeReaderSettings={updateReaderPreferences}
        />
        <NativeNoticeModal
          notice={appNotice}
          onClose={() => setAppNotice(null)}
        />
      </>
    );

  const content =
    tab === "today" ? (
      <TodayScreen
        examId={examId}
        daily={daily}
        interestFeed={interestFeed}
        selectedInterests={selectedInterests}
        dailyGoal={learningSettings.dailyGoal}
        streakDays={learningStats.streakDays}
        manualPushes={manualPushes}
        completed={completed}
        onOpen={openDailyArticle}
        onOpenInterest={openInterestArticle}
        onOpenPush={openPushedArticle}
        onNavigate={setTab}
      />
    ) : tab === "history" ? (
      <HistoryScreen
        history={history}
        mistakes={mistakes}
        stats={learningStats}
        onOpen={openHistoryArticle}
      />
    ) : tab === "words" ? (
      <WordsScreen
        words={savedWords}
        activeExam={examId}
        pronunciationAccent={learningSettings.pronunciationAccent}
        onRemove={removeWord}
        onReview={reviewWord}
        onOpenSource={(articleId, sourceExam) =>
          void openWordSourceArticle(articleId, sourceExam)
        }
      />
    ) : (
      <ProfileScreen
        examId={examId}
        settings={learningSettings}
        selectedInterests={selectedInterests}
        user={currentUser}
        onChangeExam={(id) => void selectExam(id, false)}
        onChangeSettings={updateLearningSettings}
        onChangeInterests={updateInterests}
        onOpenAccount={() =>
          setAccountMode(currentUser?.isRegistered ? "profile" : "login")
        }
      />
    );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.appShell}>
        {tablet && <Navigation active={tab} tablet onChange={setTab} />}
        <View
          style={[
            styles.mainContent,
            !tablet && { paddingBottom: MOBILE_NAV_HEIGHT + bottomInset },
            tablet && styles.mainContentTablet,
          ]}
        >
          <PageTransition transitionKey={tab}>{content}</PageTransition>
        </View>
        {!tablet && (
          <Navigation
            active={tab}
            tablet={false}
            bottomInset={bottomInset}
            onChange={setTab}
          />
        )}
      </View>
      <NativeNoticeModal
        notice={appNotice}
        onClose={() => setAppNotice(null)}
      />
      {accountMode && (
        <AccountSheet
          key={accountMode}
          user={currentUser}
          deviceId={currentDeviceId}
          initialMode={accountMode}
          onClose={() => setAccountMode(null)}
          onAuthenticated={handleAuthenticated}
          onProfileUpdated={setCurrentUser}
          onLogout={() => void logout()}
        />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  authGateSafe: { flex: 1, backgroundColor: colors.background },
  authGateBackground: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 26,
    paddingBottom: 48,
    justifyContent: "space-between",
  },
  authGateCopy: { maxWidth: 520, marginBottom: 36 },
  authGateEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  authGateTitle: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 46,
    fontWeight: "800",
    marginTop: 14,
  },
  authGateText: {
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 23,
    marginTop: 14,
    maxWidth: 420,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  readerSafe: {
    flex: 1,
    backgroundColor: "#F3F1EA",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.82 },
  cardPressed: { transform: [{ scale: 0.992 }], opacity: 0.92 },
  appShell: { flex: 1, flexDirection: "row" },
  mainContent: { flex: 1 },
  mainContentTablet: { paddingBottom: 0 },
  screen: { flex: 1 },
  screenContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    width: "100%",
    maxWidth: 1050,
    alignSelf: "center",
  },
  nativeModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  nativeModalRootDesktop: {
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  nativeModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20,30,27,0.48)",
  },
  nativeSheet: {
    width: "100%",
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 30 : 20,
  },
  nativeSheetDesktop: {
    maxWidth: 480,
    borderRadius: 24,
    padding: 22,
    ...shadows.card,
  },
  nativeSheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#D7DCDA",
    alignSelf: "center",
    marginBottom: 13,
  },
  nativeSheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 16,
  },
  nativeSheetTitle: { color: colors.ink, fontSize: 21, fontWeight: "800" },
  nativeSheetSubtitle: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 5,
  },
  nativeSheetClose: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  nativeChoiceList: { gap: 8 },
  nativeChoiceItem: {
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 15,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  nativeChoiceItemSelected: {
    borderColor: colors.primary,
    backgroundColor: "#F2F8F6",
  },
  nativeChoiceItemPressed: { opacity: 0.88, transform: [{ scale: 0.995 }] },
  nativeChoiceLabel: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  nativeChoiceLabelSelected: { color: colors.primaryDark, fontWeight: "800" },
  nativeChoiceDescription: {
    color: colors.inkMuted,
    fontSize: 11,
    marginTop: 3,
  },
  nativeChoiceCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#C7CECB",
    alignItems: "center",
    justifyContent: "center",
  },
  nativeChoiceCheckSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  interestPickerGrid: { gap: 10 },
  interestPickerItem: {
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  interestPickerItemActive: {
    borderColor: colors.primary,
    backgroundColor: "#F2F8F6",
  },
  interestPickerEmoji: { fontSize: 24 },
  interestPickerTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  interestPickerSubtitle: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  interestPickerError: {
    color: colors.danger,
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },
  goalStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  goalStepButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  goalInputWrap: {
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    backgroundColor: "#F2F8F6",
    alignItems: "center",
    justifyContent: "center",
  },
  goalInput: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 20,
    borderWidth: 0,
    outlineWidth: 0,
    backgroundColor: "transparent",
    color: colors.primaryDark,
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
  },
  goalInputUnit: {
    position: "absolute",
    bottom: 10,
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  goalRangeHint: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 10,
  },
  goalRangeError: { color: colors.danger },
  goalSaveButton: {
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  goalSaveText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  nativeNoticeSheet: {
    width: "100%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 30 : 22,
    alignItems: "center",
  },
  nativeNoticeSheetDesktop: {
    maxWidth: 410,
    borderRadius: 24,
    padding: 24,
    ...shadows.card,
  },
  nativeNoticeIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
    marginTop: 5,
  },
  nativeNoticeIconError: { backgroundColor: "#FFF1EE" },
  nativeNoticeTitle: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 15,
  },
  nativeNoticeText: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  nativeNoticeActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  nativeNoticeSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
  },
  nativeNoticeSecondaryText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  nativeNoticePrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  nativeNoticePrimaryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  accountSheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    ...shadows.card,
  },
  accountModalRoot: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  accountSheetDesktop: {
    width: 520,
    maxHeight: "88%",
    borderRadius: 24,
    padding: 24,
  },
  accountModeTabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 3,
    marginBottom: 16,
  },
  accountModeTab: {
    flex: 1,
    height: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  accountModeTabActive: { backgroundColor: colors.surface, ...shadows.card },
  accountModeText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  accountModeTextActive: { color: colors.ink, fontWeight: "800" },
  accountForm: { paddingBottom: 12 },
  accountField: { marginBottom: 14 },
  accountFieldLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 7,
  },
  accountInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#FAFBFA",
    color: colors.ink,
    fontSize: 14,
    paddingHorizontal: 14,
  },
  accountError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 10,
  },
  accountSuccess: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 10,
    fontWeight: "700",
  },
  accountPrimaryButton: {
    height: 50,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  accountPrimaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  passwordSection: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 24,
    paddingTop: 20,
  },
  passwordSectionTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  passwordSectionHint: {
    color: colors.inkMuted,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 16,
  },
  accountSecondaryButton: {
    height: 48,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  accountSecondaryText: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  accountSwitchButton: {
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  accountSwitchText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  accountLogoutButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  accountLogoutText: { color: colors.danger, fontSize: 13, fontWeight: "700" },

  logoRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  logoName: {
    fontSize: 19,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: 1,
  },
  logoEnglish: {
    fontSize: 8,
    fontWeight: "700",
    color: colors.inkMuted,
    letterSpacing: 1.5,
    marginTop: 1,
  },
  onboarding: { flexGrow: 1, padding: 24, gap: 32 },
  onboardingTablet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
    gap: 72,
  },
  onboardingIntro: { flex: 1, maxWidth: 560 },
  onboardingIntroTablet: { minHeight: 570, justifyContent: "space-between" },
  onboardingCopy: { marginTop: 50 },
  pillSoft: {
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillSoftText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  heroTitle: {
    marginTop: 20,
    color: colors.ink,
    fontSize: 37,
    lineHeight: 50,
    fontWeight: "800",
    letterSpacing: -1,
  },
  heroTitleTablet: { fontSize: 48, lineHeight: 64 },
  heroBody: {
    marginTop: 18,
    color: colors.inkMuted,
    fontSize: 16,
    lineHeight: 28,
    maxWidth: 500,
  },
  onboardingFeatures: {
    marginTop: 36,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  featureText: { fontSize: 13, fontWeight: "600", color: colors.inkMuted },
  examPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    ...shadows.card,
  },
  examPanelTablet: { flex: 1, maxWidth: 510, padding: 32 },
  stepLabel: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  panelTitle: {
    fontSize: 24,
    color: colors.ink,
    fontWeight: "800",
    marginTop: 10,
  },
  panelHint: { color: colors.inkMuted, fontSize: 13, marginTop: 6 },
  examGrid: { gap: 10, marginTop: 22 },
  examOption: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  examOptionActive: { borderColor: colors.primary, backgroundColor: "#F5FAF8" },
  examIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  examName: { color: colors.ink, fontWeight: "700", fontSize: 15 },
  examSubtitle: { color: colors.inkMuted, fontSize: 12, marginTop: 3 },
  radio: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: "#B7BDBA",
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  onboardingGoalSection: {
    marginTop: 22,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  onboardingGoalCopy: { flex: 1 },
  onboardingGoalTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 7,
  },
  onboardingGoalStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  onboardingGoalButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  onboardingGoalValue: {
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  onboardingGoalNumber: {
    color: colors.primaryDark,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
  onboardingGoalUnit: {
    color: colors.inkMuted,
    fontSize: 9,
    fontWeight: "700",
  },
  onboardingInterestSection: {
    marginTop: 22,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  interestChipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  interestChoice: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  interestChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  interestChoiceEmoji: { fontSize: 16 },
  interestChoiceText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  interestChoiceTextActive: { color: colors.primaryDark, fontWeight: "800" },
  onboardingError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 14,
  },
  primaryButton: {
    height: 54,
    marginTop: 22,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonPressed: { backgroundColor: colors.primaryDark },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  privacyNote: {
    textAlign: "center",
    marginTop: 13,
    fontSize: 11,
    color: colors.inkMuted,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerEyebrow: {
    fontSize: 11,
    color: colors.inkMuted,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: colors.ink,
  },
  avatar: {
    width: 40,
    height: 40,
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  goalCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: 20,
  },
  goalTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  goalEyebrow: {
    color: "#BFD8D2",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  goalTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 6 },
  streakPill: {
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  streakText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  progressTrack: {
    height: 7,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    overflow: "hidden",
    marginTop: 20,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#F0BC68",
    borderRadius: radius.pill,
  },
  goalBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  goalProgress: { color: "#fff", fontSize: 12, fontWeight: "700" },
  goalExam: { color: "#C7DCD7", fontSize: 12 },
  sectionHeading: {
    marginTop: 28,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: { color: colors.ink, fontWeight: "800", fontSize: 20 },
  sectionSubtitle: { color: colors.inkMuted, fontSize: 12, marginTop: 4 },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  countPillText: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  articleList: { gap: 12 },
  interestExploreSection: { marginTop: 2 },
  interestSparkBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#FFF2DA",
  },
  interestSparkText: { color: "#9B681B", fontSize: 10, fontWeight: "800" },
  interestFilterRow: { gap: 8, paddingRight: 12, marginBottom: 12 },
  interestFilterChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  interestFilterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  interestFilterEmoji: { fontSize: 14 },
  interestFilterText: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  interestFilterTextActive: { color: colors.primaryDark, fontWeight: "800" },
  interestArticleGrid: { gap: 10 },
  interestArticleCard: {
    minHeight: 104,
    flexDirection: "row",
    padding: 12,
    gap: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  interestArticleVisual: {
    width: 72,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  interestArticleEmoji: { fontSize: 30 },
  interestArticleBody: { flex: 1, paddingVertical: 2 },
  interestArticleCategory: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  interestArticleTitle: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    marginTop: 7,
  },
  interestArticleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: "auto",
    paddingTop: 9,
  },
  interestArticleDot: { color: colors.inkMuted, fontSize: 11 },
  interestArticleChevron: { marginLeft: "auto" },
  articleCard: {
    flexDirection: "row",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 14,
    ...shadows.card,
  },
  articleNumber: {
    width: 66,
    minHeight: 118,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  articleNumberText: { fontSize: 23, fontWeight: "800", color: colors.ink },
  completedBadge: {
    position: "absolute",
    right: -5,
    top: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "#fff",
  },
  articleContent: { flex: 1, paddingVertical: 2 },
  articleMetaTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 5,
  },
  articleEyebrow: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  articleYear: { fontSize: 10, color: colors.inkMuted },
  articleTitle: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    marginTop: 10,
  },
  articleMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 14,
    gap: 12,
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { color: colors.inkMuted, fontSize: 11 },
  difficulty: { flexDirection: "row", gap: 3 },
  difficultyDot: {
    width: 4,
    height: 8,
    borderRadius: 2,
    backgroundColor: "#D8DAD6",
  },
  difficultyDotActive: { backgroundColor: colors.accent },
  readButton: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  readButtonText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  historyShortcut: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  manualPushCard: {
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 15,
    borderWidth: 1,
    borderColor: "#E8D4AF",
    borderRadius: radius.lg,
    backgroundColor: "#FFF9ED",
  },
  manualPushIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0D5",
    position: "relative",
  },
  manualPushLabel: {
    color: "#A16918",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  manualPushTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 5,
  },
  manualPushMessage: {
    color: colors.inkMuted,
    fontSize: 10,
    marginTop: 4,
  },
  shortcutIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  shortcutTitle: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  shortcutText: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },

  readerTopbar: {
    height: 62,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9F8F3",
  },
  readerTabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    padding: 3,
    borderRadius: 12,
    position: "relative",
    overflow: "hidden",
  },
  readerTabIndicator: {
    position: "absolute",
    left: 3,
    top: 3,
    bottom: 3,
    width: 68,
    borderRadius: 9,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  readerTab: {
    width: 68,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    zIndex: 1,
  },
  readerTabPressed: { opacity: 0.7 },
  readerTabActive: { backgroundColor: colors.surface },
  readerTabText: { color: colors.inkMuted, fontSize: 12, fontWeight: "600" },
  readerTabTextActive: { color: colors.ink, fontWeight: "800" },
  fontButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fontButtonActive: { backgroundColor: colors.primarySoft },
  fontButtonText: { color: colors.ink, fontWeight: "800", fontSize: 16 },
  readingProgressTrack: {
    height: 3,
    backgroundColor: "rgba(30,98,88,0.08)",
    overflow: "hidden",
  },
  readingProgressFill: {
    height: "100%",
    backgroundColor: colors.primary,
  },
  articleTimerBar: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#EEF7F4",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#D6E9E3",
  },
  articleTimerBarUrgent: {
    backgroundColor: "#102B38",
    borderBottomColor: "#1D5268",
  },
  articleTimerBarExpired: {
    backgroundColor: "#3A1720",
    borderBottomColor: "#702A38",
  },
  articleTimerIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(30,98,88,0.1)",
  },
  articleTimerCopy: { flex: 1 },
  articleTimerLabel: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  articleTimerHint: { color: colors.inkMuted, fontSize: 9, marginTop: 2 },
  articleTimerValue: {
    color: colors.primaryDark,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 1.3,
    fontVariant: ["tabular-nums"],
  },
  articleTimerTextUrgent: { color: "#D8F7FF" },
  readerSequenceBar: {
    position: "absolute",
    bottom: 8,
    zIndex: 12,
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadows.card,
  },
  readerSequenceButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  readerSequenceButtonNext: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  readerSequenceDisabled: { opacity: 0.35 },
  readerSequenceButtonText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  readerSequenceButtonTextNext: { color: "#fff", fontSize: 12, fontWeight: "800" },
  readerSequencePosition: {
    width: 68,
    alignItems: "center",
    justifyContent: "center",
  },
  readerSequenceCount: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  readerSequenceHint: { color: colors.inkMuted, fontSize: 9, marginTop: 2 },
  readerScroll: {
    alignItems: "center",
    paddingVertical: 30,
    paddingBottom: 36,
  },
  readerScrollMobile: { paddingVertical: 14, paddingBottom: 24 },
  readerScrollWithFloatingNavigation: { paddingBottom: 104 },
  readerPaper: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 24,
    paddingVertical: 30,
    ...shadows.card,
  },
  readerPaperMobile: {
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 30,
  },
  readerHeading: {
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  readerEyebrow: {
    color: colors.primary,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "800",
  },
  readerTitle: {
    color: colors.ink,
    fontSize: 30,
    lineHeight: 39,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginTop: 10,
  },
  readerTitleMobile: { fontSize: 27, lineHeight: 35 },
  readerMeta: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  readerMetaText: { fontSize: 11, color: colors.inkMuted },
  articleNarrationCard: {
    marginTop: 18,
    padding: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D9E5E1",
    backgroundColor: "#F5F9F7",
  },
  articleNarrationTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  articleNarrationIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  articleNarrationIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E2EFEA",
  },
  articleNarrationTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  articleNarrationMessage: {
    color: colors.inkMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  articleNarrationError: { color: colors.danger },
  articleNarrationActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  articleNarrationRestart: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  articleNarrationPlay: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  articleNarrationPlayActive: { backgroundColor: colors.accent },
  articleNarrationProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 11,
  },
  articleNarrationTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#DDE7E3",
  },
  articleNarrationTrackFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  articleNarrationTime: {
    minWidth: 31,
    color: colors.inkMuted,
    fontSize: 9,
    fontVariant: ["tabular-nums"],
  },
  articleNarrationControls: { marginTop: 12, gap: 10 },
  articleNarrationChoiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  articleNarrationChoice: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  articleNarrationChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: "#E1EFEA",
  },
  articleNarrationChoiceText: {
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  articleNarrationChoiceTextActive: { color: colors.primary },
  articleNarrationSpeedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  articleNarrationSpeedLabel: {
    color: colors.inkMuted,
    fontSize: 10,
    marginRight: 2,
  },
  articleNarrationSpeed: {
    minWidth: 38,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  articleNarrationSpeedActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  articleNarrationSpeedText: {
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  articleNarrationSpeedTextActive: { color: "#fff" },
  metaDivider: {
    height: 12,
    width: 1,
    backgroundColor: colors.line,
    marginHorizontal: 10,
  },
  longPressHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#F4F7F5",
    borderRadius: radius.sm,
    padding: 11,
    marginTop: 20,
    marginBottom: 4,
  },
  hintHand: {
    width: 26,
    height: 26,
    backgroundColor: colors.surface,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  longPressHintText: { fontSize: 11, color: colors.inkMuted, flex: 1 },
  hintClose: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  paragraph: {
    color: "#26332F",
    marginTop: 24,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
  },
  articleTranslationView: { paddingTop: 2 },
  translationStateCard: {
    minHeight: 250,
    marginTop: 20,
    padding: 24,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#D9E8E3",
    backgroundColor: "#F4F8F6",
    alignItems: "center",
    justifyContent: "center",
  },
  translationStateIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  translationStateIconError: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#FFF0ED",
    alignItems: "center",
    justifyContent: "center",
  },
  translationStateTitle: {
    marginTop: 14,
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  translationStateText: {
    maxWidth: 360,
    marginTop: 8,
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
  },
  translationRetryButton: {
    minHeight: 42,
    marginTop: 18,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  translationRetryText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  translationNoticeCard: {
    marginTop: 20,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D2E5DF",
    backgroundColor: "#EAF4F1",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  translationNoticeIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  translationNoticeTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
  },
  translationNoticeText: {
    marginTop: 4,
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 18,
  },
  translatedParagraphBlock: {
    marginTop: 25,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  translatedParagraphNumber: {
    width: 26,
    marginTop: 5,
    color: colors.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  translatedParagraph: {
    flex: 1,
    color: "#26332F",
    fontFamily: Platform.select({
      ios: "PingFang SC",
      android: "sans-serif",
      default: "system-ui",
    }),
  },
  translationFooter: {
    marginTop: 30,
    marginBottom: 10,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    alignItems: "center",
  },
  translationFooterText: {
    color: colors.inkMuted,
    fontSize: 10,
    lineHeight: 17,
    textAlign: "center",
  },
  translationOriginalButton: {
    minHeight: 42,
    marginTop: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C9DDD7",
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  translationOriginalButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  interactiveWord: {},
  webInteractiveWord: {
    cursor: "pointer",
    userSelect: "none",
  },
  markedWord: { backgroundColor: colors.highlight, color: "#4B3A13" },
  pressedWord: {
    backgroundColor: "#D9EEE8",
    color: colors.primary,
  },
  selectedInlineWord: {
    backgroundColor: "#C7E4DC",
    color: colors.primary,
  },
  interestActivityCard: {
    marginTop: 28,
    padding: 15,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#E6D8BC",
    backgroundColor: "#FFF8E9",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  interestActivityIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0CF",
  },
  interestActivityEmoji: { fontSize: 19 },
  interestActivityLabel: {
    color: "#9B681B",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  interestActivityText: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 5,
  },
  practiceHeader: {
    marginTop: 38,
    paddingTop: 26,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  practiceEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  practiceTitle: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "800",
    marginTop: 7,
  },
  practiceHint: { color: colors.inkMuted, fontSize: 11, marginTop: 6 },
  answerCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: 52,
    marginTop: 32,
  },
  answerCtaDisabled: { backgroundColor: "#AAB5B1" },
  answerCtaText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  retryArticleButton: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    marginTop: 4,
  },
  retryArticleButtonText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  questions: { marginTop: 22, gap: 18 },
  answerIntro: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  answerIntroIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  answerIntroTitle: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  answerIntroText: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  questionCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  questionNumber: {
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 1,
    fontSize: 10,
  },
  questionPrompt: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    marginTop: 8,
  },
  options: { gap: 8, marginTop: 15 },
  option: {
    minHeight: 48,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  optionCorrect: { backgroundColor: "#EFF8F4", borderColor: "#8CBAB0" },
  optionSelected: { backgroundColor: "#F1F7F5", borderColor: colors.primary },
  optionWrong: { backgroundColor: "#FFF3F0", borderColor: "#E8A99D" },
  optionLetter: {
    width: 27,
    height: 27,
    borderRadius: 9,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLetterCorrect: { backgroundColor: colors.primary },
  optionLetterSelected: { backgroundColor: colors.primary },
  optionLetterWrong: { backgroundColor: colors.danger },
  optionLetterText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  optionLetterTextCorrect: { color: "#fff" },
  optionLetterTextSelected: { color: "#fff" },
  optionText: { color: colors.ink, fontSize: 13, flex: 1 },
  optionTextCorrect: { color: colors.primaryDark, fontWeight: "700" },
  optionTextSelected: { color: colors.primaryDark, fontWeight: "700" },
  optionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#B7BDBA",
    alignItems: "center",
    justifyContent: "center",
  },
  optionRadioSelected: { borderColor: colors.primary },
  optionRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  explanation: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  explanationLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.accent,
    letterSpacing: 1,
  },
  explanationText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 5,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(20,30,27,0.38)" },
  popoverBackdrop: { backgroundColor: "rgba(20,30,27,0.16)" },
  wordSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 36 : 22,
  },
  wordPopover: {
    position: "absolute",
    maxHeight: 520,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 22,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D6D9D6",
    alignSelf: "center",
    marginBottom: 18,
  },
  wordTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  wordTitle: { color: colors.ink, fontSize: 30, fontWeight: "800" },
  phonetic: { color: colors.primary, fontSize: 14, marginTop: 4 },
  wordActions: { flexDirection: "row", gap: 8 },
  wordDetailsScroll: {
    flexShrink: 1,
  },
  wordAudioButton: {
    minWidth: 86,
    height: 44,
    paddingHorizontal: 11,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: "#CFE3DD",
  },
  wordAudioButtonPlaying: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  wordAudioButtonError: {
    backgroundColor: "#FFF3F0",
    borderColor: "#F0C6BD",
  },
  wordAudioIcon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  wordAudioPulse: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  wordAudioText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  wordAudioTextPlaying: { color: "#fff" },
  wordAudioTextError: { color: colors.danger },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  translationRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 18,
    paddingVertical: 17,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  translationLabel: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  translation: { color: colors.ink, fontSize: 16, fontWeight: "600", flex: 1 },
  translationContent: { flex: 1, gap: 7 },
  partOfSpeech: {
    alignSelf: "flex-start",
    color: colors.primary,
    backgroundColor: "#E9F4F1",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "700",
  },
  englishDefinition: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  exampleCard: {
    marginTop: 14,
    backgroundColor: "#F4F7F5",
    borderRadius: radius.md,
    padding: 15,
  },
  exampleLabel: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  exampleEnglish: { color: colors.ink, fontSize: 14, lineHeight: 22 },
  exampleChinese: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 6,
  },
  wordCardExample: {
    backgroundColor: "#F4F7F5",
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 10,
  },
  wordCardExampleEnglish: { color: colors.ink, fontSize: 12, lineHeight: 19 },
  wordCardExampleChinese: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 4,
  },
  saveWordButton: {
    height: 52,
    borderRadius: radius.md,
    marginTop: 18,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  removeWordButton: {
    backgroundColor: "#FFF4F1",
    borderWidth: 1,
    borderColor: "#F2C8C0",
  },
  saveWordText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  removeWordText: { color: colors.danger },
  readerSettingsPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "92%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  readerSettingsPanelDesktop: {
    left: "50%",
    right: undefined,
    width: 600,
    marginLeft: -300,
    bottom: 28,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  readerSettingsContent: { padding: 22, paddingBottom: 28 },
  readerSettingsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  },
  readerSettingsTitle: { color: colors.ink, fontSize: 22, fontWeight: "800" },
  readerSettingsSubtitle: { color: colors.inkMuted, fontSize: 12, marginTop: 5 },
  timerSettingCard: {
    borderRadius: radius.lg,
    padding: 16,
    backgroundColor: "#0B1822",
    borderWidth: 1,
    borderColor: "#1A4D61",
    overflow: "hidden",
  },
  timerSettingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  timerSettingHeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timerSettingIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#123040",
    borderWidth: 1,
    borderColor: "#245C72",
  },
  timerSettingTitle: { color: "#F2FCFF", fontSize: 15, fontWeight: "900" },
  timerSettingSubtitle: { color: "#7DA7B6", fontSize: 10, marginTop: 3 },
  timerDurationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },
  timerInputWrap: {
    flex: 1,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    backgroundColor: "#081018",
    borderWidth: 1,
    borderColor: "#285166",
  },
  timerMinutesInput: {
    flex: 1,
    color: "#BDEEFF",
    fontSize: 21,
    fontWeight: "900",
    paddingVertical: 0,
  },
  timerMinutesUnit: { color: "#6F9AAA", fontSize: 11, fontWeight: "700" },
  timerResetButton: {
    height: 48,
    paddingHorizontal: 13,
    borderRadius: radius.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#123040",
    borderWidth: 1,
    borderColor: "#285166",
  },
  timerResetText: { color: "#BDEEFF", fontSize: 11, fontWeight: "800" },
  timerPresetRow: { flexDirection: "row", gap: 7, marginTop: 9 },
  timerPreset: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111F29",
    borderWidth: 1,
    borderColor: "#263946",
  },
  timerPresetActive: { backgroundColor: "#B9F2FF", borderColor: "#B9F2FF" },
  timerPresetText: { color: "#82A3B0", fontSize: 10, fontWeight: "800" },
  timerPresetTextActive: { color: "#071119" },
  timerStyleLabel: {
    color: "#7DA7B6",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 18,
    marginBottom: 8,
  },
  timerStyleChoice: {
    minHeight: 72,
    borderRadius: radius.md,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "#0D202B",
    borderWidth: 1,
    borderColor: "#264453",
  },
  timerStyleChoiceActive: { borderColor: "#74DDF5" },
  timerStylePreview: {
    width: 54,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#061019",
    borderWidth: 1,
    borderColor: "#28566A",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  timerStyleVisor: {
    width: 24,
    height: 9,
    borderRadius: 3,
    backgroundColor: "#FF445D",
    borderWidth: 2,
    borderColor: "#DCEEF2",
  },
  timerStyleBlade: {
    position: "absolute",
    width: 62,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#9DE8FF",
    transform: [{ rotate: "-28deg" }, { translateX: 12 }],
  },
  timerStyleCopy: { flex: 1 },
  timerStyleTitle: { color: "#F2FCFF", fontSize: 13, fontWeight: "900" },
  timerStyleDescription: { color: "#7293A0", fontSize: 9, marginTop: 4 },
  timerStyleSelected: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#B9F2FF",
  },
  timerPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 10,
  },
  timerFutureStyles: { color: "#587886", fontSize: 9 },
  timerPreviewButton: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#B9F2FF",
  },
  timerPreviewText: { color: "#071119", fontSize: 10, fontWeight: "900" },
  readerSettingGroup: { marginTop: 18 },
  readerSettingGroupCompact: { flex: 1, minWidth: 220 },
  readerSettingsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    marginTop: 20,
  },
  readerSettingLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readerSettingLabel: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  readerSettingValue: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  fontScaleControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  fontScaleButton: {
    width: 48,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  fontScaleButtonText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  fontScalePreview: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: "#F5F7F5",
  },
  fontScalePreviewText: {
    color: colors.ink,
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
  },
  readerChoiceRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  readerChoice: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  readerChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  readerChoiceText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  readerChoiceTextActive: { color: colors.primaryDark },
  readerToneRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  readerToneChoice: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  readerToneChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: "#F4F9F7",
  },
  readerToneSwatch: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D8DDD9",
  },
  readerToneText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  readerSettingTip: {
    marginTop: 20,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: "#F4F7F5",
  },
  readerSettingTipText: { color: colors.inkMuted, fontSize: 11, lineHeight: 18 },
  timeUpRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 28,
    backgroundColor: "rgba(2,7,12,0.98)",
    overflow: "hidden",
  },
  timeUpFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#B9F2FF",
  },
  timeUpGrid: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  timeUpScanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(99,218,246,0.08)",
  },
  timeUpContent: {
    width: "100%",
    maxWidth: 560,
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 28,
    backgroundColor: "rgba(7,17,25,0.94)",
    borderWidth: 1,
    borderColor: "#27657A",
  },
  timeUpCodeRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  timeUpCodeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FF3755",
  },
  timeUpCode: {
    color: "#FF7387",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  timeUpStyleTag: {
    marginLeft: "auto",
    color: "#72DDF5",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  mechaStage: {
    width: "100%",
    height: 238,
    marginTop: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  mechaBackGlow: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(36,148,177,0.2)",
    borderWidth: 1,
    borderColor: "rgba(91,218,246,0.32)",
  },
  mechaUnit: {
    position: "absolute",
    top: 42,
    left: "50%",
    width: 150,
    height: 174,
    marginLeft: -75,
    alignItems: "center",
  },
  mechaFinLeft: {
    position: "absolute",
    top: -22,
    left: 46,
    width: 8,
    height: 58,
    borderRadius: 2,
    backgroundColor: "#F6D548",
    transform: [{ rotate: "-42deg" }],
  },
  mechaFinRight: {
    position: "absolute",
    top: -22,
    right: 46,
    width: 8,
    height: 58,
    borderRadius: 2,
    backgroundColor: "#F6D548",
    transform: [{ rotate: "42deg" }],
  },
  mechaHead: {
    width: 58,
    height: 54,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DDE8EC",
    borderWidth: 4,
    borderColor: "#718895",
    zIndex: 3,
  },
  mechaFace: {
    position: "absolute",
    bottom: -5,
    width: 26,
    height: 22,
    borderRadius: 4,
    backgroundColor: "#AABCC4",
    borderWidth: 2,
    borderColor: "#E7F0F2",
  },
  mechaVisor: {
    width: 38,
    height: 11,
    borderRadius: 3,
    backgroundColor: "#FF3755",
    borderWidth: 2,
    borderColor: "#263944",
  },
  mechaNeck: {
    width: 28,
    height: 16,
    marginTop: -2,
    backgroundColor: "#546B77",
  },
  mechaTorso: {
    width: 108,
    height: 88,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: 10,
    borderRadius: 14,
    backgroundColor: "#D9E6EA",
    borderWidth: 4,
    borderColor: "#607782",
    overflow: "hidden",
  },
  mechaChestLeft: {
    width: 40,
    height: 52,
    backgroundColor: "#235E9C",
    transform: [{ skewY: "8deg" }],
  },
  mechaChestCore: {
    width: 20,
    height: 62,
    backgroundColor: "#D44652",
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderColor: "#F1D351",
  },
  mechaChestRight: {
    width: 40,
    height: 52,
    backgroundColor: "#235E9C",
    transform: [{ skewY: "-8deg" }],
  },
  mechaShoulder: {
    position: "absolute",
    top: 66,
    width: 44,
    height: 54,
    borderRadius: 10,
    backgroundColor: "#D9E6EA",
    borderWidth: 4,
    borderColor: "#607782",
  },
  mechaShoulderLeft: { left: -15, transform: [{ rotate: "8deg" }] },
  mechaShoulderRight: { right: -15, transform: [{ rotate: "-8deg" }] },
  mechaSword: {
    position: "absolute",
    top: 112,
    left: "50%",
    width: 250,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 8,
  },
  mechaSwordBlade: {
    width: 190,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#B9F2FF",
    borderWidth: 2,
    borderColor: "#F4FDFF",
  },
  mechaSwordGuard: {
    width: 14,
    height: 25,
    borderRadius: 4,
    backgroundColor: "#F1D351",
  },
  mechaSwordHandle: {
    width: 42,
    height: 11,
    borderRadius: 4,
    backgroundColor: "#536876",
    borderWidth: 2,
    borderColor: "#A8BAC2",
  },
  mechaSlash: {
    position: "absolute",
    top: 110,
    left: "50%",
    width: 620,
    height: 5,
    marginLeft: -310,
    borderRadius: 4,
    backgroundColor: "#D6FAFF",
    zIndex: 12,
  },
  timeUpKicker: {
    color: "#FF536D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.8,
  },
  timeUpTitle: {
    color: "#F1FCFF",
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "900",
    letterSpacing: 0.8,
    textAlign: "center",
    marginTop: 8,
  },
  timeUpSubtitle: {
    color: "#7FA5B3",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  timeUpActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  timeUpSecondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#31687D",
    backgroundColor: "#102C39",
  },
  timeUpSecondaryText: { color: "#BDEEFF", fontSize: 12, fontWeight: "900" },
  timeUpPrimaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#B9F2FF",
  },
  timeUpPrimaryText: { color: "#071119", fontSize: 12, fontWeight: "900" },
  confirmModalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20,30,27,0.46)",
  },
  confirmDialog: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 22,
    alignItems: "center",
    ...shadows.card,
  },
  confirmIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF4F1",
    marginBottom: 14,
  },
  confirmTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "800",
  },
  confirmText: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  confirmActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  confirmCancelButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
  },
  confirmCancelText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  confirmRemoveButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  confirmRemoveText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  disabledButton: { opacity: 0.58 },

  historySummary: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 20,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginBottom: 28,
  },
  historyModeTabs: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 14,
  },
  historyModeTab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  historyModeTabActive: { backgroundColor: colors.surface, ...shadows.card },
  historyModeText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  historyModeTextActive: { color: colors.primary, fontWeight: "800" },
  historyFilters: { flexDirection: "row", gap: 8, marginBottom: 20 },
  historyFilter: {
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  historyFilterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  historyFilterText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  historyFilterTextActive: { color: "#fff" },
  summaryValue: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  summaryLabel: {
    color: "#BFD8D2",
    fontSize: 10,
    marginTop: 4,
    textAlign: "center",
  },
  summaryDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  historyGroup: { marginBottom: 26, paddingLeft: 4 },
  historyDateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    marginRight: 9,
  },
  historyDate: { color: colors.ink, fontWeight: "800", fontSize: 15 },
  historyExam: { color: colors.inkMuted, fontSize: 11, marginLeft: 10 },
  historyArticle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 13,
    marginBottom: 9,
    ...shadows.card,
  },
  historyArticleIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  historyArticleTitle: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  historyArticleMeta: { color: colors.inkMuted, fontSize: 10, marginTop: 4 },
  historyArticleStatus: { flexDirection: "row", alignItems: "center", gap: 3 },
  historyCompletedText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  historyPendingText: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  historyEmpty: {
    minHeight: 190,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: 24,
  },
  historyEmptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "800", marginTop: 12 },
  historyEmptyText: { color: colors.inkMuted, fontSize: 11, marginTop: 5, textAlign: "center" },
  mistakeList: { gap: 12 },
  mistakeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  mistakeSource: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  mistakePrompt: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: "800", marginTop: 8 },
  mistakeWrong: { color: colors.danger, fontSize: 12, lineHeight: 19, marginTop: 12 },
  mistakeCorrect: { color: colors.primary, fontSize: 12, lineHeight: 19, marginTop: 4 },
  mistakeExplanation: { color: colors.inkMuted, fontSize: 11, lineHeight: 18, marginTop: 10 },
  mistakeRetry: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 14,
  },
  mistakeRetryText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  memoryReviewSafe: { flex: 1, backgroundColor: colors.background },
  memoryReviewHeader: {
    height: 62,
    paddingHorizontal: 16,
    position: "relative",
    zIndex: 20,
    elevation: 20,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  memoryReviewHeaderCenter: { flex: 1, alignItems: "center" },
  memoryReviewHeaderTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  memoryReviewHeaderMeta: {
    color: colors.inkMuted,
    fontSize: 10,
    marginTop: 2,
  },
  memoryExitButton: {
    width: 72,
    height: 44,
    position: "relative",
    zIndex: 22,
    elevation: 22,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.surfaceMuted,
  },
  memoryExitText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  memoryReviewHeaderSpacer: { width: 72 },
  memoryProgressTrack: { height: 4, backgroundColor: colors.surfaceMuted },
  memoryProgressFill: { height: 4, backgroundColor: colors.accent },
  memoryReviewScroller: { flex: 1, position: "relative", zIndex: 0 },
  memoryReviewContent: {
    alignItems: "center",
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 14,
  },
  memoryReviewEyebrow: {
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 14,
  },
  memoryCard: {
    minHeight: 370,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 28,
    paddingVertical: 30,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  memoryCardRevealed: {
    borderColor: "#B9D8D0",
    justifyContent: "flex-start",
  },
  memoryCardBadge: {
    alignSelf: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: colors.primarySoft,
    marginBottom: 24,
  },
  memoryCardBadgeText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  memoryCardWord: {
    color: colors.ink,
    fontSize: 42,
    lineHeight: 52,
    fontWeight: "800",
    textAlign: "center",
  },
  memoryCardPhonetic: {
    color: colors.primary,
    fontSize: 15,
    marginTop: 5,
    textAlign: "center",
  },
  memoryAudioButton: {
    minWidth: 104,
    marginTop: 18,
  },
  memoryRevealHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 56,
  },
  memoryRevealHintText: { color: colors.inkMuted, fontSize: 12 },
  memoryAnswer: {
    width: "100%",
    alignItems: "center",
    marginTop: 24,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  memoryTranslation: {
    color: colors.ink,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "700",
    textAlign: "center",
  },
  memoryPartOfSpeech: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginTop: 10,
  },
  memoryDefinition: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 10,
  },
  memoryExample: {
    width: "100%",
    backgroundColor: "#F4F7F5",
    borderRadius: radius.md,
    padding: 14,
    marginTop: 18,
  },
  memoryExampleEnglish: { color: colors.ink, fontSize: 13, lineHeight: 21 },
  memoryExampleChinese: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 5,
  },
  memoryRatingArea: { marginTop: 22 },
  memoryRatingTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 11,
  },
  memoryRatingGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  memoryRatingButton: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 78,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  memoryRating_again: { backgroundColor: "#FFF2EF", borderColor: "#F0C5BD" },
  memoryRating_hard: { backgroundColor: "#FFF8E8", borderColor: "#F0D59C" },
  memoryRating_good: { backgroundColor: "#EDF7F4", borderColor: "#B9D8D0" },
  memoryRating_easy: { backgroundColor: "#EEF3FF", borderColor: "#C3D1EC" },
  memoryRatingLabel: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  memoryRatingHint: { color: colors.inkMuted, fontSize: 9, marginTop: 2 },
  memoryRatingInterval: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 5,
  },
  memoryComplete: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  memoryCompleteIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginBottom: 22,
  },
  memoryCompleteTitle: { color: colors.ink, fontSize: 25, fontWeight: "800" },
  memoryCompleteText: {
    maxWidth: 460,
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
  },
  memoryCompleteButton: {
    height: 50,
    minWidth: 190,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginTop: 26,
  },
  memoryCompleteButtonText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  wordStatsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    marginBottom: 20,
  },
  wordStatsIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  wordStatsTitle: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  wordStatsText: { color: colors.inkMuted, fontSize: 10, marginTop: 4 },
  streakCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  streakCircleValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 15,
  },
  streakCircleLabel: { color: colors.inkMuted, fontSize: 8 },
  memoryReviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 15,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    marginBottom: 20,
    ...shadows.card,
  },
  memoryReviewBannerIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  memoryReviewBannerTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  memoryReviewBannerText: {
    color: "#CBE0DA",
    fontSize: 10,
    lineHeight: 16,
    marginTop: 3,
  },
  memoryReviewBannerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  memoryReviewBannerActionText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  stickyArea: { backgroundColor: colors.background, paddingBottom: 12 },
  examFilters: { gap: 8, paddingRight: 20 },
  filterPill: {
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: colors.line,
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  filterTextActive: { color: "#fff" },
  filterCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  filterCountActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  filterCountText: { fontSize: 9, color: colors.inkMuted, fontWeight: "800" },
  filterCountTextActive: { color: "#fff" },
  searchBox: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    gap: 9,
    marginTop: 11,
  },
  searchInput: { flex: 1, color: colors.ink, fontSize: 13 },
  wordList: { gap: 11 },
  wordCard: {
    padding: 17,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  wordCardTop: { flexDirection: "row", justifyContent: "space-between" },
  wordCardTitle: { color: colors.ink, fontSize: 22, fontWeight: "800" },
  wordCardPhonetic: { color: colors.primary, fontSize: 12, marginTop: 3 },
  wordCardActions: { flexDirection: "row", gap: 7 },
  miniRoundButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  wordCardTranslation: {
    color: colors.ink,
    fontSize: 14,
    marginTop: 15,
    paddingBottom: 14,
  },
  wordSource: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    minHeight: 44,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  wordSourcePressed: { opacity: 0.68 },
  wordSourceText: { color: colors.inkMuted, fontSize: 10, flex: 1 },
  wordSourceAction: { color: colors.primary, fontSize: 10, fontWeight: "800" },
  emptyState: { alignItems: "center", paddingVertical: 72 },
  emptyIllustration: {
    width: 78,
    height: 78,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 18,
  },
  emptyText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 7,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 18,
    ...shadows.card,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  profileName: { color: colors.ink, fontWeight: "800", fontSize: 17 },
  profileSubtitle: { color: colors.inkMuted, fontSize: 11, marginTop: 4 },
  levelBadge: {
    backgroundColor: "#FFF2D8",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  levelBadgeText: { color: "#9A641B", fontSize: 10, fontWeight: "800" },
  settingsTitle: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 16,
    marginTop: 28,
    marginBottom: 11,
  },
  settingsGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 15,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    gap: 12,
  },
  settingRowMain: {
    flex: 1,
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginLeft: -15,
    paddingLeft: 15,
  },
  settingSwitchWrap: {
    width: 52,
    minHeight: 68,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  settingSwitch: {
    margin: 0,
    transform: [{ scale: Platform.OS === "ios" ? 0.88 : 0.92 }],
  },
  settingRowPressed: { backgroundColor: "#F3F7F5" },
  settingIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  settingValue: { color: colors.inkMuted, fontSize: 10, marginTop: 3 },
  settingSeparator: { height: 1, backgroundColor: colors.line, marginLeft: 50 },
  toggle: {
    width: 43,
    height: 25,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: 3,
  },
  toggleKnob: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  inlineExamPicker: {
    backgroundColor: "#F6F8F7",
    borderRadius: radius.md,
    padding: 7,
    marginBottom: 10,
  },
  inlineExamItem: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inlineExamItemActive: { backgroundColor: colors.surface },
  inlineExamText: { color: colors.inkMuted, fontSize: 12 },
  inlineExamTextActive: { color: colors.primary, fontWeight: "800" },
  quoteCard: {
    marginTop: 22,
    borderRadius: radius.lg,
    padding: 22,
    backgroundColor: "#EAE1D4",
  },
  quoteMark: {
    color: colors.accent,
    fontSize: 38,
    lineHeight: 32,
    fontWeight: "800",
  },
  quoteText: {
    color: colors.ink,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 17,
    lineHeight: 26,
  },
  quoteAuthor: { color: colors.inkMuted, fontSize: 10, marginTop: 10 },

  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bottomNavItemIOS: {
    transform: [{ translateY: 4 }],
  },
  bottomNavItemPressed: { opacity: 0.65 },
  bottomIconWrap: {
    width: 56,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  bottomIconIndicator: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  bottomNavText: { color: colors.inkMuted, fontSize: 11, fontWeight: "600" },
  bottomNavTextActive: { color: colors.primary, fontWeight: "800" },
  sideNav: {
    width: 180,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingTop: 22,
    paddingBottom: 20,
  },
  sideNavItems: { marginTop: 40, gap: 7 },
  sideNavItem: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 13,
    borderRadius: radius.md,
  },
  sideNavItemActive: { backgroundColor: colors.primarySoft },
  navItemPressed: { opacity: 0.72 },
  sideNavText: { color: colors.inkMuted, fontSize: 12, fontWeight: "600" },
  sideNavTextActive: { color: colors.primary, fontWeight: "800" },
  sideNavFooter: {
    marginTop: "auto",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    padding: 14,
  },
  sideNavFooterText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  sideNavFooterSub: { color: "#BFD8D2", fontSize: 9, marginTop: 3 },
});
