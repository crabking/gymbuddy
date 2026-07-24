import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProfile,
  getChatMessages,
  getWorkspaceFiles,
  updateProfile,
  resetOnboarding,
  resetWorkspace,
  getActiveWorkoutSession,
  toggleSessionExercise,
  toggleSessionSet,
  completeActiveSession,
  getNutritionToday,
  getTodayTrainingInfo,
} from "@/lib/gym-buddy.functions";
import { getCurrentUser, logout } from "@/lib/auth.functions";
import { TabBar } from "@/components/TabBar";
import { ConfirmModal } from "@/components/ConfirmModal";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VersionTag } from "@/components/VersionTag";
import { usePwaInstall } from "@/lib/pwa-install";
import { toast } from "sonner";
import {
  LogOut,
  RefreshCw,
  Camera,
  ArrowUp,
  History,
  X,
  Square,
  Settings,
  Check,
  User,
  CalendarDays,
  UtensilsCrossed,
  Brain,
  Dumbbell,
  FileText,
  Target,
  Flame,
  Play,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { COACH_IMAGES } from "@/lib/coach-assets";
import { getCoach } from "@/lib/coaches";

function getCoachPortrait(id: string | null | undefined) {
  const coach = getCoach(id);
  return { ...coach, portrait: COACH_IMAGES[coach.id].avatar };
}

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
/** "YYYY-MM-DD|Weekday|HH:MM" in the user's local timezone. */
function clientLocalStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}|${WEEKDAYS[d.getDay()]}|${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const TOOL_LABELS: Record<string, string> = {
  load_skill: "opening the playbook…",
  list_workspace: "checking your workspace…",
  read_file: "reading your notes…",
  save_workout_plan: "saving your training plan…",
  save_schedule: "saving your weekly schedule…",
  save_nutrition_targets: "saving your nutrition targets…",
  save_memory_note: "saving that to memory…",
  delete_file: "cleaning up…",
  update_profile: "saving your details…",
  complete_onboarding: "wrapping up setup…",
  log_workout: "logging that set…",
  log_meal: "logging that meal…",
  calc_program_timeline: "structuring the mesocycle…",
  calc_starting_weights: "calibrating your starting loads…",
  substitute_exercise: "finding a swap…",
  shift_schedule_weeks: "reshuffling the weeks…",
};


function deriveActivity(
  latest: UIMessage | undefined,
  status: string,
  coachName: string,
): string | null {
  if (status === "submitted") return `${coachName} is thinking…`;
  if (status !== "streaming") return null;
  if (!latest || latest.role !== "assistant") return `${coachName} is thinking…`;
  // Find the most recent in-progress tool part.
  for (let i = latest.parts.length - 1; i >= 0; i--) {
    const p = latest.parts[i] as { type?: string; state?: string };
    if (p.type?.startsWith("tool-")) {
      if (p.state === "output-available" || p.state === "output-error") break;
      const name = p.type.slice(5);
      return `${coachName} is ${TOOL_LABELS[name] ?? "working…"}`;
    }
    if (p.type === "text") break; // text streaming, no active tool
  }
  return `${coachName} is writing…`;
}


export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "COACH — session" },
      {
        name: "description",
        content: "Talk with your AI gym coach, review saved schedules, workout plans, nutrition targets, and training memory.",
      },
      { property: "og:title", content: "COACH — session" },
      {
        property: "og:description",
        content: "Your AI gym coach session with saved plans, schedules, nutrition targets, and live training support.",
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
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <Shimmer>Loading…</Shimmer>
    </div>
  );
}

function ChatGate() {
  const { data: profile } = useSuspenseQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile({ data: undefined }),
  });
  if (!profile) return <CenterSpinner />;
  return <ChatScreen />;
}


type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
type WorkspaceFile = Awaited<ReturnType<typeof getWorkspaceFiles>>[number];

type SetupKey = "profile" | "schedule" | "meals";
type BuildKey = "schedule" | "plan" | "meals";

