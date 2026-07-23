import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProfile,
  getWorkspaceFiles,
  updateProfile,
  resetOnboarding,
  resetWorkspace,
  getActiveWorkoutSession,
  toggleSessionExercise,
  completeActiveSession,
  getNutritionToday,
} from "@/lib/gym-buddy.functions";
import { getCurrentUser, logout } from "@/lib/auth.functions";
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
  Music,
  UtensilsCrossed,
  Brain,
  Dumbbell,
  FileText,
  Target,
  Flame,
  Play,
} from "lucide-react";
import coachMale from "@/assets/coach-rex-male-face.jpg";
import coachFemale from "@/assets/coach-rex-female-face.jpg";

function useCoachPortrait() {
  const [gender, setGender] = useState<"male" | "female">("male");
  useEffect(() => {
    const saved = localStorage.getItem("rex.coach");
    if (saved === "male" || saved === "female") setGender(saved);
  }, []);
  return {
    portrait: gender === "female" ? coachFemale : coachMale,
    name: gender === "female" ? "Reya" : "Rex",
  };
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
      { title: "Gym Buddy — coach session" },
      {
        name: "description",
        content: "Talk with your AI gym coach, review saved schedules, workout plans, nutrition targets, and training memory.",
      },
      { property: "og:title", content: "Gym Buddy — coach session" },
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

type SetupKey = "profile" | "schedule" | "music" | "meals";
type BuildKey = "schedule" | "plan" | "meals" | "music";

function setupStatus(profile: Profile) {
  return {
    profile: !!(profile.goal && profile.days_per_week && profile.experience),
    schedule: !!profile.schedule_note,
    music: !!profile.music_service,
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
    music: !!profile.music_service,
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
  const { data: session } = useQuery({
    queryKey: ["workout-session"],
    queryFn: () => getActiveWorkoutSession({ data: undefined }),
  });
  const { data: nutrition } = useQuery({
    queryKey: ["nutrition"],
    queryFn: () => getNutritionToday({ data: undefined }),
  });
  const coach = useCoachPortrait();

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
          headers.set("X-Coach-Name", coach.name);
          return fetch(input, { ...init, headers, credentials: "same-origin" });
        }) as typeof fetch,
      }),
    [coach.name],
  );

  const qc = useQueryClient();
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: "gym-buddy",
    transport,
    onError: (err) => toast.error(err.message || "Chat failed"),
    onFinish: () => {
      // Tool calls may have mutated any module — refetch so live panels update.
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["workspace-files"] });
      qc.invalidateQueries({ queryKey: ["workout-session"] });
      qc.invalidateQueries({ queryKey: ["nutrition"] });
    },
  });

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

  // Auto-boot onboarding: the agent greets and runs the onboarding skill itself
  // (no hardcoded greeting). The "__begin__" marker is filtered from the UI.
  const kicked = useRef(false);
  useEffect(() => {
    if (inOnboarding && !kicked.current && messages.length === 0 && status === "ready") {
      kicked.current = true;
      void sendMessage({ text: "__begin__" });
    }
  }, [inOnboarding, messages.length, status, sendMessage]);

  // When onboarding finishes, clear the chat into a fresh session.
  const wasOnboarding = useRef(inOnboarding);
  useEffect(() => {
    if (wasOnboarding.current && !inOnboarding) setMessages([]);
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
    if (!confirm("Reset everything — profile, memory, and chat history?")) return;
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
    { key: "music", label: "Music", Icon: Music },
    { key: "meals", label: "Meals", Icon: UtensilsCrossed },
  ];

  const buildSteps: Array<{ key: BuildKey; label: string; Icon: typeof User }> = [
    { key: "schedule", label: "Schedule", Icon: CalendarDays },
    { key: "plan", label: "Plan", Icon: Dumbbell },
    { key: "meals", label: "Meals", Icon: UtensilsCrossed },
    { key: "music", label: "Music", Icon: Music },
  ];

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <img
              src={coach.portrait}
              alt={coach.name}
              className="h-9 w-9 rounded-lg object-cover object-top ring-1 ring-primary/40"
            />
            <div className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold text-foreground">{coach.name}</span>
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
        {inOnboarding && (
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

        {!inOnboarding && buildDoneCount < buildTotalSteps && (
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

        {/* Today's calories — always visible up top once onboarded */}
        {!inOnboarding && nutrition && (
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
      </header>


      {/* Single-message stage */}
      <main className="flex flex-1 flex-col justify-center overflow-hidden px-5 py-6">
        {!latest && inOnboarding && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
            <img
              src={coach.portrait}
              alt={coach.name}
              className="h-24 w-24 animate-pulse rounded-2xl object-cover object-top ring-2 ring-primary"
            />
            <Shimmer>{`${coach.name} is getting set up…`}</Shimmer>
          </div>
        )}

        {!latest && !inOnboarding && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
            <img
              src={coach.portrait}
              alt={coach.name}
              className="h-24 w-24 rounded-2xl object-cover object-top ring-2 ring-primary/50"
            />
            <div>
              <div className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Coach online
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold text-foreground">
                Hey {firstName} 👋
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                {coach.name} here. Want to talk about your week's schedule, pick some music, or dial
                in your meal style? Tap the steps up top, or just ask me anything. You can do all of
                this later too.
              </p>
            </div>
          </div>
        )}

        {latest && (
          <div
            key={latest.id}
            className="mx-auto flex w-full max-w-md flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            {latest.role === "assistant" ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="relative">
                  <img
                    src={coach.portrait}
                    alt={coach.name}
                    className={`h-14 w-14 rounded-xl object-cover object-top ring-1 ring-primary/40 transition ${
                      activity ? "animate-pulse ring-2 ring-primary" : ""
                    }`}
                  />
                  {activity && (
                    <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
                    </span>
                  )}
                </div>
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  {coach.name}
                </div>
                {activity && (
                  <div className="-mt-1">
                    <Shimmer>{activity}</Shimmer>
                  </div>
                )}
                {latestText && (
                  <div className="prose prose-sm prose-invert max-w-full text-[15px] leading-relaxed text-foreground prose-p:my-2 prose-li:my-0 prose-headings:mt-3 prose-headings:mb-2 prose-strong:text-foreground">
                    <ReactMarkdown>{latestText}</ReactMarkdown>
                  </div>
                )}
                {inOnboarding && status === "ready" && latestText && (
                  <button
                    onClick={explainAgain}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:border-primary hover:text-primary"
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
        <div className="flex gap-2 overflow-x-auto px-4 pb-2">
          {pendingFiles.map((f, i) => {
            const url = URL.createObjectURL(f);
            return (
              <div key={i} className="relative">
                <img
                  src={url}
                  alt=""
                  className="h-16 w-16 rounded-lg object-cover ring-1 ring-border"
                />
                <button
                  onClick={() => setPendingFiles((prev) => prev.filter((_, x) => x !== i))}
                  className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-background ring-1 ring-border"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Live workout module — coach is connected in real time */}
      {!inOnboarding && (
        <div className="border-t border-border bg-card/40 px-3 py-2">
          {session ? (
            <WorkoutPanel session={session} onToggle={toggleExercise} onFinish={finishWorkout} />
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
      <div className="border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
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
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            onClick={busy ? () => stop() : submit}
            disabled={!busy && !input.trim() && pendingFiles.length === 0}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition disabled:opacity-40"
            aria-label={busy ? "Stop" : "Send"}
          >
            {busy ? <Square className="h-4 w-4" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
          </button>
        </div>
      </div>

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

type WorkoutSession = NonNullable<Awaited<ReturnType<typeof getActiveWorkoutSession>>>;

function WorkoutPanel({
  session,
  onToggle,
  onFinish,
}: {
  session: WorkoutSession;
  onToggle: (name: string, done: boolean) => void;
  onFinish: () => void;
}) {
  const allDone = session.total > 0 && session.done === session.total;
  return (
    <div className="rounded-xl border border-border bg-background p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          <Dumbbell className="h-3.5 w-3.5 text-primary" /> {session.title}
        </div>
        <span className="font-display text-[10px] font-bold text-emerald-400">
          {session.done}/{session.total}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {session.exercises.map((e) => (
          <button
            key={e.id}
            onClick={() => onToggle(e.name, !e.completed)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-secondary/50"
          >
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                e.completed
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                  : "border-border"
              }`}
            >
              {e.completed && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={e.completed ? "text-muted-foreground line-through" : "text-foreground"}>
              {e.name}
              {e.target ? ` — ${e.target}` : ""}
            </span>
          </button>
        ))}
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

function SettingsDrawer({
  profile,
  workspaceFiles,
  section,
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
  const status_ = setupStatus(profile);
  const savedSchedule = workspaceFile(workspaceFiles, "schedule/current.md");
  const savedPlan = workspaceFile(workspaceFiles, "plans/current.md");
  const savedNutrition = workspaceFile(workspaceFiles, "nutrition/targets.md");
  const savedMemory = workspaceFile(workspaceFiles, "memory/notes.md");
  const hasWorkspace = !!(savedSchedule || savedPlan || savedNutrition || savedMemory);

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
    if (!confirm("Clear the agent's entire workspace (all files)? Your profile and login stay.")) return;
    try {
      await resetWsFn({ data: undefined });
      await qc.invalidateQueries({ queryKey: ["workspace-files"] });
      toast.success("Workspace cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
            {section === "all" ? "Settings" : "Set up"}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="mb-4 text-xs text-muted-foreground">
            Saved items show here so you can verify what your coach actually created.
          </p>

          {section === "all" && (
            <Section icon={FileText} title="Saved workspace" done={hasWorkspace} defaultOpen>
              <div className="grid gap-3">
                <WorkspacePreview
                  title="Weekly schedule"
                  icon={CalendarDays}
                  file={savedSchedule}
                  empty="No saved schedule yet."
                />
                <WorkspacePreview
                  title="Workout plan"
                  icon={Dumbbell}
                  file={savedPlan}
                  empty="No saved workout plan yet."
                />
                <WorkspacePreview
                  title="Nutrition targets"
                  icon={Target}
                  file={savedNutrition}
                  empty="No saved nutrition targets yet."
                />
                <WorkspacePreview
                  title="Memory notes"
                  icon={Brain}
                  file={savedMemory}
                  empty="No saved memory notes yet."
                />
              </div>
              <button
                onClick={resetWs}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:border-red-500/60 hover:text-red-400"
              >
                <RefreshCw className="h-3 w-3" />
                Reset workspace
              </button>
            </Section>
          )}

          {(section === "all" || section === "profile") && (
            <Section
              icon={User}
              title="Basics"
              done={status_.profile}
              defaultOpen={section === "profile"}
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name">
                  <Text
                    value={profile.display_name ?? ""}
                    onSave={(v) => save({ display_name: v })}
                    placeholder="Your name"
                  />
                </Field>
                <Field label="Goal">
                  <Text
                    value={profile.goal ?? ""}
                    onSave={(v) => save({ goal: v })}
                    placeholder="e.g. hypertrophy"
                  />
                </Field>
                <Field label="Days / week">
                  <Text
                    value={profile.days_per_week?.toString() ?? ""}
                    onSave={(v) => save({ days_per_week: v ? Number(v) : null })}
                    placeholder="4"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Session (min)">
                  <Text
                    value={profile.session_minutes?.toString() ?? ""}
                    onSave={(v) => save({ session_minutes: v ? Number(v) : null })}
                    placeholder="60"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Equipment">
                  <Text
                    value={profile.equipment ?? ""}
                    onSave={(v) => save({ equipment: v })}
                    placeholder="full_gym"
                  />
                </Field>
                <Field label="Diet style">
                  <Text
                    value={profile.diet_style ?? ""}
                    onSave={(v) => save({ diet_style: v })}
                    placeholder="omnivore"
                  />
                </Field>
              </div>
              <Field label="Injuries / limits" full>
                <Text
                  value={profile.injuries ?? ""}
                  onSave={(v) => save({ injuries: v || null })}
                  placeholder="e.g. tweaky left shoulder"
                />
              </Field>
            </Section>
          )}

          {(section === "all" || section === "schedule") && (
            <Section
              icon={CalendarDays}
              title="Schedule"
              done={!!savedSchedule}
              defaultOpen={section === "schedule"}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                Even a rough weekly rhythm helps — mornings vs evenings, rest days, busy days.
              </p>
              <Textarea
                value={profile.schedule_note ?? ""}
                onSave={(v) => save({ schedule_note: v || null })}
                placeholder="Mon/Wed/Fri lifts before work, Sat long run, Sun rest…"
              />
              <WorkspacePreview
                title="Saved schedule document"
                icon={FileText}
                file={savedSchedule}
                empty="When your coach saves the schedule, it appears here."
              />
            </Section>
          )}

          {section === "all" && (
            <Section icon={Dumbbell} title="Workout plan" done={!!savedPlan}>
              <WorkspacePreview
                title="Saved workout plan"
                icon={FileText}
                file={savedPlan}
                empty="No plan saved yet. Your coach should pitch one first, then save it after you confirm duration and details."
              />
            </Section>
          )}

          {(section === "all" || section === "music") && (
            <Section
              icon={Music}
              title="Music"
              done={status_.music}
              defaultOpen={section === "music"}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                Pick your service — full playback integration coming soon.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {["spotify", "apple_music", "youtube_music", "none"].map((s) => (
                  <button
                    key={s}
                    onClick={() => save({ music_service: s })}
                    className={`rounded-xl border p-3 text-sm font-semibold capitalize ${
                      profile.music_service === s
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {(section === "all" || section === "meals") && (
            <Section
              icon={UtensilsCrossed}
              title="Meals"
              done={status_.meals}
              defaultOpen={section === "meals"}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                Preferences, allergies, foods you cook a lot. Snap meal photos in chat to log macros.
              </p>
              <Textarea
                value={profile.meal_preferences ?? ""}
                onSave={(v) => save({ meal_preferences: v || null })}
                placeholder="High protein, no dairy, love oats & chicken, hate fish…"
              />
              <WorkspacePreview
                title="Saved nutrition document"
                icon={FileText}
                file={savedNutrition}
                empty="When your coach locks calories and macros, they appear here."
              />
            </Section>
          )}

          {section === "all" && (
            <Section icon={Brain} title="Long-term memory" done={!!profile.memory_notes}>
              <p className="mb-2 text-xs text-muted-foreground">
                Anything the coach should always remember about you.
              </p>
              <Textarea
                value={profile.memory_notes ?? ""}
                onSave={(v) => save({ memory_notes: v || null })}
                placeholder="I train fasted, prefer barbell over machines, coach in Spanish sometimes…"
              />
            </Section>
          )}

          {section === "all" && isAdmin && onAdminReset && (
            <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
              <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-red-400">
                Admin · Danger zone
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Wipe your profile, memory, plans, logs, and chat history. You'll restart onboarding from scratch.
              </p>
              <button
                onClick={onAdminReset}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/60 bg-red-500/15 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-red-400 transition hover:bg-red-500/25 hover:text-red-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reset everything
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function WorkspacePreview({
  title,
  icon: Icon,
  file,
  empty,
}: {
  title: string;
  icon: typeof User;
  file: WorkspaceFile | null;
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const preview = file?.content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, 6)
    .join("\n");

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
              file ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-foreground">
              {title}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {file ? `Saved · ${file.path}` : empty}
            </div>
          </div>
        </div>
        {file && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 rounded-lg border border-border px-2.5 py-1 font-display text-[9px] font-bold uppercase tracking-widest text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            {open ? "Hide" : "Read"}
          </button>
        )}
      </div>
      {file && (
        <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
          {open ? file.content : preview}
        </pre>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  done,
  defaultOpen,
  children,
}: {
  icon: typeof User;
  title: string;
  done: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="mb-3 rounded-2xl border border-border bg-background">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <div
            className={`grid h-8 w-8 place-items-center rounded-lg ${
              done ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="font-display text-sm font-bold text-foreground">{title}</div>
        </div>
        <div
          className={`text-[10px] font-bold uppercase tracking-widest ${
            done ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {done ? "Set" : "Not set"}
        </div>
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2 mt-2" : ""}>
      <div className="mb-1 font-display text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {children}
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
