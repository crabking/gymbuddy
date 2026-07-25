import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProfile,
  getChatMessages,
  getMemories,
  removeMemory,
  getWorkspaceFiles,
  updateProfile,
  resetOnboarding,
  resetWorkspace,
  getActiveWorkoutSession,
  startTodayWorkoutSession,
  toggleSessionSet,
  completeActiveSession,
  getNutritionToday,
  getTodayTrainingInfo,
} from "@/lib/gym-buddy.functions";
import { getCurrentUser, logout } from "@/lib/auth.functions";
import { TabBar } from "@/components/TabBar";
import { ConfirmModal } from "@/components/ConfirmModal";
import { InstallAppButton } from "@/components/InstallAppButton";
import { usePwaInstall } from "@/lib/pwa-install";
import { toast } from "sonner";
import {
  LogOut,
  RefreshCw,
  Camera,
  ArrowUp,
  X,
  Square,
  Check,
  User,
  CalendarDays,
  UtensilsCrossed,
  Brain,
  Dumbbell,
  Flame,
  Play,
  ChevronRight,
} from "lucide-react";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { getCoach } from "@/lib/coaches";
import { clearAccountCache, hardNavigateToAuth, isUnauthorizedError } from "@/lib/client-session";
import { classifyChatTransportError } from "@/lib/chat-client-error";
import { isSameChatSubmission, type RetriableChatSubmission } from "@/lib/chat-submission";
import { shouldAutoKickoffCoach, userFacingChatMessages } from "@/lib/chat-bootstrap";
import { prepareChatImage } from "@/lib/image-upload";
import { usePwaUpdateBlocker, whilePwaUpdateBlocked } from "@/lib/pwa-update";
import { useLanguage } from "@/components/LanguageProvider";

function getCoachPortrait(id: string | null | undefined) {
  const coach = getCoach(id);
  return { ...coach, portrait: COACH_IMAGES[coach.id].avatar };
}

const ONBOARDING_OPENERS = {
  eli: {
    en: "I’m Eli. We’ll keep this simple. What should I call you?",
    sv: "Jag är Eli. Vi tar det enkelt. Vad ska jag kalla dig?",
  },
  rex: {
    en: "CT here. Let’s lock this in—what should I call you?",
    sv: "CT här. Nu kör vi—vad ska jag kalla dig?",
  },
  brutus: {
    en: "TANK IS HERE. NAME, ATHLETE?",
    sv: "TANK ÄR HÄR. NAMN, ATLET?",
  },
  maya: {
    en: "I’m Maya. We’ll build this comfortably—what should I call you?",
    sv: "Jag är Maya. Vi bygger det här tryggt—vad ska jag kalla dig?",
  },
  reya: {
    en: "Nova here. Let’s get you set up—what should I call you?",
    sv: "Nova här. Nu ställer vi in allt—vad ska jag kalla dig?",
  },
  nova: {
    en: "Athena. We begin with precision. What should I call you?",
    sv: "Athena. Vi börjar med precision. Vad ska jag kalla dig?",
  },
} as const;

