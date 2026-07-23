
# Gym Buddy — v1 Plan

A mobile-first, single-conversation AI chat app that acts as a personal trainer, nutrition coach, scheduler, and gym music controller — with a guided onboarding quiz that produces 3 tailored plans.

## Product surface (5 screens)

1. **Auth** — email/password + Google sign-in.
2. **Onboarding quiz** — step-based questionnaire with visible progress ("Step 3 of 8"), one question per screen, big tap targets. Collects: goal (strength/hypertrophy/powerlifting/yoga/general), experience level, days/week, session length, equipment access, injuries, height/weight/age, diet style, calorie target preference.
3. **Plan picker** — after quiz, AI generates 3 distinct programs (e.g. "Upper/Lower 4x", "PPL 6x", "Full-body 3x") with a short rationale each. User picks one; can swap anytime.
4. **Chat (home)** — single ongoing conversation with the gym buddy. This is where 90% of use happens: log workouts, log food, ask for substitutions, get motivated, view today's session, control music. Quick-action chips above the composer: *Today's workout*, *Log meal*, *Log set*, *Play music*, *Schedule*.
5. **Profile/Settings** — active plan, schedule, connections (Spotify/Calendar), subscription status, sign out.

A slide-over drawer from the chat exposes: active plan detail, today/week schedule, recent logs, macros for the day.

## Chat behavior

- One persistent conversation per user (not threaded).
- Proactive: on first open of the day, the gym buddy greets with today's planned session and asks to start logging.
- Tool-calling agent with these server tools:
  - `generate_plan_options` — returns 3 plans given quiz answers.
  - `set_active_plan` / `swap_plan`.
  - `log_workout_set` (exercise, weight, reps, RPE) — writes to DB, computes progressive overload suggestion for next session.
  - `log_meal` (free-text description) — model estimates macros; user can correct inline.
  - `get_today_session`, `get_week_schedule`, `update_schedule`.
  - `play_music` (start a workout playlist on the user's connected Spotify).
- Rendered with AI Elements (`Conversation`, `Message`, `MessageResponse`, `PromptInput`, `Tool`, `Shimmer`). Tool cards collapsed by default; meal/workout logs render as compact cards inline.
- Markdown rendering for assistant messages, no colored bubble; user messages in a high-contrast primary bubble.

## AI backend

- **Lovable AI Gateway** with the AI SDK, TanStack server route at `src/routes/api/chat.ts` streaming via `toUIMessageStreamResponse`.
- Default model **`openai/gpt-5.5`** for chat and tool use (strong tool-calling + multimodal for future meal photos).
- Structured output for plan generation and macro estimation (provider built with `structuredOutputs: true`, no schema bounds, guarded with `NoObjectGeneratedError` fallback).
- System prompt encodes coaching persona, safety guardrails (injury flags, form cautions, no medical claims), and the user's active plan + recent logs injected each turn.
- Full message history sent each request; persisted server-side per user.

## Integrations (v1)

- **Spotify** — full OAuth playback control. Implemented via the Lovable **Spotify App User Connector** (each user connects their own account, encrypted `lovack_*` key stored per user). Chat can start/pause/queue workout playlists.
- **Apple Music & YouTube Music** — show as "Coming soon" in Settings. Apple Music requires a paid Apple Developer account + MusicKit JS setup the user must supply; YouTube Music has no official playback API. Documenting this honestly avoids a broken v1 promise; we can add them post-launch if the user provides credentials.
- **Google Calendar** — App User Connector for per-user schedule sync (read existing events to avoid conflicts, write planned workouts). If a user prefers no calendar, the in-app schedule works standalone.
- **Schedule doc import** — v1 supports pasting a schedule into chat; the buddy parses it into structured workout days. Native file/doc upload is v2.

## Auth & profiles

Lovable Cloud auth, email/password + Google. A `profiles` table stores fitness data (goal, level, days/week, height, weight, age, dietary prefs, injuries) created on signup via trigger. Roles table only if we later add admin.

## Subscription (Paddle)

- Built-in Paddle payments (recommended over Stripe for global SaaS + tax handling on a fitness subscription; will confirm with `payments--recommend_payment_provider` before enabling).
- Single plan: **Gym Buddy Pro** (monthly + annual). 7-day free trial.
- Free tier: onboarding quiz + 10 chat messages/day, no music/calendar integrations, no logging history beyond 7 days. Paywall gates deeper usage.
- Subscription state read from Paddle webhook → `subscriptions` table; server functions check `active` before calling the AI gateway on non-trial users.

## Data model (Lovable Cloud)

- `profiles` — user fitness data.
- `plans` — generated program (JSONB structure: weeks → days → exercises), one active per user.
- `plan_candidates` — the 3 options presented at onboarding (kept for switching).
- `chat_messages` — full conversation, ordered.
- `workout_logs` — set-level: exercise, weight, reps, RPE, timestamp.
- `meal_logs` — description, estimated macros, timestamp.
- `schedule_events` — planned sessions.
- `app_user_connections` — encrypted Spotify/Google connector keys.
- `subscriptions` — Paddle customer id, status, current_period_end.

RLS: every table scoped to `auth.uid()`. Grants to `authenticated`; `service_role` for webhook writes.

## Mobile-first UI

- Tailwind v4, semantic tokens, custom warm/athletic palette (defined in `src/styles.css` — not the default indigo).
- Bottom-safe layout: composer pinned above iOS home indicator, thumb-reachable quick actions.
- One-hand navigation: drawer opens from left edge swipe / hamburger; no deep nav trees.
- Custom AI agent logo (generated image, not `Sparkles`).
- Progress indicator on quiz: segmented bar + "Step N of M" label.

## Tech notes (for engineers)

- TanStack Start; chat route `src/routes/api/chat.ts` (`streamText` + tool calls).
- App-internal calls (plan generation, log writes, subscription check) via `createServerFn` in `src/lib/*.functions.ts`.
- Spotify/Google calls proxied through server functions using `callAsAppUser` with the decrypted per-user connection key.
- Auth-gated home: `src/routes/index.tsx` = public landing; `_authenticated/chat.tsx` = signed-in home.

## Build order

1. Auth + profiles + Lovable Cloud schema.
2. Onboarding quiz UI.
3. Chat route + streaming + persistence + AI Elements UI.
4. Plan generation tool + plan picker.
5. Workout & meal logging tools + inline cards.
6. Schedule (in-app first).
7. Spotify App User Connector + play/queue tools.
8. Google Calendar App User Connector + sync.
9. Paddle subscription + paywall gating.
10. Polish: logo, theme, empty states, quick actions.

## Open items to confirm before/during build

- Preferred brand name and visual tone (energetic/neon vs. calm/monochrome) — I'll offer 3 design directions before building UI.
- Pricing for Gym Buddy Pro (default suggestion: $9.99/mo, $79/yr).
- Whether to include a "voice input" affordance in chat for hands-free logging between sets (recommended; low added cost with Lovable AI speech-to-text).