function setupStatus(profile: Profile) {
  return {
    profile: !!(profile.goal && profile.days_per_week && profile.experience),
    schedule: !!profile.schedule_note,
    meals: !!profile.meal_preferences,
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
  const navigate = useNavigate();
  const resetFn = useServerFn(resetOnboarding);
  const { data: profile } = useSuspenseQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile({ data: undefined }),
  });
  const { data: workspaceFiles } = useSuspenseQuery({
    queryKey: ["workspace-files"],
    queryFn: () => getWorkspaceFiles({ data: undefined }),
  });
  const { data: initialMessages } = useSuspenseQuery({
    queryKey: ["chat-messages"],
    queryFn: () => getChatMessages({ data: undefined }),
  });
  const { data: session } = useQuery({
    queryKey: ["workout-session"],
    queryFn: () => getActiveWorkoutSession({ data: undefined }),
  });
  const { data: nutrition } = useQuery({
    queryKey: ["nutrition"],
    queryFn: () => getNutritionToday({ data: undefined }),
  });
  const { data: todayTraining } = useQuery({
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
  });
  // Live clock for the header (minute resolution).
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const coach = getCoachPortrait((profile as Profile).coach_id);
  const { height: viewportHeight, keyboardOpen } = useChatViewport();

  const [openSection, setOpenSection] = useState<SetupKey | "all" | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser({ data: undefined }).then((user) => setUserEmail(user?.email ?? null));
  }, []);

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

  const qc = useQueryClient();
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: "coach",
    messages: initialMessages as UIMessage[],
    transport,
    onError: (err) => toast.error(err.message || "Chat failed"),
    onFinish: () => {
      // Tool calls may have mutated any module — refetch so live panels update.
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["workspace-files"] });
      qc.invalidateQueries({ queryKey: ["workout-session"] });
      qc.invalidateQueries({ queryKey: ["nutrition"] });
      qc.invalidateQueries({ queryKey: ["today-training"] });
    },
  });

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

  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [status]);

  const busy = status === "submitted" || status === "streaming";
  const status_ = setupStatus(profile as Profile);
  const doneCount = Object.values(status_).filter(Boolean).length;
  const totalSteps = Object.keys(status_).length;
  const inOnboarding = !(profile as Profile).onboarding_completed;
  const buildStatus_ = buildStatus(profile as Profile, workspaceFiles);
  const buildDoneCount = Object.values(buildStatus_).filter(Boolean).length;
  const buildTotalSteps = Object.keys(buildStatus_).length;

  // Auto-boot the coach on a fresh session: during onboarding it runs the
  // onboarding skill; after onboarding it keeps driving the build (plan, meals…)
  // until everything is set up. The "__begin__" marker is filtered from the UI.
  const buildIncomplete = buildDoneCount < buildTotalSteps;
  const kicked = useRef(false);
  useEffect(() => {
    if (
      (inOnboarding || buildIncomplete) &&
      !kicked.current &&
      messages.length === 0 &&
      status === "ready"
    ) {
      kicked.current = true;
      void sendMessage({ text: "__begin__" });
    }
  }, [inOnboarding, buildIncomplete, messages.length, status, sendMessage]);

  // When onboarding finishes, clear the chat into a fresh session — and re-arm
  // the kickoff so the coach immediately continues with the build steps.
  const wasOnboarding = useRef(inOnboarding);
  useEffect(() => {
    if (wasOnboarding.current && !inOnboarding) {
      setMessages([]);
      kicked.current = false;
    }
    wasOnboarding.current = inOnboarding;
  }, [inOnboarding, setMessages]);



  async function submit() {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || busy) return;
    const files = pendingFiles.length ? toFileList(pendingFiles) : undefined;
    void sendMessage({ text: text || "What's this? Log it if it's food.", files });
    setInput("");
    setPendingFiles([]);
  }

  function onPickFiles(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (imgs.length) setPendingFiles((prev) => [...prev, ...imgs].slice(0, 3));
  }

  async function signOut() {
    await logout({ data: undefined });
    navigate({ to: "/auth", replace: true });
  }

  async function fullReset() {
    await resetFn({ data: undefined });

    await qc.cancelQueries();
    qc.clear();
    await logout({ data: undefined });
    window.location.href = "/";
  }


  function explainAgain() {
    if (busy) return;
    void sendMessage({ text: "Can you explain that again, slower and with an example?" });
  }

  function startWorkout() {
    if (busy) return;
    void sendMessage({
      text: "Let's start today's workout session — pull up today's exercises and let's go.",
    });
  }

  async function toggleExercise(name: string, done: boolean) {
    await toggleSessionExercise({ data: { exercise: name, done } });
    await qc.invalidateQueries({ queryKey: ["workout-session"] });
    // Notify the coach so it reacts in real time (hidden UI event message).
    if (!busy) {
      void sendMessage({
        text: `__ui_event__ ${done ? "checked off" : "un-checked"} "${name}" in the workout panel`,
      });
    }
  }

  async function toggleSet(
    setId: string,
    completed: boolean,
    exerciseName: string,
    lastOfExercise: boolean,
    weight_kg?: number | null,
    reps?: number | null,
  ) {
    await toggleSessionSet({ data: { set_id: setId, completed, weight_kg, reps } });
    await qc.invalidateQueries({ queryKey: ["workout-session"] });
    // Only ping the coach when a whole exercise wraps (avoids per-set spam).
    if (completed && lastOfExercise && !busy) {
      void sendMessage({
        text: `__ui_event__ finished all sets of "${exerciseName}" in the workout panel`,
      });
    }
  }

  async function finishWorkout() {
    await completeActiveSession({ data: undefined });
    await qc.invalidateQueries({ queryKey: ["workout-session"] });
    toast.success("Workout done — nice work 🎉");
    if (!busy) {
      void sendMessage({ text: "__ui_event__ tapped 'Finish workout' — session complete" });
    }
  }

  // Hide internal markers (kickoff + UI events) from the transcript.
  const visibleMessages: UIMessage[] = messages.filter((m) => {
    if (m.role !== "user") return true;
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return text !== "__begin__" && !text.startsWith("__ui_event__");
  });
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

  const activity = deriveActivity(latest, status, coach.name);



  const firstName = (profile as Profile)?.display_name?.split(" ")[0] || "athlete";


  const steps: Array<{ key: SetupKey; label: string; Icon: typeof User }> = [
    { key: "profile", label: "Basics", Icon: User },
    { key: "schedule", label: "Schedule", Icon: CalendarDays },
    { key: "meals", label: "Meals", Icon: UtensilsCrossed },
  ];

  const buildSteps: Array<{ key: BuildKey; label: string; Icon: typeof User }> = [
    { key: "schedule", label: "Schedule", Icon: CalendarDays },
    { key: "plan", label: "Plan", Icon: Dumbbell },
    { key: "meals", label: "Meals", Icon: UtensilsCrossed },
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
              className="h-9 w-9 rounded-lg object-cover object-top ring-1 ring-primary/40"
            />
            <div className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold text-foreground">{coach.name}</span>
              <div className="flex items-center gap-2">
                {inOnboarding ? (
                  <span className="font-display text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                      </span>
                      Onboarding · {doneCount}/{totalSteps}
                    </span>
                  </span>
                ) : buildDoneCount < buildTotalSteps ? (
                  <span className="font-display text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400/80">
                    Build · {buildDoneCount}/{buildTotalSteps}
                  </span>
                ) : (
                  <span className="font-display text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400/80">
                    Coach online
                  </span>
                )}
                <VersionTag />
              </div>
            </div>

          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOpenSection("all")}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="History"
            >
              <History className="h-4 w-4" />
            </button>


            <button
              onClick={signOut}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Sign out"
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
                const isCurrent =
                  !done &&
                  steps.slice(0, i).every((prev) => status_[prev.key]);
                return (
                  <button
                    key={s.key}
                    disabled
                    className="group flex flex-1 flex-col items-center gap-1 disabled:cursor-default"
                    aria-label={`${s.label} — ${done ? "done" : isCurrent ? "in progress" : "pending"}`}
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
                  !done &&
                  buildSteps.slice(0, i).every((prev) => buildStatus_[prev.key]);
                return (
                  <button
                    key={s.key}
                    onClick={() => setOpenSection("all")}
                    className="group flex flex-1 flex-col items-center gap-1"
                    aria-label={`${s.label} — ${done ? "done" : isCurrent ? "in progress" : "pending"}`}
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

        {/* Date & time — clear, on its own line */}
        {!keyboardOpen && (
          <div className="mt-2 text-xs font-semibold text-foreground">
            {clock.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            <span className="font-normal text-muted-foreground">
              {" · "}
              {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}

        {/* Today's calories — always visible up top once onboarded */}
        {!inOnboarding && !keyboardOpen && nutrition && (
          <div className="mt-2.5 flex items-center gap-2">
            <Flame className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {Math.round(nutrition.calories)}
                  {nutrition.target_calories ? ` / ${nutrition.target_calories}` : ""} kcal today
                </span>
                <span>
                  Protein {Math.round(nutrition.protein_g)}g · Carbs {Math.round(nutrition.carbs_g)}g
                  · Fat {Math.round(nutrition.fat_g)}g
                </span>
              </div>
              {nutrition.target_calories ? (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (nutrition.calories / nutrition.target_calories) * 100)}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Session bar — live session (lit + timer) or the next one up */}
        {!inOnboarding &&
          !keyboardOpen &&
          (session ? (
            <SessionTimerBar
              session={session}
              minutes={(profile as Profile).session_minutes ?? 60}
            />
          ) : todayTraining ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">
                Next session:{" "}
                <span className="font-semibold text-foreground">{todayTraining.label}</span>
              </span>
              {todayTraining.detail && <span className="shrink-0">{todayTraining.detail}</span>}
            </div>
          ) : null)}
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
              <Shimmer>{`${coach.name} is getting set up…`}</Shimmer>
            ) : (
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                Ask {coach.name} anything, or tap Program to see today's session.
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
                {activity && (
                  <Shimmer>{activity}</Shimmer>
                )}
                {latestText && (
                  <div className="prose prose-sm prose-invert max-w-full text-[15px] leading-relaxed text-foreground prose-p:my-2 prose-li:my-0 prose-headings:mt-3 prose-headings:mb-2 prose-strong:text-foreground">
                    <ReactMarkdown>{latestText}</ReactMarkdown>
                  </div>
                )}
                {inOnboarding && status === "ready" && latestText && (
                  <button
                    onClick={explainAgain}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary/40 px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:border-primary hover:text-primary"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Explain again
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-end gap-3">
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  You
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
          {session ? (
            <WorkoutPanel
              session={session}
              onToggle={toggleExercise}
              onToggleSet={toggleSet}
              onFinish={finishWorkout}
            />
          ) : (
            <button
              onClick={startWorkout}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 py-2 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Start today's workout
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
              onPickFiles(e.target.files);
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
              onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => cameraRef.current?.click()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground hover:border-primary hover:text-primary"
            aria-label="Take photo"
          >
            <Camera className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={`Ask ${coach.name}…`}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none sm:text-[15px]"
          />
          <button
            onPointerDown={(event) => event.preventDefault()}
            onClick={busy ? () => stop() : submit}
            disabled={!busy && !input.trim() && pendingFiles.length === 0}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition disabled:opacity-40"
            aria-label={busy ? "Stop" : "Send"}
          >
            {busy ? <Square className="h-4 w-4" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
          </button>
        </div>
      </div>

      {!keyboardOpen && <TabBar />}

      {/* History drawer */}
      {showHistory && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
                Conversation history
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {visibleMessages.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No messages yet.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleMessages.map((m) => {
                  const text = m.parts
                    .map((p) => (p.type === "text" ? p.text : ""))
                    .join("");
                  return (
                    <div
                      key={m.id}
                      className={`rounded-xl border border-border/60 p-3 text-sm ${
                        m.role === "user"
                          ? "bg-primary/10 text-foreground"
                          : "bg-background text-muted-foreground"
                      }`}
                    >
                      <div className="mb-1 font-display text-[9px] font-bold uppercase tracking-widest text-primary">
                        {m.role === "user" ? "You" : coach.name}
                      </div>
                      <div className="whitespace-pre-wrap">{text}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings drawer */}
      {openSection && (
        <SettingsDrawer
          profile={profile as Profile}
          workspaceFiles={workspaceFiles ?? []}
          section={openSection}
          onClose={() => setOpenSection(null)}
          isAdmin={isAdmin}
          onAdminReset={fullReset}
        />
      )}

    </div>
  );
}

function PendingImage({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <div className="relative">
      <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
      <button
        onClick={onRemove}
        className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-background ring-1 ring-border"
        aria-label="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

type WorkoutSession = NonNullable<Awaited<ReturnType<typeof getActiveWorkoutSession>>>;

function SessionTimerBar({ session, minutes }: { session: WorkoutSession; minutes: number }) {
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
    <div className="mt-2 rounded-xl border border-primary/60 bg-primary/10 px-3 py-2 shadow-[0_0_16px_-6px] shadow-primary/60">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5 font-bold text-primary">
          <Dumbbell className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">LIVE · {session.title}</span>
        </span>
        <span className={`shrink-0 font-display font-bold ${over ? "text-red-400" : "text-foreground"}`}>
          {over ? `+${mmss(remaining)}` : mmss(remaining)}
          <span className="ml-2 text-emerald-400">
            {session.done}/{session.total}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full transition-all ${over ? "bg-red-400" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function WorkoutPanel({
  session,
  onToggle,
  onToggleSet,
  onFinish,
}: {
  session: WorkoutSession;
  onToggle: (name: string, done: boolean) => void;
  onToggleSet: (
    setId: string,
    completed: boolean,
    exerciseName: string,
    lastOfExercise: boolean,
    weight_kg?: number | null,
    reps?: number | null,
  ) => void;
  onFinish: () => void;
}) {
  const allDone = session.total > 0 && session.done === session.total;
  const [expanded, setExpanded] = useState<string | null>(session.next?.id ?? null);

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
          const hasSets = e.sets.length > 0;
          const doneSets = e.sets.filter((s) => s.completed).length;
          const open = expanded === e.id;
          return (
            <div key={e.id} className="rounded-lg border border-border/60 bg-card/50">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  onClick={() => onToggle(e.name, !e.completed)}
                  aria-label={`Toggle ${e.name}`}
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    e.completed
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                      : "border-border"
                  }`}
                >
                  {e.completed && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <button
                  onClick={() => setExpanded(open ? null : e.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-xs"
                >
                  <span
                    className={`truncate ${e.completed ? "text-muted-foreground line-through" : "text-foreground"}`}
                  >
                    {e.name}
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
                    const remainingAfter = e.sets.filter((x) => !x.completed && x.id !== s.id).length;
                    return (
                      <SetRow
                        key={s.id}
                        set={s}
                        onToggle={(completed, weight, reps) =>
                          onToggleSet(s.id, completed, e.name, remainingAfter === 0, weight, reps)
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
          onClick={onFinish}
          className="mt-2 w-full rounded-lg bg-emerald-500/20 py-1.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/30"
        >
          Finish workout 🎉
        </button>
      )}
    </div>
  );
}

function SetRow({
  set,
  onToggle,
}: {
  set: WorkoutSession["exercises"][number]["sets"][number];
  onToggle: (completed: boolean, weight_kg?: number | null, reps?: number | null) => void;
}) {
  const [weight, setWeight] = useState(set.weight_kg != null ? String(set.weight_kg) : "");
  const [reps, setReps] = useState(set.reps != null ? String(set.reps) : "");

  const commit = (completed: boolean) => {
    const w = weight.trim() ? parseFloat(weight.replace(",", ".")) : null;
    const r = reps.trim() ? parseInt(reps, 10) : null;
    onToggle(completed, Number.isFinite(w as number) ? w : null, Number.isFinite(r as number) ? r : null);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-8 shrink-0 font-display text-[10px] font-bold text-muted-foreground">
        S{set.set_index}
      </span>
      <input
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        inputMode="decimal"
        placeholder="kg"
        className="h-7 w-16 rounded-md border border-border bg-background px-2 text-center text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <span className="text-muted-foreground">×</span>
      <input
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        inputMode="numeric"
        placeholder={set.target_reps ?? "reps"}
        className="h-7 w-14 rounded-md border border-border bg-background px-2 text-center text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <button
        onClick={() => commit(!set.completed)}
        aria-label={`Toggle set ${set.set_index}`}
        className={`ml-auto grid h-7 w-9 shrink-0 place-items-center rounded-md border transition ${
          set.completed
            ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
            : "border-border text-muted-foreground hover:border-primary hover:text-primary"
        }`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}

function SettingsDrawer({
  profile,
  workspaceFiles,
  section: _section,
  onClose,
  isAdmin,
  onAdminReset,
}: {
  profile: Profile;
  workspaceFiles: WorkspaceFile[];
  section: SetupKey | "all";
  onClose: () => void;
  isAdmin?: boolean;
  onAdminReset?: () => void;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateProfile);
  const resetWsFn = useServerFn(resetWorkspace);
  const [doc, setDoc] = useState<{ title: string; file: WorkspaceFile } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "workspace" | "everything">(null);
  const { canInstall, isInstalled } = usePwaInstall();

  async function save(patch: Record<string, unknown>) {
    try {
      await updateFn({ data: patch });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function resetWs() {
    try {
      await resetWsFn({ data: undefined });
      await qc.invalidateQueries({ queryKey: ["workspace-files"] });
      toast.success("Workspace cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const docs = [
    { key: "schedule", title: "Weekly schedule", icon: CalendarDays, file: workspaceFile(workspaceFiles, "schedule/current.md") },
    { key: "plan", title: "Workout plan", icon: Dumbbell, file: workspaceFile(workspaceFiles, "plans/current.md") },
    { key: "nutrition", title: "Nutrition targets", icon: Target, file: workspaceFile(workspaceFiles, "nutrition/targets.md") },
    { key: "memory", title: "Memory notes", icon: Brain, file: workspaceFile(workspaceFiles, "memory/notes.md") },
  ];

  const fmtUpdated = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-lg border-t border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          {doc ? (
            <button
              onClick={() => setDoc(null)}
              className="flex items-center gap-1 font-display text-sm font-bold uppercase tracking-widest text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> {doc.title}
            </button>
          ) : (
            <div className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
              Settings
            </div>
          )}
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {doc ? (
            <div className="prose prose-sm prose-invert max-w-full text-[13px] leading-relaxed prose-headings:mb-2 prose-headings:mt-4 prose-p:my-1.5 prose-li:my-0.5 prose-strong:text-foreground">
              <ReactMarkdown>{doc.file.content}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <SettingsGroup label="Coach documents">
                {docs.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => d.file && setDoc({ title: d.title, file: d.file })}
                    disabled={!d.file}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left disabled:cursor-default"
                  >
                    <d.icon
                      className={`h-4 w-4 shrink-0 ${d.file ? "text-emerald-400" : "text-muted-foreground/50"}`}
                    />
                    <span className="flex-1 text-sm font-medium text-foreground">{d.title}</span>
                    {d.file ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {fmtUpdated(d.file.updated_at)}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">Not created</span>
                    )}
                  </button>
                ))}
              </SettingsGroup>

              <SettingsGroup label="Profile">
                <EditRow label="Name" value={profile.display_name} open={editing === "display_name"} onToggle={() => setEditing(editing === "display_name" ? null : "display_name")}>
                  <Text value={profile.display_name ?? ""} onSave={(v) => save({ display_name: v })} placeholder="Your name" />
                </EditRow>
                <EditRow label="Goal" value={profile.goal} open={editing === "goal"} onToggle={() => setEditing(editing === "goal" ? null : "goal")}>
                  <Text value={profile.goal ?? ""} onSave={(v) => save({ goal: v })} placeholder="e.g. hypertrophy + strength" />
                </EditRow>
                <EditRow label="Days / week" value={profile.days_per_week != null ? String(profile.days_per_week) : null} open={editing === "dpw"} onToggle={() => setEditing(editing === "dpw" ? null : "dpw")}>
                  <Text value={profile.days_per_week?.toString() ?? ""} onSave={(v) => save({ days_per_week: v ? Number(v) : null })} placeholder="4" inputMode="numeric" />
                </EditRow>
                <EditRow label="Session length" value={profile.session_minutes ? `${profile.session_minutes} min` : null} open={editing === "sm"} onToggle={() => setEditing(editing === "sm" ? null : "sm")}>
                  <Text value={profile.session_minutes?.toString() ?? ""} onSave={(v) => save({ session_minutes: v ? Number(v) : null })} placeholder="60" inputMode="numeric" />
                </EditRow>
                <EditRow label="Equipment" value={profile.equipment} open={editing === "eq"} onToggle={() => setEditing(editing === "eq" ? null : "eq")}>
                  <Text value={profile.equipment ?? ""} onSave={(v) => save({ equipment: v })} placeholder="full_gym" />
                </EditRow>
                <EditRow label="Diet style" value={profile.diet_style} open={editing === "diet"} onToggle={() => setEditing(editing === "diet" ? null : "diet")}>
                  <Text value={profile.diet_style ?? ""} onSave={(v) => save({ diet_style: v })} placeholder="omnivore" />
                </EditRow>
                <EditRow label="Injuries / limits" value={profile.injuries} open={editing === "inj"} onToggle={() => setEditing(editing === "inj" ? null : "inj")}>
                  <Text value={profile.injuries ?? ""} onSave={(v) => save({ injuries: v || null })} placeholder="e.g. tweaky left shoulder" />
                </EditRow>
              </SettingsGroup>

              <SettingsGroup label="Preferences">
                <Link to="/coaches" className="flex w-full items-center gap-3 px-3.5 py-3">
                  <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">Switch coach</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Starts over with a clean profile
                    </span>
                  </span>
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-primary">
                    {getCoach(profile.coach_id).name}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
                <EditRow label="Meal preferences" value={profile.meal_preferences} open={editing === "meals"} onToggle={() => setEditing(editing === "meals" ? null : "meals")}>
                  <Textarea value={profile.meal_preferences ?? ""} onSave={(v) => save({ meal_preferences: v || null })} placeholder="High protein, no dairy…" />
                </EditRow>
                <EditRow label="Schedule note" value={profile.schedule_note} open={editing === "sched"} onToggle={() => setEditing(editing === "sched" ? null : "sched")}>
                  <Textarea value={profile.schedule_note ?? ""} onSave={(v) => save({ schedule_note: v || null })} placeholder="Mon/Wed/Fri lifts before work…" />
                </EditRow>
                <EditRow label="Coach memory" value={profile.memory_notes} open={editing === "mem"} onToggle={() => setEditing(editing === "mem" ? null : "mem")}>
                  <Textarea value={profile.memory_notes ?? ""} onSave={(v) => save({ memory_notes: v || null })} placeholder="Anything the coach should always remember…" />
                </EditRow>
              </SettingsGroup>

              {canInstall && !isInstalled && (
                <SettingsGroup label="App">
                  <InstallAppButton
                    label="Install COACH"
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-medium text-primary"
                  />
                </SettingsGroup>
              )}

              <SettingsGroup label="Danger zone">
                <button
                  onClick={() => setConfirm("workspace")}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                >
                  <RefreshCw className="h-4 w-4 shrink-0 text-red-400" />
                  <span className="flex-1 text-sm font-medium text-red-400">Reset workspace</span>
                  <span className="text-xs text-muted-foreground/70">Files only</span>
                </button>
                {isAdmin && onAdminReset && (
                  <button
                    onClick={() => setConfirm("everything")}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                  >
                    <RefreshCw className="h-4 w-4 shrink-0 text-red-400" />
                    <span className="flex-1 text-sm font-medium text-red-400">Reset everything</span>
                    <span className="text-xs text-muted-foreground/70">Profile + data</span>
                  </button>
                )}
              </SettingsGroup>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirm === "workspace"}
        title="Reset workspace?"
        body="Clears all of the agent's files. Your profile and login stay."
        confirmLabel="Reset"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void resetWs();
        }}
      />
      <ConfirmModal
        open={confirm === "everything"}
        title="Reset everything?"
        body="Wipes your profile, program, memory, logs, and chat history, then signs out every device. You'll restart onboarding from scratch."
        confirmLabel="Reset all"
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
      <div className="divide-y divide-border/60 rounded-sm border border-border bg-card">{children}</div>
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
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
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
  value,
  onSave,
  placeholder,
  inputMode,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      inputMode={inputMode}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      placeholder={placeholder}
      className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  );
}

function Textarea({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      placeholder={placeholder}
      rows={4}
      className="w-full rounded-lg border border-border bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  );
}

function toFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  return dt.files;
}