function useChatViewport() {
  const [viewport, setViewport] = useState<{
    height: number | null;
    keyboardOpen: boolean;
  }>({ height: null, keyboardOpen: false });

  useEffect(() => {
    const visualViewport = window.visualViewport;
    let largestHeight = Math.round(visualViewport?.height ?? window.innerHeight);
    let orientationTimer: number | undefined;

    const sync = () => {
      const height = Math.round(visualViewport?.height ?? window.innerHeight);
      largestHeight = Math.max(largestHeight, height);

      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLInputElement &&
          !["button", "checkbox", "file", "radio", "submit"].includes(active.type));

      setViewport({
        height,
        keyboardOpen: isTyping && largestHeight - height > 100,
      });
    };

    const resetOrientationBaseline = () => {
      window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(() => {
        largestHeight = Math.round(visualViewport?.height ?? window.innerHeight);
        sync();
      }, 250);
    };

    sync();
    visualViewport?.addEventListener("resize", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("focusin", sync);
    window.addEventListener("focusout", sync);
    window.addEventListener("orientationchange", resetOrientationBaseline);

    return () => {
      window.clearTimeout(orientationTimer);
      visualViewport?.removeEventListener("resize", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("focusin", sync);
      window.removeEventListener("focusout", sync);
      window.removeEventListener("orientationchange", resetOrientationBaseline);
    };
  }, []);

  return viewport;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Phone/browser-local wall clock sent privately with each chat request. */
function clientLocalStamp(d = new Date()) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const offsetMinutes = -d.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offset = `${offsetSign}${pad2(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad2(Math.abs(offsetMinutes) % 60)}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}|${WEEKDAYS[d.getDay()]}|${pad2(d.getHours())}:${pad2(d.getMinutes())}|${timezone}|${offset}`;
}

function clientLocalContext(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function isDataEpochConflict(error: unknown) {
  return error instanceof Error && error.message.includes("data_epoch_conflict");
}

async function refreshAfterDataEpochConflict(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["profile"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-files"] }),
    queryClient.invalidateQueries({ queryKey: ["workout-session"] }),
    queryClient.invalidateQueries({ queryKey: ["nutrition"] }),
    queryClient.invalidateQueries({ queryKey: ["today-training"] }),
    queryClient.invalidateQueries({ queryKey: ["program"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

function formatTrackedTotal(
  exact: number | null | undefined,
  known: number | null | undefined,
  unknownCount: number | null | undefined,
  mealCount: number,
) {
  if (mealCount === 0) return "—";
  if (exact != null) return String(Math.round(exact));
  if ((unknownCount ?? 0) > 0) return `${Math.round(known ?? 0)} + ?`;
  return "—";
}

const TOOL_LABELS: Record<string, { en: string; sv: string }> = {
  load_skill: { en: "opening the playbook…", sv: "öppnar handboken…" },
  list_workspace: { en: "checking your workspace…", sv: "kontrollerar din arbetsyta…" },
  read_file: { en: "reading your notes…", sv: "läser dina anteckningar…" },
  save_workout_plan: { en: "saving your training plan…", sv: "sparar ditt träningsprogram…" },
  save_schedule: { en: "saving your weekly schedule…", sv: "sparar ditt veckoschema…" },
  save_nutrition_targets: { en: "saving your nutrition targets…", sv: "sparar dina kostmål…" },
  update_profile: { en: "saving your details…", sv: "sparar dina uppgifter…" },
  complete_onboarding: { en: "wrapping up setup…", sv: "slutför introduktionen…" },
  log_meal: { en: "logging that meal…", sv: "loggar måltiden…" },
  calc_program_timeline: { en: "structuring the mesocycle…", sv: "bygger programperioden…" },
  calc_starting_weights: {
    en: "calibrating your starting loads…",
    sv: "kalibrerar startvikterna…",
  },
  calc_nutrition_targets: {
    en: "calculating your calorie target…",
    sv: "beräknar ditt kalorimål…",
  },
  substitute_exercise: { en: "finding a swap…", sv: "hittar en ersättningsövning…" },
  shift_schedule_weeks: { en: "reshuffling the weeks…", sv: "flyttar programveckorna…" },
};

function deriveActivity(
  latest: UIMessage | undefined,
  status: string,
  coachName: string,
  language: "en" | "sv",
): string | null {
  if (status === "submitted")
    return language === "sv" ? `${coachName} tänker…` : `${coachName} is thinking…`;
  if (status !== "streaming") return null;
  if (!latest || latest.role !== "assistant")
    return language === "sv" ? `${coachName} tänker…` : `${coachName} is thinking…`;
  // Find the most recent in-progress tool part.
  for (let i = latest.parts.length - 1; i >= 0; i--) {
    const p = latest.parts[i] as { type?: string; state?: string };
    if (p.type?.startsWith("tool-")) {
      if (p.state === "output-available" || p.state === "output-error") break;
      const name = p.type.slice(5);
      const label = TOOL_LABELS[name]?.[language] ?? (language === "sv" ? "arbetar…" : "working…");
      return language === "sv" ? `${coachName} ${label}` : `${coachName} is ${label}`;
    }
    if (p.type === "text") break; // text streaming, no active tool
  }
  return language === "sv" ? `${coachName} skriver…` : `${coachName} is writing…`;
}

export const Route = createFileRoute("/_authenticated/chat")({
  validateSearch: (search: Record<string, unknown>): { settings?: boolean; start?: boolean } => ({
    ...(search.settings === true || search.settings === "true" ? { settings: true } : {}),
    ...(search.start === true || search.start === "true" ? { start: true } : {}),
  }),
  head: () => ({
    meta: [
      { title: "COACH — session" },
      {
        name: "description",
        content:
          "Talk with your AI gym coach, review saved schedules, workout plans, nutrition targets, and training memory.",
      },
      { property: "og:title", content: "COACH — session" },
      {
        property: "og:description",
        content:
          "Your AI gym coach session with saved plans, schedules, nutrition targets, and live training support.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context }) => {
    return context.queryClient.ensureQueryData({
      queryKey: ["profile"],
      queryFn: () => getProfile({ data: undefined }),
    });
  },
  component: () => (
    <Suspense fallback={<CenterSpinner />}>
      <ChatGate />
    </Suspense>
  ),
});

function CenterSpinner() {
  const { t } = useLanguage();
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <Shimmer>{t("common.loading")}</Shimmer>
    </div>
  );
}

function InfoStatusRow({
  Icon,
  label,
  message,
  onRetry,
}: {
  Icon: typeof Flame;
  label: string;
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{message}</div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 shrink-0 px-2 text-xs font-bold text-primary"
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

function ChatGate() {
  const { data: profile } = useSuspenseQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile({ data: undefined }),
    refetchInterval: 60_000,
  });
  if (!profile) return <CenterSpinner />;
  return <ChatScreen />;
}

type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
type WorkspaceFile = Awaited<ReturnType<typeof getWorkspaceFiles>>[number];

type SetupKey = "profile" | "schedule" | "baseline" | "meals";
type BuildKey = "schedule" | "plan" | "meals";

function setupStatus(profile: Profile) {
  return {
    profile: !!(
      profile.preferred_language &&
      profile.display_name &&
      profile.goal &&
      profile.experience &&
      profile.days_per_week &&
      profile.session_minutes &&
      profile.equipment &&
      profile.age &&
      profile.height_cm &&
      profile.weight_kg &&
      profile.sex
    ),
    schedule: !!profile.schedule_note,
    baseline: !!profile.recent_training_baseline,
    meals: !!(
      profile.activity_level &&
      profile.diet_style &&
      profile.meal_preferences &&
      profile.daily_calorie_target
    ),
  } as Record<SetupKey, boolean>;
}

function workspaceFile(files: WorkspaceFile[] | undefined, path: string) {
  return files?.find((file) => file.path === path) ?? null;
}

function buildStatus(profile: Profile, files: WorkspaceFile[] | undefined) {
  return {
    schedule: !!workspaceFile(files, "schedule/current.md"),
    plan: !!workspaceFile(files, "plans/current.md"),
    meals: !!workspaceFile(files, "nutrition/targets.md"),
  } as Record<BuildKey, boolean>;
}

function ChatScreen() {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const resetFn = useServerFn(resetOnboarding);
  const qc = useQueryClient();
  const { data: profile } = useSuspenseQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile({ data: undefined }),
    refetchInterval: 60_000,
  });
  const { data: workspaceFiles } = useSuspenseQuery({
    queryKey: ["workspace-files"],
    queryFn: () => getWorkspaceFiles({ data: undefined }),
    refetchInterval: 60_000,
  });
  const { data: initialMessages } = useSuspenseQuery({
    queryKey: ["chat-messages"],
    queryFn: () => getChatMessages({ data: undefined }),
    refetchInterval: 15_000,
  });
  const sessionQuery = useQuery({
    queryKey: ["workout-session"],
    queryFn: () => getActiveWorkoutSession({ data: undefined }),
    refetchInterval: 15_000,
  });
  const nutritionQuery = useQuery({
    queryKey: ["nutrition"],
    queryFn: () => getNutritionToday({ data: clientLocalContext() }),
    refetchInterval: 30_000,
  });
  const todayTrainingQuery = useQuery({
    queryKey: ["today-training"],
    queryFn: () => {
      const d = new Date();
      return getTodayTrainingInfo({
        data: {
          date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
          weekday: WEEKDAYS[d.getDay()],
        },
      });
    },
    refetchInterval: 60_000,
  });
  const session = sessionQuery.data;
  const nutrition = nutritionQuery.data;
  const todayTraining = todayTrainingQuery.data;
  const trackedNutrition = nutrition as
    | (typeof nutrition & {
        known_totals?: {
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
        };
        unknown_meals?: {
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
        };
        meal_count?: number;
      })
    | undefined;
  const mealCount = trackedNutrition?.meal_count ?? trackedNutrition?.meals.length ?? 0;
  const caloriesLabel = formatTrackedTotal(
    trackedNutrition?.calories,
    trackedNutrition?.known_totals?.calories,
    trackedNutrition?.unknown_meals?.calories,
    mealCount,
  );
  const proteinLabel = formatTrackedTotal(
    trackedNutrition?.protein_g,
    trackedNutrition?.known_totals?.protein_g,
    trackedNutrition?.unknown_meals?.protein_g,
    mealCount,
  );
  const carbsLabel = formatTrackedTotal(
    trackedNutrition?.carbs_g,
    trackedNutrition?.known_totals?.carbs_g,
    trackedNutrition?.unknown_meals?.carbs_g,
    mealCount,
  );
  const fatLabel = formatTrackedTotal(
    trackedNutrition?.fat_g,
    trackedNutrition?.known_totals?.fat_g,
    trackedNutrition?.unknown_meals?.fat_g,
    mealCount,
  );
  const knownCalories = trackedNutrition?.known_totals?.calories ?? trackedNutrition?.calories ?? 0;
  const coach = getCoachPortrait((profile as Profile).coach_id);
  const { height: viewportHeight, keyboardOpen } = useChatViewport();

  const [openSection, setOpenSection] = useState<SetupKey | "all" | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [processingImage, setProcessingImage] = useState(false);
  const [workoutMutations, setWorkoutMutations] = useState(0);
  const [kickoffFailed, setKickoffFailed] = useState(false);
  const pendingSubmission = useRef<RetriableChatSubmission<File> | null>(null);
  const failedSubmission = useRef<RetriableChatSubmission<File> | null>(null);
  const kickoffMessageId = useRef<string | null>(null);
  const kickoffInFlight = useRef(false);
  const startIntentHandled = useRef(false);
  const clearChatErrorRef = useRef<() => void>(() => undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getCurrentUser({ data: undefined })
      .then((user) => setUserEmail(user?.email ?? null))
      .catch((error) => {
        if (isUnauthorizedError(error)) void hardNavigateToAuth(qc);
      });
  }, [qc]);

  useEffect(() => {
    if (search.settings) setOpenSection("all");
  }, [search.settings]);

  // Private, invite-only app: any signed-in user can self-reset their own data.
  const isAdmin = !!userEmail;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          // Auth rides on the httpOnly session cookie (same-origin request).
          const headers = new Headers(init?.headers);
          headers.set("X-Client-Local", clientLocalStamp());
          return fetch(input, { ...init, headers, credentials: "same-origin" });
        }) as typeof fetch,
      }),
    [],
  );

  const { messages, sendMessage, status, stop, setMessages, clearError } = useChat({
    id: "coach",
    messages: initialMessages as UIMessage[],
    transport,
    onError: (err) => {
      if (isUnauthorizedError(err)) {
        void hardNavigateToAuth(qc);
        return;
      }
      const transportError = classifyChatTransportError(err);
      if (transportError === "already_processed") {
        pendingSubmission.current = null;
        failedSubmission.current = null;
        kickoffInFlight.current = false;
        setKickoffFailed(false);
        void (async () => {
          await qc.invalidateQueries({ queryKey: ["chat-messages"], refetchType: "none" });
          await qc.refetchQueries({ queryKey: ["chat-messages"], type: "active" });
          clearChatErrorRef.current();
        })().catch(() => {
          toast.error(
            language === "sv"
              ? "Ditt svar sparades men kunde inte synkroniseras. Uppdatera för att hämta det."
              : "Your reply was saved, but could not sync. Refresh to recover it.",
          );
        });
        return;
      }
      if (transportError === "message_id_conflict") {
        pendingSubmission.current = null;
        failedSubmission.current = null;
        kickoffInFlight.current = false;
        setKickoffFailed(false);
        void (async () => {
          await qc.invalidateQueries({ queryKey: ["chat-messages"], refetchType: "none" });
          await qc.refetchQueries({ queryKey: ["chat-messages"], type: "active" });
          clearChatErrorRef.current();
        })().catch(() => {
          toast.error(
            language === "sv"
              ? "Uppdatera innan du skickar ett nytt meddelande."
              : "Refresh before sending another message.",
          );
        });
        toast.error(
          language === "sv"
            ? "Meddelandet kunde inte skickas säkert. Skriv ett nytt meddelande."
            : "That message could not be sent safely. Please write a new message.",
        );
        return;
      }
      const failed = pendingSubmission.current;
      pendingSubmission.current = null;
      if (kickoffInFlight.current) {
        kickoffInFlight.current = false;
        setKickoffFailed(true);
      }
      if (failed) {
        failedSubmission.current = failed;
        setInput((current) => current || failed.text);
        setPendingFiles((current) => (current.length ? current : failed.files));
      }
      toast.error(err.message || t("chat.chat_failed"));
    },
    onFinish: ({ isError }) => {
      if (!isError) {
        pendingSubmission.current = null;
        failedSubmission.current = null;
        kickoffInFlight.current = false;
        setKickoffFailed(false);
      }
      // Tool calls may have mutated any module — refetch so live panels update.
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["workspace-files"] });
      qc.invalidateQueries({ queryKey: ["workout-session"] });
      qc.invalidateQueries({ queryKey: ["nutrition"] });
      qc.invalidateQueries({ queryKey: ["today-training"] });
      qc.invalidateQueries({ queryKey: ["chat-messages"] });
    },
  });
  clearChatErrorRef.current = clearError;

  const lastSyncedMessages = useRef(initialMessages);
  useEffect(() => {
    if (status === "ready" && initialMessages !== lastSyncedMessages.current) {
      lastSyncedMessages.current = initialMessages;
      setMessages(initialMessages as UIMessage[]);
    }
  }, [initialMessages, status, setMessages]);

  useEffect(() => {
    if (status !== "ready") return;
    setMessages((current) => {
      let changed = false;
      const sanitized = current.map((message) => {
        const parts = message.parts.filter((part) => part.type !== "file");
        if (parts.length === message.parts.length) return message;
        changed = true;
        return { ...message, parts };
      });
      return changed ? sanitized : current;
    });
  }, [status, setMessages]);

  const busy = status === "submitted" || status === "streaming";
  usePwaUpdateBlocker(
    "chat-composer",
    busy || workoutMutations > 0 || processingImage || input.length > 0 || pendingFiles.length > 0,
  );
  const status_ = setupStatus(profile as Profile);
  const doneCount = Object.values(status_).filter(Boolean).length;
  const totalSteps = Object.keys(status_).length;
  const inOnboarding = !(profile as Profile).onboarding_completed;
  const buildStatus_ = buildStatus(profile as Profile, workspaceFiles);
  const buildDoneCount = Object.values(buildStatus_).filter(Boolean).length;
  const buildTotalSteps = Object.keys(buildStatus_).length;

  // After onboarding, auto-boot the coach to keep driving the build (plan,
  // meals…) until everything is set up. Fresh onboarding uses an instant local
  // opener below, so it can never be blocked by a failed model request.
  const buildIncomplete = buildDoneCount < buildTotalSteps;
  const visibleMessageCount = userFacingChatMessages(messages).length;
  const kicked = useRef(false);
  useEffect(() => {
    if (
      !kicked.current &&
      shouldAutoKickoffCoach({
        messages,
        inOnboarding,
        buildIncomplete,
        status,
      })
    ) {
      kicked.current = true;
      kickoffInFlight.current = true;
      setKickoffFailed(false);
      kickoffMessageId.current ??= crypto.randomUUID();
      void sendMessage({
        text: "__begin__",
        messageId: kickoffMessageId.current,
      }).catch(() => {
        // useChat's onError exposes the setup retry state.
      });
    }
  }, [
    inOnboarding,
    buildIncomplete,
    visibleMessageCount,
    messages,
    status,
    sendMessage,
    kickoffFailed,
  ]);

  // When onboarding finishes, clear the chat into a fresh session — and re-arm
  // the kickoff so the coach immediately continues with the build steps.
  const wasOnboarding = useRef(inOnboarding);
  useEffect(() => {
    if (wasOnboarding.current && !inOnboarding) {
      setMessages([]);
      kicked.current = false;
      kickoffMessageId.current = null;
    }
    wasOnboarding.current = inOnboarding;
  }, [inOnboarding, setMessages]);

  async function submit() {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || busy) return;
    const submittedText =
      text ||
      (language === "sv"
        ? "Vad är det här? Logga det om det är mat."
        : "What's this? Log it if it's food.");
    const submittedFiles = [...pendingFiles];
    const files = submittedFiles.length ? toFileList(submittedFiles) : undefined;
    const retry = failedSubmission.current;
    const messageId = isSameChatSubmission(retry, submittedText, submittedFiles)
      ? retry!.messageId
      : crypto.randomUUID();
    failedSubmission.current = null;
    pendingSubmission.current = { messageId, text: submittedText, files: submittedFiles };
    setInput("");
    setPendingFiles([]);
    void sendMessage({ text: submittedText, files, messageId }).catch(() => {
      // useChat's onError restores the in-memory draft and shows the error.
    });
  }

  async function onPickFiles(list: FileList | null) {
    if (!list || processingImage) return;
    const available = Math.max(0, 3 - pendingFiles.length);
    if (available === 0) {
      toast.error(t("chat.max_photos"));
      return;
    }
    setProcessingImage(true);
    const prepared: File[] = [];
    try {
      for (const file of Array.from(list).slice(0, available)) {
        try {
          prepared.push(await prepareChatImage(file));
        } catch (error) {
          toast.error(
            language === "en" && error instanceof Error ? error.message : t("chat.photo_failed"),
          );
        }
      }
      if (prepared.length) setPendingFiles((current) => [...current, ...prepared].slice(0, 3));
    } finally {
      setProcessingImage(false);
    }
  }

  async function signOut() {
    try {
      await logout({ data: undefined });
      await clearAccountCache(qc);
      window.location.replace("/auth");
    } catch (error) {
      toast.error(
        language === "en" && error instanceof Error ? error.message : t("chat.signout_failed"),
      );
    }
  }

  async function fullReset() {
    try {
      await whilePwaUpdateBlocked("account-reset", () => resetFn({ data: undefined }));
      await clearAccountCache(qc);
      try {
        await logout({ data: undefined });
      } catch {
        // A successful full reset may already have invalidated this session.
      }
      window.location.replace("/");
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await hardNavigateToAuth(qc);
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : language === "sv"
            ? "Kunde inte återställa ditt konto"
            : "Could not reset your account",
      );
    }
  }

  function explainAgain() {
    if (busy) return;
    void sendMessage({
      text:
        language === "sv"
          ? "Kan du förklara det igen, långsammare och med ett exempel?"
          : "Can you explain that again, slower and with an example?",
    });
  }

  async function startWorkout() {
    if (session || workoutMutations > 0) return;
    setWorkoutMutations((count) => count + 1);
    try {
      const d = new Date();
      const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const requestId = crypto.randomUUID();
      const result = await whilePwaUpdateBlocked("workout-start", () =>
        startTodayWorkoutSession({
          data: {
            date,
            request_id: requestId,
            expected_data_epoch: (profile as Profile).data_epoch,
          },
        }),
      );
      if (!result.ok) {
        toast.error(result.coach_note ?? t("chat.start_failed"));
        return;
      }
      toast.success(
        result.session?.title
          ? language === "sv"
            ? `${result.session.title} är klart`
            : `${result.session.title} ready`
          : t("chat.workout_ready"),
      );
      if (!busy) {
        void sendMessage({ text: "__ui_event__ started today's workout from the app" });
      }
    } catch (error) {
      if (isDataEpochConflict(error)) {
        await refreshAfterDataEpochConflict(qc);
        toast.error(t("chat.account_changed"));
        return;
      }
      if (isUnauthorizedError(error)) {
        await hardNavigateToAuth(qc);
        return;
      }
      toast.error(
        language === "en" && error instanceof Error ? error.message : t("chat.start_failed"),
      );
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["workout-session"] }),
        qc.invalidateQueries({ queryKey: ["today-training"] }),
      ]);
      setWorkoutMutations((count) => Math.max(0, count - 1));
    }
  }

  useEffect(() => {
    if (!search.start || startIntentHandled.current || sessionQuery.isPending) return;
    startIntentHandled.current = true;
    void navigate({ to: "/chat", search: {}, replace: true });
    if (!session && !sessionQuery.isError) void startWorkout();
    // The URL intent is consumed once; startWorkout deliberately uses the latest query state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.start, session, sessionQuery.isPending, sessionQuery.isError, navigate]);

  async function toggleSet(
    setId: string,
    expectedRevision: number,
    completed: boolean,
    exerciseName: string,
    lastOfExercise: boolean,
    weight_kg?: number | null,
    reps?: number | null,
  ): Promise<SetSaveOutcome> {
    setWorkoutMutations((count) => count + 1);
    try {
      const result = await whilePwaUpdateBlocked("workout-set-save", () =>
        toggleSessionSet({
          data: {
            set_id: setId,
            expected_data_epoch: (profile as Profile).data_epoch,
            expected_revision: expectedRevision,
            completed,
            weight_kg,
            reps,
          },
        }),
      );
      if (!result.ok) {
        if (result.error === "set_revision_conflict") {
          qc.setQueryData(["workout-session"], result.session);
          toast.error(
            language === "sv"
              ? "Setet ändrades på en annan enhet. Senaste värden har lästs in; granska och försök igen."
              : "That set changed on another device. Latest values loaded; review and retry.",
          );
          return {
            ok: false,
            conflict: true,
            latestSet: result.latest_set ?? null,
          };
        }
        toast.error(
          result.error === "actual_set_data_required"
            ? language === "sv"
              ? "Ange vikten och repetitionerna du faktiskt genomförde."
              : "Enter the weight and reps you actually completed."
            : language === "sv"
              ? "Kunde inte spara setet. Senaste passet har lästs in."
              : "Could not save that set. Reloaded the latest workout.",
        );
        return { ok: false };
      }
      if (completed && lastOfExercise && !busy) {
        void sendMessage({
          text: `__ui_event__ finished all sets of "${exerciseName}" in the workout panel`,
        });
      }
      return { ok: true };
    } catch (error) {
      if (isDataEpochConflict(error)) {
        await refreshAfterDataEpochConflict(qc);
        toast.error(t("chat.account_changed"));
        return { ok: false };
      }
      if (isUnauthorizedError(error)) {
        await hardNavigateToAuth(qc);
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : language === "sv"
              ? "Kunde inte spara setet"
              : "Could not save that set",
        );
      }
      return { ok: false };
    } finally {
      await qc.invalidateQueries({ queryKey: ["workout-session"] });
      setWorkoutMutations((count) => Math.max(0, count - 1));
    }
  }

  async function finishWorkout() {
    if (!session || workoutMutations > 0) return;
    setWorkoutMutations((count) => count + 1);
    try {
      const result = await whilePwaUpdateBlocked("workout-finish", () =>
        completeActiveSession({
          data: {
            session_id: session.id,
            expected_data_epoch: (profile as Profile).data_epoch,
          },
        }),
      );
      if (!result.ok) {
        toast.error(result.coach_note);
        return;
      }
      toast.success(
        language === "sv" ? "Passet är klart — snyggt jobbat 🎉" : "Workout done — nice work 🎉",
      );
      if (!busy) {
        void sendMessage({
          text: result.cycle_completed
            ? `__ui_event__ tapped 'Finish workout' — session complete and "${result.program_name ?? "the program"}" cycle complete`
            : "__ui_event__ tapped 'Finish workout' — session complete",
        });
      }
    } catch (error) {
      if (isDataEpochConflict(error)) {
        await refreshAfterDataEpochConflict(qc);
        toast.error(t("chat.account_changed"));
        return;
      }
      if (isUnauthorizedError(error)) {
        await hardNavigateToAuth(qc);
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : language === "sv"
              ? "Kunde inte avsluta passet"
              : "Could not finish the workout",
        );
      }
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["workout-session"] }),
        qc.invalidateQueries({ queryKey: ["program"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
        qc.invalidateQueries({ queryKey: ["today-training"] }),
      ]);
      setWorkoutMutations((count) => Math.max(0, count - 1));
    }
  }

  // Hide internal markers (kickoff + UI events) from the transcript.
  const visibleMessages = userFacingChatMessages(messages);
  const latest = visibleMessages[visibleMessages.length - 1];
  const latestText = latest
    ? latest.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
    : "";
  const latestImages: Array<{ url: string }> =
    latest?.parts
      .filter((p) => p.type === "file")
      .map((p) => {
        const rec = p as unknown as { url?: string };
        return typeof rec.url === "string" ? { url: rec.url } : null;
      })
      .filter((x): x is { url: string } => x !== null) ?? [];

  const activity = deriveActivity(latest, status, coach.name, language);

  const firstName = (profile as Profile)?.display_name?.split(" ")[0] || "athlete";
  const onboardingOpener =
    (profile as Profile).preferred_language === null
      ? `${coach.name}. English or svenska?`
      : ONBOARDING_OPENERS[coach.id][language];

  const steps: Array<{ key: SetupKey; label: string; Icon: typeof User }> = [
    { key: "profile", label: t("chat.profile_step"), Icon: User },
    { key: "schedule", label: t("chat.schedule_step"), Icon: CalendarDays },
    { key: "baseline", label: t("chat.baseline_step"), Icon: Dumbbell },
    { key: "meals", label: t("chat.meals_step"), Icon: UtensilsCrossed },
  ];

  const buildSteps: Array<{ key: BuildKey; label: string; Icon: typeof User }> = [
    { key: "schedule", label: t("chat.schedule_step"), Icon: CalendarDays },
    { key: "plan", label: t("chat.plan_step"), Icon: Dumbbell },
    { key: "meals", label: t("chat.meals_step"), Icon: UtensilsCrossed },
  ];

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden bg-background"
      style={{ height: viewportHeight ? `${viewportHeight}px` : "100dvh" }}
    >
      {/* Header */}
      <header
        className={`shrink-0 border-b border-border bg-card px-3 pt-[max(0.5rem,env(safe-area-inset-top))] ${
          keyboardOpen ? "pb-2" : "pb-3"
        }`}
      >
        <div className={`${keyboardOpen ? "" : "mb-2.5"} flex items-center justify-between gap-2`}>
          <div className="flex items-center gap-2.5">
            <img
              src={coach.portrait}
              alt={coach.name}
              className="h-12 w-12 rounded-xl object-cover object-top ring-1 ring-primary/50"
            />
            <div className="flex flex-col justify-center leading-tight">
              <span className="font-display text-xl font-bold uppercase tracking-wide text-foreground">
                {coach.name}
              </span>
              {inOnboarding ? (
                <span className="mt-1 font-display text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                  </span>
                  {t("chat.onboarding")} · {doneCount}/{totalSteps}
                </span>
              ) : buildDoneCount < buildTotalSteps ? (
                <span className="mt-1 font-display text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400/80">
                  {t("chat.build")} · {buildDoneCount}/{buildTotalSteps}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={signOut}
              type="button"
              className="grid h-11 w-11 place-items-center rounded-lg text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
              aria-label={t("chat.sign_out")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Setup progress steps — only during onboarding */}
        {inOnboarding && !keyboardOpen && (
          <>
            <div className="flex items-center gap-2">
              {steps.map((s, i) => {
                const done = status_[s.key];
                const isCurrent = !done && steps.slice(0, i).every((prev) => status_[prev.key]);
                return (
                  <button
                    key={s.key}
                    disabled
                    className="group flex flex-1 flex-col items-center gap-1 disabled:cursor-default"
                    aria-label={`${s.label} — ${
                      done
                        ? t("common.done")
                        : isCurrent
                          ? t("common.in_progress")
                          : t("common.pending")
                    }`}
                  >
                    <div className="flex w-full items-center gap-1">
                      <div
                        className={`grid h-8 flex-1 place-items-center rounded-lg border transition-all ${
                          done
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            : isCurrent
                              ? "animate-pulse border-primary bg-primary/20 text-primary shadow-[0_0_20px_-4px] shadow-primary/60 scale-105"
                              : "border-border bg-secondary/40 text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <s.Icon className="h-3.5 w-3.5" />
                          {done ? (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          ) : (
                            <span className="font-display text-[9px] font-bold">{i + 1}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`font-display text-[9px] font-bold uppercase tracking-[0.14em] ${
                        isCurrent
                          ? "text-primary"
                          : done
                            ? "text-emerald-400/80"
                            : "text-muted-foreground"
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${(doneCount / totalSteps) * 100}%` }}
              />
            </div>
          </>
        )}

        {!inOnboarding && !keyboardOpen && buildDoneCount < buildTotalSteps && (
          <>
            <div className="flex items-center gap-2">
              {buildSteps.map((s, i) => {
                const done = buildStatus_[s.key];
                const isCurrent =
                  !done && buildSteps.slice(0, i).every((prev) => buildStatus_[prev.key]);
                return (
                  <button
                    key={s.key}
                    onClick={() => setOpenSection("all")}
                    className="group flex flex-1 flex-col items-center gap-1"
                    aria-label={`${s.label} — ${
                      done
                        ? t("common.done")
                        : isCurrent
                          ? t("common.in_progress")
                          : t("common.pending")
                    }`}
                  >
                    <div
                      className={`grid h-8 w-full place-items-center rounded-lg border transition-all ${
                        done
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : isCurrent
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-secondary/40 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <s.Icon className="h-3.5 w-3.5" />
                        {done ? (
                          <Check className="h-3 w-3" strokeWidth={3} />
                        ) : (
                          <span className="font-display text-[9px] font-bold">{i + 1}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`font-display text-[9px] font-bold uppercase tracking-[0.14em] ${
                        isCurrent
                          ? "text-primary"
                          : done
                            ? "text-emerald-400/80"
                            : "text-muted-foreground"
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full transition-all duration-500 ${
                  buildDoneCount === buildTotalSteps ? "bg-emerald-400" : "bg-primary"
                }`}
                style={{ width: `${(buildDoneCount / buildTotalSteps) * 100}%` }}
              />
            </div>
          </>
        )}

        {/* Two fixed information rows — calories, then workout. */}
        {!inOnboarding && !keyboardOpen && (
          <div className="-mx-3 mt-3 divide-y divide-border border-t border-border bg-background/50">
            {nutritionQuery.isPending && !nutrition ? (
              <InfoStatusRow
                Icon={Flame}
                label={t("chat.calories")}
                message={t("chat.loading_totals")}
              />
            ) : nutritionQuery.isError && !nutrition ? (
              <InfoStatusRow
                Icon={Flame}
                label={t("chat.calories_unavailable")}
                message={
                  language === "sv"
                    ? "Inget ändrades. Kontrollera anslutningen."
                    : "Nothing was changed. Check your connection."
                }
                onRetry={() => void nutritionQuery.refetch()}
              />
            ) : (
              <div className="flex min-h-12 items-center gap-3 px-3 py-2">
                <Flame className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("chat.calories")}
                    </span>
                    {nutritionQuery.isError ? (
                      <button
                        type="button"
                        onClick={() => void nutritionQuery.refetch()}
                        className="min-h-11 shrink-0 text-[11px] font-bold text-amber-300"
                      >
                        {language === "sv" ? "Senast synkat · försök igen" : "Last synced · retry"}
                      </button>
                    ) : (
                      <span className="truncate text-[11px] text-muted-foreground">
                        P {proteinLabel}g · C {carbsLabel}g · F {fatLabel}g
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <span className="shrink-0 text-sm font-bold text-foreground">
                      {caloriesLabel}
                      {nutrition?.target_calories ? ` / ${nutrition.target_calories}` : ""} kcal
                    </span>
                    {nutrition?.target_calories ? (
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(100, (knownCalories / nutrition.target_calories) * 100)}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            {sessionQuery.isPending && !session ? (
              <InfoStatusRow
                Icon={Dumbbell}
                label={t("chat.workout")}
                message={
                  language === "sv"
                    ? "Kontrollerar dagens träningspass…"
                    : "Checking today’s workout…"
                }
              />
            ) : session ? (
              <SessionTimerBar
                session={session}
                minutes={(profile as Profile).session_minutes ?? 60}
              />
            ) : sessionQuery.isError ? (
              <InfoStatusRow
                Icon={Dumbbell}
                label={t("chat.workout_unavailable")}
                message={
                  language === "sv"
                    ? "Ditt sparade pass finns kvar på servern."
                    : "Your saved workout is safe on the server."
                }
                onRetry={() => void sessionQuery.refetch()}
              />
            ) : todayTrainingQuery.isPending && !todayTraining ? (
              <InfoStatusRow
                Icon={Dumbbell}
                label={t("chat.workout")}
                message={t("chat.loading_workout")}
              />
            ) : todayTrainingQuery.isError && !todayTraining ? (
              <InfoStatusRow
                Icon={Dumbbell}
                label={language === "sv" ? "Programmet är inte tillgängligt" : "Plan unavailable"}
                message={
                  language === "sv"
                    ? "Kunde inte bekräfta om i dag är en träningsdag."
                    : "Could not confirm whether today is a training day."
                }
                onRetry={() => void todayTrainingQuery.refetch()}
              />
            ) : (
              <div className="flex min-h-12 items-center gap-3 px-3 py-2">
                <Dumbbell className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    {t("chat.workout")}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-semibold text-foreground">
                      {todayTraining?.label ?? (language === "sv" ? "Vilodag" : "Rest day")}
                    </span>
                    {todayTraining?.detail && (
                      <span className="shrink-0 text-muted-foreground">
                        {todayTraining.detail === "today"
                          ? t("common.today")
                          : todayTraining.detail}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Single-message stage */}
      <main
        className={`flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-5 ${
          keyboardOpen ? "py-3" : "py-6"
        }`}
      >
        {!latest && (
          <div className="mx-auto max-w-md text-center">
            {inOnboarding ? (
              <p className="text-[15px] leading-relaxed text-foreground">{onboardingOpener}</p>
            ) : kickoffFailed ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {language === "sv"
                    ? `Kunde inte nå ${coach.name}. Din konfiguration är säker.`
                    : `Couldn’t reach ${coach.name}. Your setup is safe.`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    kicked.current = false;
                    setKickoffFailed(false);
                  }}
                  className="mt-3 min-h-11 rounded-xl border border-primary/60 px-4 text-sm font-bold text-primary"
                >
                  {t("common.retry")}
                </button>
              </>
            ) : buildIncomplete ? (
              <Shimmer>
                {language === "sv"
                  ? `${coach.name} förbereder nästa steg…`
                  : `${coach.name} is preparing the next step…`}
              </Shimmer>
            ) : (
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                {language === "sv"
                  ? `Fråga ${coach.name} vad du vill eller tryck på Program för att se dagens pass.`
                  : `Ask ${coach.name} anything, or tap Program to see today's session.`}
              </p>
            )}
          </div>
        )}

        {latest && (
          <div
            key={latest.id}
            className="mx-auto flex max-h-full min-h-0 w-full max-w-md flex-col gap-4 overflow-y-auto overscroll-contain py-1 animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            {latest.role === "assistant" ? (
              <div className="flex flex-col items-center gap-3 text-center">
                {activity && <Shimmer>{activity}</Shimmer>}
                {latestText && (
                  <div className="prose prose-sm prose-invert max-w-full text-[15px] leading-relaxed text-foreground prose-p:my-2 prose-li:my-0 prose-headings:mt-3 prose-headings:mb-2 prose-strong:text-foreground">
                    <ReactMarkdown>{latestText}</ReactMarkdown>
                  </div>
                )}
                {inOnboarding && status === "ready" && latestText && (
                  <button
                    type="button"
                    onClick={explainAgain}
                    className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border bg-secondary/40 px-3 font-display text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:border-primary hover:text-primary"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t("chat.explain_again")}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-end gap-3">
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  {language === "sv" ? "Du" : "You"}
                </div>
                {latestImages.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {latestImages.map((p, i) => (
                      <img
                        key={i}
                        src={p.url}
                        alt=""
                        className="h-32 w-32 rounded-xl object-cover ring-1 ring-border"
                      />
                    ))}
                  </div>
                )}
                {latestText && (
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm font-medium leading-relaxed text-primary-foreground">
                    <div className="whitespace-pre-wrap">{latestText}</div>
                  </div>
                )}
                {activity && (
                  <div className="mt-2 flex items-center gap-2 self-start">
                    <div className="relative">
                      <img
                        src={coach.portrait}
                        alt=""
                        className="h-8 w-8 animate-pulse rounded-lg object-cover object-top ring-2 ring-primary"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                      </span>
                    </div>
                    <Shimmer>{activity}</Shimmer>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Pending attachments preview */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {pendingFiles.map((f, i) => {
            return (
              <PendingImage
                key={`${f.name}-${f.lastModified}-${i}`}
                file={f}
                onRemove={() => setPendingFiles((prev) => prev.filter((_, x) => x !== i))}
              />
            );
          })}
        </div>
      )}

      {/* Live workout module — coach is connected in real time */}
      {!inOnboarding && !keyboardOpen && (
        <div className="border-t border-border bg-card/40 px-3 py-2">
          {sessionQuery.isPending && !session ? (
            <div className="flex min-h-11 items-center justify-center">
              <Shimmer>
                {language === "sv" ? "Kontrollerar träningspasset…" : "Checking workout…"}
              </Shimmer>
            </div>
          ) : session ? (
            <>
              {sessionQuery.isError && (
                <button
                  type="button"
                  onClick={() => void sessionQuery.refetch()}
                  className="mb-2 min-h-11 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-300"
                >
                  {language === "sv"
                    ? "Synkronisering av passet pausad · Försök igen"
                    : "Workout sync paused · Retry"}
                </button>
              )}
              <WorkoutPanel
                session={session}
                onToggleSet={toggleSet}
                onFinish={finishWorkout}
                disabled={workoutMutations > 0}
              />
            </>
          ) : sessionQuery.isError ? (
            <button
              type="button"
              onClick={() => void sessionQuery.refetch()}
              className="min-h-11 w-full rounded-xl border border-border px-3 text-sm font-bold text-primary"
            >
              {language === "sv"
                ? "Kunde inte läsa in passet · Försök igen"
                : "Couldn’t load the workout · Retry"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startWorkout()}
              disabled={workoutMutations > 0}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
            >
              {workoutMutations > 0 ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}{" "}
              {workoutMutations > 0
                ? language === "sv"
                  ? "Startar…"
                  : "Starting…"
                : t("chat.start_workout")}
            </button>
          )}
        </div>
      )}

      {/* Composer */}
      <div
        className={`shrink-0 border-t border-border bg-background px-3 pt-3 ${
          keyboardOpen ? "pb-2" : "pb-3"
        }`}
      >
        <div className="flex items-end gap-2">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={processingImage || busy}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
            aria-label={t("chat.take_photo")}
          >
            {processingImage ? (
              <RefreshCw className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            enterKeyHint="send"
            placeholder={t("chat.ask", { name: coach.name })}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none sm:text-[15px]"
          />
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={busy ? () => stop() : submit}
            disabled={processingImage || (!busy && !input.trim() && pendingFiles.length === 0)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition disabled:opacity-40"
            aria-label={busy ? (language === "sv" ? "Stoppa" : "Stop") : t("chat.send")}
          >
            {busy ? (
              <Square className="h-4 w-4" />
            ) : (
              <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {!keyboardOpen && <TabBar />}

      {/* Settings drawer */}
      {openSection && (
        <SettingsDrawer
          profile={profile as Profile}
          onClose={() => {
            setOpenSection(null);
            if (search.settings) {
              void navigate({ to: "/chat", search: {}, replace: true });
            }
          }}
          isAdmin={isAdmin}
          onAdminReset={fullReset}
        />
      )}
    </div>
  );
}

function PendingImage({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t } = useLanguage();
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <div className="relative">
      <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
      <button
        onClick={onRemove}
        type="button"
        className="absolute -right-2 -top-2 grid h-11 w-11 place-items-center rounded-full bg-background/95 ring-1 ring-border"
        aria-label={t("chat.remove_photo")}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

type WorkoutSession = NonNullable<Awaited<ReturnType<typeof getActiveWorkoutSession>>>;
type WorkoutSet = WorkoutSession["exercises"][number]["sets"][number];
type SetSaveOutcome =
  | { ok: true }
  | { ok: false; conflict?: false }
  | { ok: false; conflict: true; latestSet: WorkoutSet | null };

function SessionTimerBar({ session, minutes }: { session: WorkoutSession; minutes: number }) {
  const { t } = useLanguage();
  // Local 1s ticker so only this bar re-renders each second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const started = new Date(session.started_at).getTime();
  const totalMs = Math.max(1, minutes) * 60_000;
  const elapsed = Math.max(0, now - started);
  const remaining = totalMs - elapsed;
  const over = remaining < 0;
  const mmss = (ms: number) => {
    const s = Math.floor(Math.abs(ms) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const pct = Math.min(100, (elapsed / totalMs) * 100);

  return (
    <div className="flex min-h-12 items-center gap-3 bg-primary/[0.04] px-3 py-2">
      <Dumbbell className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.16em] text-primary">
            {t("chat.live_workout")}
          </span>
          <span
            className={`shrink-0 font-display text-xs font-bold ${over ? "text-red-400" : "text-foreground"}`}
          >
            {over ? `+${mmss(remaining)}` : mmss(remaining)}
            <span className="ml-2 text-emerald-400">
              {session.done}/{session.total}
            </span>
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
            {session.title}
          </span>
          <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all ${over ? "bg-red-400" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkoutPanel({
  session,
  onToggleSet,
  onFinish,
  disabled,
}: {
  session: WorkoutSession;
  onToggleSet: (
    setId: string,
    expectedRevision: number,
    completed: boolean,
    exerciseName: string,
    lastOfExercise: boolean,
    weight_kg?: number | null,
    reps?: number | null,
  ) => Promise<SetSaveOutcome>;
  onFinish: () => void;
  disabled: boolean;
}) {
  const { language, t } = useLanguage();
  const allDone = session.total > 0 && session.done === session.total;
  const [expanded, setExpanded] = useState<string | null>(session.next?.id ?? null);
  const firstExerciseId = session.exercises[0]?.id ?? null;

  useEffect(() => {
    setExpanded(session.next?.id ?? firstExerciseId);
  }, [session.id, session.next?.id, firstExerciseId]);

  return (
    <div className="max-h-[38dvh] overflow-y-auto rounded-xl border border-border bg-background p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          <Dumbbell className="h-3.5 w-3.5 text-primary" /> {session.title}
        </div>
        <span className="font-display text-[10px] font-bold text-emerald-400">
          {session.done}/{session.total}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {session.exercises.map((e) => {
          const exerciseName = language === "sv" ? e.name_sv : e.name_en;
          const hasSets = e.sets.length > 0;
          const doneSets = e.sets.filter((s) => s.completed).length;
          const open = expanded === e.id;
          return (
            <div key={e.id} className="rounded-lg border border-border/60 bg-card/50">
              <div className="flex min-h-11 items-center gap-2 px-2">
                <span
                  aria-label={
                    e.completed
                      ? t("chat.exercise_complete", { name: exerciseName })
                      : t("chat.exercise_incomplete", { name: exerciseName })
                  }
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
                    e.completed
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                      : "border-border"
                  }`}
                >
                  {e.completed && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : e.id)}
                  className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left text-xs"
                  aria-expanded={open}
                >
                  <span
                    className={`truncate ${e.completed ? "text-muted-foreground line-through" : "text-foreground"}`}
                  >
                    {exerciseName}
                    {e.target ? ` — ${e.target}` : ""}
                  </span>
                  {hasSets && (
                    <span className="shrink-0 font-display text-[10px] font-bold text-muted-foreground">
                      {doneSets}/{e.sets.length}
                    </span>
                  )}
                </button>
              </div>
              {open && hasSets && (
                <div className="flex flex-col gap-1 border-t border-border/60 px-2 py-1.5">
                  {e.sets.map((s) => {
                    const remainingAfter = e.sets.filter(
                      (x) => !x.completed && x.id !== s.id,
                    ).length;
                    return (
                      <SetRow
                        key={s.id}
                        set={s}
                        disabled={disabled}
                        onToggle={(expectedRevision, completed, weight, reps) =>
                          onToggleSet(
                            s.id,
                            expectedRevision,
                            completed,
                            exerciseName,
                            remainingAfter === 0,
                            weight,
                            reps,
                          )
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {allDone && (
        <button
          type="button"
          onClick={onFinish}
          disabled={disabled}
          className="mt-2 min-h-11 w-full rounded-lg bg-emerald-500/20 px-3 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {t("chat.finish_workout")}
        </button>
      )}
    </div>
  );
}

function SetRow({
  set,
  onToggle,
  disabled,
}: {
  set: WorkoutSession["exercises"][number]["sets"][number];
  onToggle: (
    expectedRevision: number,
    completed: boolean,
    weight_kg?: number | null,
    reps?: number | null,
  ) => Promise<SetSaveOutcome>;
  disabled: boolean;
}) {
  const { t } = useLanguage();
  const enrichedSet = set as typeof set & { target_weight_kg?: number | null };
  const serverWeight = set.weight_kg != null ? String(set.weight_kg) : "";
  const serverReps = set.reps != null ? String(set.reps) : "";
  const [weight, setWeight] = useState(set.weight_kg != null ? String(set.weight_kg) : "");
  const [reps, setReps] = useState(set.reps != null ? String(set.reps) : "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editRevisionRef = useRef(set.revision);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverSignature = `${serverWeight}|${serverReps}|${set.completed}|${set.revision}`;
  const lastServerSignature = useRef(serverSignature);
  const rowId = useId();

  usePwaUpdateBlocker(`workout-set-${set.id}-${rowId}`, dirty || saving);

  useEffect(() => {
    if (serverSignature === lastServerSignature.current && dirty) return;
    if (dirty && serverSignature !== lastServerSignature.current) {
      setConflict(true);
    } else if (!dirty) {
      setWeight(serverWeight);
      setReps(serverReps);
      editRevisionRef.current = set.revision;
      setConflict(false);
    }
    lastServerSignature.current = serverSignature;
  }, [dirty, serverReps, serverSignature, serverWeight, set.revision]);

  const useServerValues = () => {
    setWeight(serverWeight);
    setReps(serverReps);
    editRevisionRef.current = set.revision;
    setDirty(false);
    setConflict(false);
    setError(null);
  };

  const commit = async (completed: boolean) => {
    if (savingRef.current) return;
    const w = weight.trim() ? parseFloat(weight.replace(",", ".")) : null;
    const r = reps.trim() ? parseInt(reps, 10) : null;
    if (w != null && (!Number.isFinite(w) || w < 0 || w > 1000)) {
      setError(t("chat.valid_weight"));
      return;
    }
    if (r != null && (!Number.isFinite(r) || r < 1 || r > 1000)) {
      setError(t("chat.valid_reps"));
      return;
    }
    if (completed && (!r || r < 1)) {
      setError(t("chat.completed_reps"));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const outcome = await onToggle(
        dirty ? editRevisionRef.current : set.revision,
        completed,
        w,
        r,
      );
      if (outcome.ok) {
        setDirty(false);
        setConflict(false);
      } else if (outcome.conflict) {
        const latest = outcome.latestSet;
        if (latest) {
          setWeight(latest.weight_kg != null ? String(latest.weight_kg) : "");
          setReps(latest.reps != null ? String(latest.reps) : "");
          editRevisionRef.current = latest.revision;
        }
        setDirty(false);
        setConflict(false);
        setError(t("chat.latest_set_loaded"));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="py-0.5"
      onBlur={(event) => {
        if (dirty && !saving && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          void commit(set.completed);
        }
      }}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="w-7 shrink-0 font-display text-[11px] font-bold text-muted-foreground">
          {t("common.set")} {set.set_index}
        </span>
        <input
          value={weight}
          onChange={(event) => {
            if (!dirty) editRevisionRef.current = set.revision;
            setWeight(event.target.value);
            setDirty(true);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={disabled || saving}
          inputMode="decimal"
          aria-label={t("chat.weight_for_set", { count: set.set_index })}
          placeholder={
            enrichedSet.target_weight_kg != null ? `target ${enrichedSet.target_weight_kg}` : "kg"
          }
          className="h-11 w-[5.5rem] rounded-md border border-border bg-background px-2 text-center text-sm text-foreground placeholder:text-[10px] placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
        />
        <span className="text-muted-foreground">×</span>
        <input
          value={reps}
          onChange={(event) => {
            if (!dirty) editRevisionRef.current = set.revision;
            setReps(event.target.value);
            setDirty(true);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={disabled || saving}
          inputMode="numeric"
          aria-label={t("chat.reps_for_set", { count: set.set_index })}
          placeholder={set.target_reps ?? t("common.reps")}
          className="h-11 w-16 rounded-md border border-border bg-background px-2 text-center text-sm text-foreground placeholder:text-[10px] placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void commit(!set.completed)}
          disabled={disabled || saving}
          aria-label={
            set.completed
              ? t("chat.mark_incomplete", { count: set.set_index })
              : t("chat.complete_set", { count: set.set_index })
          }
          className={`ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-md border transition disabled:opacity-60 ${
            set.completed
              ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
              : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" strokeWidth={3} />
          )}
        </button>
      </div>
      {(error || conflict) && (
        <div
          className={`mt-1 flex min-h-6 items-center justify-between gap-2 pl-7 text-[11px] ${
            error ? "text-red-400" : "text-amber-300"
          }`}
        >
          <span>{error ?? t("chat.set_changed")}</span>
          {conflict && (
            <button type="button" onClick={useServerValues} className="min-h-11 px-2 font-bold">
              {t("common.use_server")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsDrawer({
  profile,
  onClose,
  isAdmin,
  onAdminReset,
}: {
  profile: Profile;
  onClose: () => void;
  isAdmin?: boolean;
  onAdminReset?: () => void;
}) {
  const { language, t } = useLanguage();
  const qc = useQueryClient();
  const updateFn = useServerFn(updateProfile);
  const resetWsFn = useServerFn(resetWorkspace);
  const removeMemoryFn = useServerFn(removeMemory);
  const memoryQuery = useQuery({
    queryKey: ["memories"],
    queryFn: () => getMemories({ data: undefined }),
  });
  const memories = memoryQuery.data ?? [];
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "workspace" | "everything">(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const { canInstall, isInstalled } = usePwaInstall();
  const equipmentValue = profile.equipment
    ? ({
        full_gym: t("settings.equipment_full_gym"),
        home_gym: t("settings.equipment_home_gym"),
        dumbbells_only: t("settings.equipment_dumbbells_only"),
        bodyweight: t("settings.equipment_bodyweight"),
      }[profile.equipment] ?? profile.equipment)
    : null;
  const dietValue = profile.diet_style
    ? ({
        omnivore: t("settings.diet_omnivore"),
        vegetarian: t("settings.diet_vegetarian"),
        vegan: t("settings.diet_vegan"),
        pescatarian: t("settings.diet_pescatarian"),
      }[profile.diet_style] ?? profile.diet_style)
    : null;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  async function save(patch: Record<string, unknown>) {
    try {
      await whilePwaUpdateBlocked("settings-save", () =>
        updateFn({
          data: {
            ...patch,
            expected_data_epoch: profile.data_epoch,
          },
        }),
      );
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(t("common.saved"));
    } catch (err) {
      if (isDataEpochConflict(err)) {
        await refreshAfterDataEpochConflict(qc);
        toast.error(`${t("chat.account_changed")} ${t("settings.latest_loaded")}`);
        return;
      }
      if (isUnauthorizedError(err)) {
        await hardNavigateToAuth(qc);
        return;
      }
      toast.error(language === "en" && err instanceof Error ? err.message : t("common.failed"));
    }
  }

  async function resetWs() {
    try {
      await whilePwaUpdateBlocked("workspace-reset", () =>
        resetWsFn({ data: { expected_data_epoch: profile.data_epoch } }),
      );
      await qc.invalidateQueries({ queryKey: ["workspace-files"] });
      toast.success(t("settings.workspace_cleared"));
    } catch (err) {
      if (isDataEpochConflict(err)) {
        await refreshAfterDataEpochConflict(qc);
        toast.error(t("chat.account_changed"));
        return;
      }
      if (isUnauthorizedError(err)) {
        await hardNavigateToAuth(qc);
        return;
      }
      toast.error(language === "en" && err instanceof Error ? err.message : t("common.failed"));
    }
  }

  async function forgetMemory(id: string) {
    const previous = memories;
    qc.setQueryData(
      ["memories"],
      previous.filter((memory) => memory.id !== id),
    );
    try {
      await whilePwaUpdateBlocked("memory-delete", () => removeMemoryFn({ data: { id } }));
    } catch (err) {
      qc.setQueryData(["memories"], previous);
      if (isUnauthorizedError(err)) {
        await hardNavigateToAuth(qc);
        return;
      }
      toast.error(language === "en" && err instanceof Error ? err.message : t("common.failed"));
    } finally {
      await qc.invalidateQueries({ queryKey: ["memories"] });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-lg border-t border-border bg-background"
      >
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
            {t("settings.title")}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-sm text-muted-foreground hover:bg-secondary"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-4">
            <SettingsGroup label={t("settings.memory")}>
              <button
                type="button"
                onClick={() => setMemoryOpen((open) => !open)}
                className="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left"
                aria-expanded={memoryOpen}
              >
                <Brain className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {t("settings.permanent_memory")}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t("settings.memory_subtitle")}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {memories.length === 1
                    ? t("settings.memory_count", { count: memories.length })
                    : t("settings.memories_count", { count: memories.length })}
                </span>
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                    memoryOpen ? "rotate-90" : ""
                  }`}
                />
              </button>
              {memoryOpen && (
                <div className="max-h-64 overflow-y-auto overscroll-contain border-t border-border/60">
                  {memoryQuery.isPending && !memoryQuery.data ? (
                    <div className="px-3.5 py-4 text-sm text-muted-foreground">
                      {t("settings.loading_memories")}
                    </div>
                  ) : memoryQuery.isError && !memoryQuery.data ? (
                    <div className="flex min-h-14 items-center gap-2 px-3.5 py-2 text-sm text-red-300">
                      <span className="min-w-0 flex-1">{t("settings.load_memories_failed")}</span>
                      <button
                        type="button"
                        onClick={() => void memoryQuery.refetch()}
                        disabled={memoryQuery.isFetching}
                        className="min-h-11 px-2 font-bold text-primary disabled:opacity-50"
                      >
                        {t("common.retry")}
                      </button>
                    </div>
                  ) : (
                    <>
                      {memoryQuery.isError && (
                        <button
                          type="button"
                          onClick={() => void memoryQuery.refetch()}
                          disabled={memoryQuery.isFetching}
                          className="min-h-11 w-full border-b border-amber-500/30 bg-amber-500/10 px-3.5 text-left text-xs font-bold text-amber-300 disabled:opacity-50"
                        >
                          {t("settings.last_synced_memories")} · {t("common.retry")}
                        </button>
                      )}
                      {memories.length === 0 ? (
                        <div className="px-3.5 py-4 text-sm text-muted-foreground">
                          {t("settings.no_memories")}
                        </div>
                      ) : (
                        memories.map((memory) => (
                          <div
                            key={memory.id}
                            className="flex items-start gap-3 border-b border-border/60 px-3.5 py-3 last:border-b-0"
                          >
                            <Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                              <div className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                {memory.topic}
                              </div>
                              <div className="mt-0.5 text-sm leading-snug text-foreground">
                                {memory.content}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void forgetMemory(memory.id)}
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400"
                              aria-label={t("settings.forget", { memory: memory.content })}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup label={t("settings.profile")}>
              <div className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
                <span className="flex-1 text-sm text-foreground">{t("language.label")}</span>
                <div
                  className="flex rounded-lg border border-border bg-background p-1"
                  role="group"
                  aria-label={t("language.choose")}
                >
                  {(["en", "sv"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={language === option}
                      onClick={() => {
                        if (language !== option) void save({ preferred_language: option });
                      }}
                      className={`min-h-11 rounded-md px-3 text-sm font-bold transition ${
                        language === option
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {option === "en" ? "🇬🇧 EN" : "🇸🇪 SV"}
                    </button>
                  ))}
                </div>
              </div>
              <EditRow
                label={t("settings.name")}
                value={profile.display_name}
                open={editing === "display_name"}
                onToggle={() => setEditing(editing === "display_name" ? null : "display_name")}
              >
                <Text
                  label={t("settings.name")}
                  value={profile.display_name ?? ""}
                  onSave={(v) => save({ display_name: v })}
                  placeholder={t("settings.your_name")}
                />
              </EditRow>
              <EditRow
                label={t("settings.goal")}
                value={profile.goal}
                open={editing === "goal"}
                onToggle={() => setEditing(editing === "goal" ? null : "goal")}
              >
                <Text
                  label={t("settings.goal")}
                  value={profile.goal ?? ""}
                  onSave={(v) => save({ goal: v })}
                  placeholder={t("settings.goal_placeholder")}
                />
              </EditRow>
              <EditRow
                label={t("settings.days_week")}
                value={profile.days_per_week != null ? String(profile.days_per_week) : null}
                open={editing === "dpw"}
                onToggle={() => setEditing(editing === "dpw" ? null : "dpw")}
              >
                <Text
                  label={t("settings.days_per_week")}
                  value={profile.days_per_week?.toString() ?? ""}
                  onSave={(v) => save({ days_per_week: v ? Number(v) : null })}
                  placeholder="4"
                  inputMode="numeric"
                />
              </EditRow>
              <EditRow
                label={t("settings.session_length")}
                value={
                  profile.session_minutes
                    ? t("settings.minutes", { count: profile.session_minutes })
                    : null
                }
                open={editing === "sm"}
                onToggle={() => setEditing(editing === "sm" ? null : "sm")}
              >
                <Text
                  label={t("settings.session_minutes")}
                  value={profile.session_minutes?.toString() ?? ""}
                  onSave={(v) => save({ session_minutes: v ? Number(v) : null })}
                  placeholder="60"
                  inputMode="numeric"
                />
              </EditRow>
              <EditRow
                label={t("settings.equipment")}
                value={equipmentValue}
                open={editing === "eq"}
                onToggle={() => setEditing(editing === "eq" ? null : "eq")}
              >
                <Text
                  label={t("settings.equipment")}
                  value={profile.equipment ?? ""}
                  onSave={(v) => save({ equipment: v })}
                  placeholder={t("settings.equipment_placeholder")}
                />
              </EditRow>
              <EditRow
                label={t("settings.diet_style")}
                value={dietValue}
                open={editing === "diet"}
                onToggle={() => setEditing(editing === "diet" ? null : "diet")}
              >
                <Text
                  label={t("settings.diet_style")}
                  value={profile.diet_style ?? ""}
                  onSave={(v) => save({ diet_style: v })}
                  placeholder={t("settings.diet_placeholder")}
                />
              </EditRow>
              <EditRow
                label={t("settings.injuries")}
                value={profile.injuries}
                open={editing === "inj"}
                onToggle={() => setEditing(editing === "inj" ? null : "inj")}
              >
                <Text
                  label={t("settings.injuries_full")}
                  value={profile.injuries ?? ""}
                  onSave={(v) => save({ injuries: v || null })}
                  placeholder={t("settings.injuries_placeholder")}
                />
              </EditRow>
            </SettingsGroup>

            <SettingsGroup label={t("settings.coach")}>
              <Link
                to="/coaches"
                search={{ lang: language }}
                className="flex min-h-11 w-full items-center gap-3 px-3.5 py-3"
              >
                <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {t("settings.switch_coach")}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {t("settings.switch_coach_body")}
                  </span>
                </span>
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-primary">
                  {getCoach(profile.coach_id).name}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link>
            </SettingsGroup>

            {canInstall && !isInstalled && (
              <SettingsGroup label={t("settings.app")}>
                <InstallAppButton
                  label={t("settings.install")}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-medium text-primary"
                />
              </SettingsGroup>
            )}

            <SettingsGroup label={t("settings.danger")}>
              <button
                type="button"
                onClick={() => setConfirm("workspace")}
                className="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left"
              >
                <RefreshCw className="h-4 w-4 shrink-0 text-red-400" />
                <span className="flex-1 text-sm font-medium text-red-400">
                  {t("settings.reset_workspace")}
                </span>
                <span className="text-xs text-muted-foreground/70">{t("settings.files_only")}</span>
              </button>
              {isAdmin && onAdminReset && (
                <button
                  type="button"
                  onClick={() => setConfirm("everything")}
                  className="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left"
                >
                  <RefreshCw className="h-4 w-4 shrink-0 text-red-400" />
                  <span className="flex-1 text-sm font-medium text-red-400">
                    {t("settings.reset_all")}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    {t("settings.profile_data")}
                  </span>
                </button>
              )}
            </SettingsGroup>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirm === "workspace"}
        title={t("settings.reset_workspace_title")}
        body={t("settings.reset_workspace_body")}
        confirmLabel={t("settings.reset")}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void resetWs();
        }}
      />
      <ConfirmModal
        open={confirm === "everything"}
        title={t("settings.reset_all_title")}
        body={t("settings.reset_all_body")}
        confirmLabel={t("settings.reset_all_confirm")}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          onAdminReset?.();
        }}
      />
    </div>
  );
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 px-1 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="divide-y divide-border/60 rounded-sm border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

function EditRow({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string | null | undefined;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left"
        aria-expanded={open}
      >
        <span className="shrink-0 text-sm text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
          {value || "—"}
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && <div className="px-3.5 pb-3">{children}</div>}
    </div>
  );
}
function Text({
  label,
  value,
  onSave,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void | Promise<void>;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
}) {
  const [v, setV] = useState(value);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const inputId = useId();
  const lastServerValue = useRef(value);
  useEffect(() => {
    setV((current) => (current === lastServerValue.current ? value : current));
    lastServerValue.current = value;
  }, [value]);
  usePwaUpdateBlocker(`settings-field-${inputId}`, v !== value || saving);

  const commit = async () => {
    if (savingRef.current || v === value) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(v);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        id={inputId}
        value={v}
        inputMode={inputMode}
        disabled={saving}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
      />
    </>
  );
}

function toFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  return dt.files;
}
