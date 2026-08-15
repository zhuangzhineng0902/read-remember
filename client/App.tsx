import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ArrowLeft,
  Bell,
  BookMarked,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Flame,
  GraduationCap,
  Headphones,
  History as HistoryIcon,
  Home,
  Library,
  Menu,
  Search,
  Settings,
  Sparkles,
  Target,
  Volume2,
  X,
} from "lucide-react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { api, type AnswerResult, type ManualPush } from "./src/api";
import {
  articles,
  exams,
  getDailyArticles,
  getExam,
  lookupWord,
} from "./src/data";
import { storage } from "./src/storage";
import { colors, radius, shadows, spacing } from "./src/theme";
import { LongPressWord } from "./src/components/LongPressWord";
import {
  isReviewDue,
  reviewIntervalLabel,
  scheduleMemoryReview,
} from "./src/memory";
import {
  Article,
  ExamId,
  HistoryRecord,
  MemoryRating,
  SavedWord,
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

let pronunciationPlayer: AudioPlayer | null = null;
let pronunciationReleaseTimer: ReturnType<typeof setTimeout> | null = null;

async function playWord(word: string, accent: "us" | "uk" = "us") {
  try {
    const pronunciation = await api.getPronunciation(word, accent);
    const matchesRequestedAccent =
      !pronunciation.actualAccent ||
      pronunciation.actualAccent === "unknown" ||
      pronunciation.actualAccent === accent;
    if (pronunciation.audioUrl && matchesRequestedAccent) {
      if (pronunciationReleaseTimer) clearTimeout(pronunciationReleaseTimer);
      pronunciationPlayer?.release();
      pronunciationPlayer = createAudioPlayer(pronunciation.audioUrl);
      pronunciationPlayer.play();
      pronunciationReleaseTimer = setTimeout(() => {
        pronunciationPlayer?.release();
        pronunciationPlayer = null;
      }, 15_000);
      return;
    }
  } catch {
    // Device speech remains available when the dictionary service is offline.
  }
  Speech.stop();
  Speech.speak(word, {
    language: accent === "uk" ? "en-GB" : "en-US",
    rate: 0.82,
    pitch: 1,
  });
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

function Onboarding({ onSelect }: { onSelect: (examId: ExamId) => void }) {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [selected, setSelected] = useState<ExamId>("toefl");

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
              <Text style={styles.pillSoftText}>每天 3 篇，读有所获</Text>
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
          <Pressable
            onPress={() => onSelect(selected)}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>开启今日阅读</Text>
            <ChevronRight color="#fff" size={20} />
          </Pressable>
          <Text style={styles.privacyNote}>你的学习记录仅保存在本机</Text>
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
  manualPushes,
  completed,
  onOpen,
  onOpenPush,
  onNavigate,
}: {
  examId: ExamId;
  daily: Article[];
  manualPushes: ManualPush[];
  completed: string[];
  onOpen: (a: Article) => void;
  onOpenPush: (articleId: string) => void;
  onNavigate: (tab: TabId) => void;
}) {
  const exam = getExam(examId);
  const done = daily.filter((item) => completed.includes(item.id)).length;

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
              {done === 3 ? "今天的计划完成了" : `还剩 ${3 - done} 篇，慢慢来`}
            </Text>
          </View>
          <View style={styles.streakPill}>
            <Flame size={15} color={colors.accent} fill={colors.accent} />
            <Text style={styles.streakText}>连续 7 天</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(5, (done / 3) * 100)}%` },
            ]}
          />
        </View>
        <View style={styles.goalBottom}>
          <Text style={styles.goalProgress}>{done} / 3 篇</Text>
          <Text style={styles.goalExam}>{exam.name}</Text>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>今日精选</Text>
          <Text style={styles.sectionSubtitle}>根据你的目标与进度智能匹配</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>3 篇</Text>
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
          <Text style={styles.articleYear}>{article.year} 真题精选</Text>
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

function ReaderScreen({
  article,
  savedWords,
  completed,
  onBack,
  onToggleWord,
  onSubmit,
}: {
  article: Article;
  savedWords: SavedWord[];
  completed: boolean;
  onBack: () => void;
  onToggleWord: (word: WordInfo, article: Article) => void;
  onSubmit: (article: Article, answers: number[]) => Promise<AnswerResult[]>;
}) {
  const { width } = useWindowDimensions();
  const [readerTab, setReaderTab] = useState<"article" | "answer">("article");
  const [selectedWord, setSelectedWord] = useState<WordInfo | null>(null);
  const [pressedWord, setPressedWord] = useState<string | null>(null);
  const [wordLoading, setWordLoading] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, number>
  >({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answerResults, setAnswerResults] = useState<AnswerResult[]>([]);
  const [fontScale, setFontScale] = useState(1);
  const isSaved = (word: string) =>
    savedWords.some(
      (item) =>
        item.examId === article.examId &&
        item.word === word.toLowerCase().replace(/[^a-z'-]/g, ""),
    );
  const contentWidth = Math.min(760, width - (width >= 768 ? 160 : 32));
  const allAnswered = article.questions.every(
    (_, index) => selectedAnswers[index] !== undefined,
  );
  const correctCount = answerResults.filter((result) => result.correct).length;

  const openWord = (token: string, paragraph: string) => {
    const localWord = lookupWord(token);
    if (!localWord.word) return;
    setSelectedWord(localWord);
    setPressedWord(localWord.word);
    setWordLoading(true);
    api
      .getPronunciation(localWord.word, "us", paragraph)
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

  const openAnswers = async () => {
    if (submitted) {
      setReaderTab("answer");
      return;
    }
    if (!allAnswered) {
      Alert.alert("还有题目未完成", "请先在文章下方选择每道题的答案。");
      return;
    }
    setSubmitting(true);
    try {
      const answers = article.questions.map(
        (_, index) => selectedAnswers[index],
      );
      const results = await onSubmit(article, answers);
      setAnswerResults(results);
      setSubmitted(true);
      setReaderTab("answer");
    } catch (error) {
      Alert.alert(
        "提交失败",
        error instanceof Error ? error.message : "请稍后再试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const closeReader = () => {
    onBack();
  };

  return (
    <SafeAreaView style={styles.readerSafe}>
      <ExpoStatusBar style="dark" />
      <View style={styles.readerTopbar}>
        <Pressable
          accessibilityLabel="返回"
          onPress={closeReader}
          style={styles.iconButton}
        >
          <ArrowLeft size={22} color={colors.ink} />
        </Pressable>
        <View style={styles.readerTabs}>
          <Pressable
            onPress={() => setReaderTab("article")}
            style={[
              styles.readerTab,
              readerTab === "article" && styles.readerTabActive,
            ]}
          >
            <Text
              style={[
                styles.readerTabText,
                readerTab === "article" && styles.readerTabTextActive,
              ]}
            >
              文章
            </Text>
          </Pressable>
          <Pressable
            onPress={openAnswers}
            style={[
              styles.readerTab,
              readerTab === "answer" && styles.readerTabActive,
            ]}
          >
            <Text
              style={[
                styles.readerTabText,
                readerTab === "answer" && styles.readerTabTextActive,
              ]}
            >
              答案解析
            </Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityLabel="阅读设置"
          onPress={() => setFontScale(fontScale >= 1.2 ? 0.9 : fontScale + 0.1)}
          style={styles.fontButton}
        >
          <Text style={styles.fontButtonText}>Aa</Text>
        </Pressable>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.readerScroll}
      >
        <View style={[styles.readerPaper, { width: contentWidth }]}>
          <View style={styles.readerHeading}>
            <Text style={styles.readerEyebrow}>
              {article.eyebrow} · {article.year}
            </Text>
            <Text style={styles.readerTitle}>{article.title}</Text>
            <View style={styles.readerMeta}>
              <Text style={styles.readerMetaText}>
                {getExam(article.examId).name}
              </Text>
              <View style={styles.metaDivider} />
              <Text style={styles.readerMetaText}>
                约 {article.readMinutes} 分钟
              </Text>
            </View>
          </View>

          {readerTab === "article" ? (
            <View>
              <View style={styles.longPressHint}>
                <View style={styles.hintHand}>
                  <Text>☝</Text>
                </View>
                <Text style={styles.longPressHintText}>
                  {Platform.OS === "web"
                    ? "鼠标按住任意单词，查看翻译并加入生词库"
                    : "长按任意单词，查看翻译并加入生词库"}
                </Text>
              </View>
              {article.paragraphs.map((paragraph, pIndex) => (
                <Text
                  key={pIndex}
                  style={[
                    styles.paragraph,
                    { fontSize: 18 * fontScale, lineHeight: 34 * fontScale },
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
                        onLongPress={() => clean && openWord(token, paragraph)}
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

              <View style={styles.practiceHeader}>
                <Text style={styles.practiceEyebrow}>READING QUESTIONS</Text>
                <Text style={styles.practiceTitle}>根据文章选择正确答案</Text>
                <Text style={styles.practiceHint}>
                  已完成 {Object.keys(selectedAnswers).length} /{" "}
                  {article.questions.length}
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
                            accessibilityState={{ checked: selected }}
                            key={option}
                            onPress={() =>
                              setSelectedAnswers((current) => ({
                                ...current,
                                [qIndex]: index,
                              }))
                            }
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
                    : allAnswered
                      ? "提交答案并查看解析"
                      : "请完成全部题目"}
                </Text>
                <ChevronRight color="#fff" size={19} />
              </Pressable>
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
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={!!selectedWord}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedWord(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSelectedWord(null)}
        />
        {selectedWord && (
          <View style={styles.wordSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.wordTop}>
              <View>
                <Text style={styles.wordTitle}>{selectedWord.word}</Text>
                <Text style={styles.phonetic}>{selectedWord.phonetic}</Text>
              </View>
              <View style={styles.wordActions}>
                <Pressable
                  accessibilityLabel="播放发音"
                  onPress={() => playWord(selectedWord.word)}
                  style={styles.roundButton}
                >
                  <Volume2 size={20} color={colors.primary} />
                </Pressable>
                <Pressable
                  accessibilityLabel="关闭"
                  onPress={() => setSelectedWord(null)}
                  style={styles.roundButton}
                >
                  <X size={20} color={colors.inkMuted} />
                </Pressable>
              </View>
            </View>
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
            <Pressable
              onPress={() => {
                onToggleWord(selectedWord, article);
                setSelectedWord(null);
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
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

function HistoryScreen({
  history,
  onOpen,
}: {
  history: HistoryRecord[];
  onOpen: (articleId: string) => void;
}) {
  const records = history.length
    ? history
    : [
        {
          date: formatDateKey(),
          examId: "toefl" as ExamId,
          articleIds: getDailyArticles("toefl").map((a) => a.id),
        },
      ];
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
          <Text style={styles.summaryValue}>
            {new Set(history.flatMap((h) => h.articleIds)).size}
          </Text>
          <Text style={styles.summaryLabel}>累计阅读</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.summaryValue}>{history.length}</Text>
          <Text style={styles.summaryLabel}>学习天数</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.summaryValue}>
            {Math.max(0, history.flatMap((h) => h.articleIds).length * 6)}
          </Text>
          <Text style={styles.summaryLabel}>阅读分钟</Text>
        </View>
      </View>
      {records.map((record) => (
        <View
          key={`${record.date}-${record.examId}`}
          style={styles.historyGroup}
        >
          <View style={styles.historyDateRow}>
            <View style={styles.timelineDot} />
            <Text style={styles.historyDate}>
              {record.date === formatDateKey() ? "今天" : record.date}
            </Text>
            <Text style={styles.historyExam}>
              {getExam(record.examId).name}
            </Text>
          </View>
          {record.articleIds.map((id) => {
            const article = articles.find((item) => item.id === id);
            if (!article) return null;
            return (
              <Pressable
                key={id}
                onPress={() => onOpen(article.id)}
                style={styles.historyArticle}
              >
                <View style={styles.historyArticleIcon}>
                  <BookOpen size={18} color={colors.primary} />
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.historyArticleTitle}>
                    {article.title}
                  </Text>
                  <Text style={styles.historyArticleMeta}>
                    {article.eyebrow} · {article.readMinutes} 分钟
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.inkMuted} />
              </Pressable>
            );
          })}
        </View>
      ))}
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
  onClose,
  onReview,
}: {
  words: SavedWord[];
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
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.memoryReviewSafe}>
        <ExpoStatusBar style="dark" />
        <View style={styles.memoryReviewHeader}>
          <Pressable
            accessibilityLabel="退出记忆卡复习"
            onPress={onClose}
            style={styles.iconButton}
          >
            <X size={21} color={colors.ink} />
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
              onPress={onClose}
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
              <Text style={styles.memoryCardPhonetic}>{current.phonetic}</Text>
              <Pressable
                accessibilityLabel={`播放 ${current.word} 的发音`}
                onPress={() => playWord(current.word)}
                style={styles.memoryAudioButton}
              >
                <Volume2 size={19} color={colors.primary} />
                <Text style={styles.memoryAudioText}>播放发音</Text>
              </Pressable>

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
  onRemove,
  onReview,
}: {
  words: SavedWord[];
  activeExam: ExamId;
  onRemove: (word: SavedWord) => Promise<void>;
  onReview: (word: SavedWord, rating: MemoryRating) => Promise<SavedWord>;
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
                        {item.phonetic}
                      </Text>
                    </View>
                    <View style={styles.wordCardActions}>
                      <Pressable
                        accessibilityLabel={`播放 ${item.word} 的发音`}
                        onPress={() => playWord(item.word)}
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
                  <View style={styles.wordSource}>
                    <BookOpen size={13} color={colors.inkMuted} />
                    <Text numberOfLines={1} style={styles.wordSourceText}>
                      来自：{article?.title ?? "阅读文章"}
                    </Text>
                  </View>
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
          onClose={() => setReviewQueue(null)}
          onReview={onReview}
        />
      )}
    </View>
  );
}

function ProfileScreen({
  examId,
  onChangeExam,
}: {
  examId: ExamId;
  onChangeExam: (id: ExamId) => void;
}) {
  const [showExamPicker, setShowExamPicker] = useState(false);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Header title="我的学习" subtitle="保持节奏，持续积累" />
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>R</Text>
        </View>
        <View style={styles.flexOne}>
          <Text style={styles.profileName}>阅读学习者</Text>
          <Text style={styles.profileSubtitle}>已连续学习 7 天</Text>
        </View>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>Lv. 3</Text>
        </View>
      </View>
      <Text style={styles.settingsTitle}>学习设置</Text>
      <View style={styles.settingsGroup}>
        <Pressable
          onPress={() => setShowExamPicker(!showExamPicker)}
          style={styles.settingRow}
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
        {showExamPicker && (
          <View style={styles.inlineExamPicker}>
            {exams.map((exam) => (
              <Pressable
                key={exam.id}
                onPress={() => {
                  onChangeExam(exam.id);
                  setShowExamPicker(false);
                }}
                style={[
                  styles.inlineExamItem,
                  exam.id === examId && styles.inlineExamItemActive,
                ]}
              >
                <Text
                  style={[
                    styles.inlineExamText,
                    exam.id === examId && styles.inlineExamTextActive,
                  ]}
                >
                  {exam.name}
                </Text>
                {exam.id === examId && (
                  <Check size={17} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.settingSeparator} />
        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <Bell size={19} color={colors.primary} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.settingLabel}>每日提醒</Text>
            <Text style={styles.settingValue}>每天 20:30</Text>
          </View>
          <View style={styles.toggle}>
            <View style={styles.toggleKnob} />
          </View>
        </View>
        <View style={styles.settingSeparator} />
        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <Headphones size={19} color={colors.primary} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.settingLabel}>英式 / 美式发音</Text>
            <Text style={styles.settingValue}>美式发音</Text>
          </View>
          <ChevronRight size={18} color={colors.inkMuted} />
        </View>
      </View>
      <View style={styles.quoteCard}>
        <Text style={styles.quoteMark}>“</Text>
        <Text style={styles.quoteText}>
          A reader lives a thousand lives before he dies.
        </Text>
        <Text style={styles.quoteAuthor}>— George R. R. Martin</Text>
      </View>
    </ScrollView>
  );
}

function Navigation({
  active,
  tablet,
  onChange,
}: {
  active: TabId;
  tablet: boolean;
  onChange: (tab: TabId) => void;
}) {
  if (tablet) {
    return (
      <View style={styles.sideNav}>
        <AppLogo compact />
        <View style={styles.sideNavItems}>
          {navItems.map(({ id, label, icon: Icon }) => (
            <Pressable
              accessibilityLabel={label}
              key={id}
              onPress={() => onChange(id)}
              style={[
                styles.sideNavItem,
                active === id && styles.sideNavItemActive,
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
    <View style={styles.bottomNav}>
      {navItems.map(({ id, label, icon: Icon }) => (
        <Pressable
          accessibilityLabel={label}
          key={id}
          onPress={() => onChange(id)}
          style={styles.bottomNavItem}
        >
          <View
            style={[
              styles.bottomIconWrap,
              active === id && styles.bottomIconWrapActive,
            ]}
          >
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

export default function App() {
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [loading, setLoading] = useState(true);
  const [examId, setExamId] = useState<ExamId | null>(null);
  const [tab, setTab] = useState<TabId>("today");
  const [reader, setReader] = useState<Article | null>(null);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [daily, setDaily] = useState<Article[]>([]);
  const [manualPushes, setManualPushes] = useState<ManualPush[]>([]);
  const [apiOnline, setApiOnline] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      const [
        savedExam,
        cachedWords,
        cachedHistory,
        cachedCompleted,
        deviceId,
        token,
      ] = await Promise.all([
        storage.getExam(),
        storage.getWords(),
        storage.getHistory(),
        storage.getCompleted(),
        storage.getDeviceId(),
        storage.getAuthToken(),
      ]);

      setExamId(savedExam);
      setSavedWords(cachedWords);
      setHistory(cachedHistory);
      setCompleted(cachedCompleted);
      if (savedExam) {
        setDaily(getDailyArticles(savedExam));
      }

      try {
        const session = await api.authenticate(deviceId, token);
        await storage.setAuthToken(session.token);
        if (savedExam && session.examId !== savedExam) {
          await api.setExam(savedExam);
        }
        if (savedExam) {
          const [remoteDaily, remoteHistory, remoteWords, pushes] =
            await Promise.all([
              api.getDaily(),
              api.getHistory(),
              api.getVocabulary(),
              api.getPushes(),
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
          await Promise.all([
            storage.setHistory(remoteHistory.records),
            storage.setCompleted(completedIds),
            storage.setWords(remoteWords),
          ]);
        }
        setApiOnline(true);
      } catch (error) {
        console.warn("API unavailable, using cached data", error);
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

  const selectExam = async (nextExam: ExamId) => {
    setExamId(nextExam);
    await storage.setExam(nextExam);
    setDaily(getDailyArticles(nextExam));
    setTab("today");
    try {
      await api.setExam(nextExam);
      const [remoteDaily, remoteHistory, remoteWords, pushes] =
        await Promise.all([
          api.getDaily(),
          api.getHistory(),
          api.getVocabulary(),
          api.getPushes(),
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
      setApiOnline(true);
      await Promise.all([
        storage.setHistory(remoteHistory.records),
        storage.setCompleted(completedIds),
        storage.setWords(remoteWords),
      ]);
    } catch (error) {
      setApiOnline(false);
      Alert.alert(
        "正在使用离线内容",
        error instanceof Error ? error.message : "暂时无法连接服务器",
      );
    }
  };

  const toggleWord = async (word: WordInfo, article: Article) => {
    const existing = savedWords.some(
      (item) => item.examId === article.examId && item.word === word.word,
    );
    let enrichedWord = word;
    if (word.phonetic === "/ pronunciation /") {
      try {
        const pronunciation = await api.getPronunciation(word.word);
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
        Alert.alert(
          "生词同步失败",
          error instanceof Error ? error.message : "请稍后再试",
        );
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
        Alert.alert(
          "移除失败",
          error instanceof Error ? error.message : "请稍后再试",
        );
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
      Alert.alert(
        "复习记录同步失败",
        error instanceof Error ? error.message : "请稍后再试",
      );
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
      const [remoteHistory, pushes] = await Promise.all([
        api.getHistory(),
        api.getPushes(),
      ]);
      const completedIds = [
        ...new Set([...remoteHistory.completedIds, article.id]),
      ];
      setHistory(remoteHistory.records);
      setManualPushes(pushes);
      setCompleted(completedIds);
      await Promise.all([
        storage.setHistory(remoteHistory.records),
        storage.setCompleted(completedIds),
      ]);
    }
    return results;
  };

  const openHistoryArticle = async (articleId: string) => {
    const cached = daily.find((item) => item.id === articleId);
    if (cached) {
      setReader(cached);
      return;
    }
    try {
      setReader(
        apiOnline
          ? await api.getArticle(articleId)
          : (articles.find((item) => item.id === articleId) ?? null),
      );
    } catch (error) {
      Alert.alert(
        "文章加载失败",
        error instanceof Error ? error.message : "请稍后再试",
      );
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
  if (!examId) return <Onboarding onSelect={selectExam} />;
  if (reader)
    return (
      <ReaderScreen
        article={reader}
        savedWords={savedWords}
        completed={completed.includes(reader.id)}
        onBack={() => setReader(null)}
        onToggleWord={toggleWord}
        onSubmit={submitArticle}
      />
    );

  const content =
    tab === "today" ? (
      <TodayScreen
        examId={examId}
        daily={daily}
        manualPushes={manualPushes}
        completed={completed}
        onOpen={setReader}
        onOpenPush={openHistoryArticle}
        onNavigate={setTab}
      />
    ) : tab === "history" ? (
      <HistoryScreen history={history} onOpen={openHistoryArticle} />
    ) : tab === "words" ? (
      <WordsScreen
        words={savedWords}
        activeExam={examId}
        onRemove={removeWord}
        onReview={reviewWord}
      />
    ) : (
      <ProfileScreen examId={examId} onChangeExam={selectExam} />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.appShell}>
        {tablet && <Navigation active={tab} tablet onChange={setTab} />}
        <View style={[styles.mainContent, tablet && styles.mainContentTablet]}>
          {content}
        </View>
        {!tablet && (
          <Navigation active={tab} tablet={false} onChange={setTab} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  readerSafe: {
    flex: 1,
    backgroundColor: "#F3F1EA",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
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
  mainContent: { flex: 1, paddingBottom: 76 },
  mainContentTablet: { paddingBottom: 0 },
  screen: { flex: 1 },
  screenContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 42,
    width: "100%",
    maxWidth: 1050,
    alignSelf: "center",
  },

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
    width: 42,
    height: 42,
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
  },
  readerTab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 9 },
  readerTabActive: { backgroundColor: colors.surface },
  readerTabText: { color: colors.inkMuted, fontSize: 12, fontWeight: "600" },
  readerTabTextActive: { color: colors.ink, fontWeight: "800" },
  fontButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fontButtonText: { color: colors.ink, fontWeight: "800", fontSize: 16 },
  readerScroll: {
    alignItems: "center",
    paddingVertical: 30,
    paddingBottom: 80,
  },
  readerPaper: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 24,
    paddingVertical: 30,
    ...shadows.card,
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
  readerMeta: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  readerMetaText: { fontSize: 11, color: colors.inkMuted },
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
  paragraph: {
    color: "#26332F",
    marginTop: 24,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
  },
  interactiveWord: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: "#A9B8B3",
  },
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
  roundButton: {
    width: 42,
    height: 42,
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
  memoryReviewSafe: { flex: 1, backgroundColor: colors.background },
  memoryReviewHeader: {
    height: 62,
    paddingHorizontal: 16,
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
  memoryReviewHeaderSpacer: { width: 42 },
  memoryProgressTrack: { height: 4, backgroundColor: colors.surfaceMuted },
  memoryProgressFill: { height: 4, backgroundColor: colors.accent },
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
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    marginTop: 18,
  },
  memoryAudioText: { color: colors.primary, fontSize: 11, fontWeight: "700" },
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
    height: 38,
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
    width: 34,
    height: 34,
    borderRadius: 11,
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
    paddingTop: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  wordSourceText: { color: colors.inkMuted, fontSize: 10, flex: 1 },
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
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    gap: 12,
  },
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
    height: 42,
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
    height: Platform.OS === "ios" ? 82 : 72,
    paddingBottom: Platform.OS === "ios" ? 14 : 6,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  bottomIconWrap: {
    height: 29,
    minWidth: 39,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomIconWrapActive: { backgroundColor: colors.primarySoft },
  bottomNavText: { color: colors.inkMuted, fontSize: 9 },
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
