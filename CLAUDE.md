# PulseStack

Local-first, energy-adaptive habit optimizer: log habits plus a 3-tier energy rating, build a rolling 14-day energy matrix, and get on-device schedule recommendations.

- Subdomain: `pulsestack.freeappstore.online`
- Template: `standalone` (`fas init pulsestack`) — no sign-in, no SDK backend calls
- Dev:    `pnpm install && pnpm dev`
- Build:  `pnpm build`
- Deploy: `git push` to `main` (auto-deploys to R2 via GitHub Actions)

Free, MIT-licensed, no tracking. Platform conventions: https://freeappstore.online/skills.md (canonical copy: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md) — read before writing or changing anything. Everything below is specific to this app.

Why things are the way they are: `decision.md` (decision log) and `implementation&workflow.md` (architecture, workflow, build status). Update both with every meaningful change.

---

## 1. Product principles (decide ties with these)

1. **Nothing leaves the device.** All habit, energy and summary data stays in the browser. No accounts, no `fas.kv`, no proxy calls, no analytics. The only network traffic is loading the app itself (and, if the user opts in, a one-time model download — see §8).
2. **Logging must take < 10 seconds.** One tap for energy, one tap per habit. Everything else is optional.
3. **Never overclaim.** The app sees self-reported energy and check-offs. It can describe patterns and changes; it must not claim it *caused* a productivity or learning gain. Every insight shows the numbers it rests on.
4. **Useful on day 1, smarter by day 14.** Show a "still learning" state per time block until there is enough data; never invent recommendations from 2 samples.
5. **Recommendations are suggestions.** The user can accept, dismiss or pin a habit to a block. Dismissals feed back into the heuristics.

## 2. Screens (one `nav` entry each, inside the SDK `Shell`)

| href | label | Purpose |
|---|---|---|
| `/` | Today | Quick energy check-in for the current block; today's habits ordered by recommended block; tap to complete/skip |
| `/matrix` | Matrix | 14-day × block heatmap of energy, completion overlay, per-block averages and confidence |
| `/habits` | Habits | Create/edit/archive habits: name, category, energy demand, optional pinned block |
| `/insights` | Insights | Recommendations with evidence, 30-day and 90-day summaries |
| `/settings` | Settings | Time blocks, reminders, export/import JSON, persistent-storage status, delete all data, About + freeappstore.online link |

- Root is `<Shell app={fas} appName="PulseStack" nav={NAV} onNavigate={navigate}>`. Do **not** pass `requireAuth`.
- The Shell will still show a "Sign in" button in the topbar; that's expected platform behaviour. Signing in does nothing for this app — say so on the About section ("No account needed; your data never leaves this device").
- Each screen starts with `PageHeader`. Use `useToast` for "Logged", "Exported", errors. Use SDK `Card`, `ListRow`, `Tabs`, `Badge`, `EmptyState`, `ConfirmDialog`, `ProgressBar`, `Modal`.
- `React.lazy` the Matrix and Insights screens so the main chunk stays small.

## 3. Domain model

```ts
type EnergyLevel = 1 | 2 | 3;                 // 1 = Low, 2 = Medium, 3 = High
type BlockId = 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

interface TimeBlock { id: BlockId; label: string; startHour: number; endHour: number; enabled: boolean }
// Defaults: early 5–8, morning 8–11, midday 11–14, afternoon 14–17, evening 17–21, night 21–24. User-editable.

type Demand = 'high' | 'medium' | 'low';      // energy the habit needs
type Category = 'deep-focus' | 'learning' | 'creative' | 'physical' | 'admin' | 'social' | 'restorative';

interface Habit {
  id: string; name: string; category: Category; demand: Demand;
  pinnedBlock?: BlockId;                       // user override: never move
  targetPerWeek: number;                       // 1–7
  createdAt: string; archivedAt?: string;
}

interface EnergyEntry { date: string; block: BlockId; level: EnergyLevel; loggedAt: string }      // date = local YYYY-MM-DD
interface CompletionEntry { date: string; habitId: string; block: BlockId; status: 'done' | 'partial' | 'skipped'; loggedAt: string }
interface RecFeedback { habitId: string; suggestedBlock: BlockId; action: 'accepted' | 'dismissed'; at: string }
```

- Dates are **local calendar dates** (`YYYY-MM-DD` built from local time, not `toISOString()`), so a 23:30 log doesn't land on tomorrow in UTC. Handle DST and timezone changes by keying on the local date string at log time.
- One energy entry per (date, block); re-logging overwrites.
- The block for a completion defaults to the block containing `loggedAt`; allow changing it.

## 4. Storage (local-first)

- `src/storage/` exposes a small `Store` interface (`load`, `save`, `exportJSON`, `importJSON`, `wipe`) with a `localStorage` implementation. Keep everything else unaware of the backend so it can later move to IndexedDB.
- Keys prefixed `pulsestack:v1:` — `habits`, `energy`, `completions`, `feedback`, `settings`, `summaries` (cached computed summaries). Include `schemaVersion` and write a `migrate()` path from day one.
- Size budget: ~6 blocks × 365 days of energy + completions is well under 1 MB. Retain 400 days of raw logs; prune older on load.
- On first launch call `navigator.storage.persist()` (feature-detect) and show the result in Settings.
- **Data-loss risk is the #1 risk of local-only.** Safari can clear site data for sites not used for a while unless the app is installed to the home screen, and users clear browsers. Therefore:
  - Prompt to install as a PWA after a few days of use (use `useStandalone()` to skip if already installed).
  - Export/import JSON in Settings, plus a gentle reminder to export monthly.
  - Validate imports with a schema check; merge by `(date, block)` / `(date, habitId)` keys; never silently drop data.
- Wrap all storage access in try/catch (private mode, quota errors) and toast a clear message.

## 5. Heuristics engine (`src/engine/`, pure TypeScript, no React, fully unit-tested)

All functions are pure: `(entries, settings, today) → result`. No `Date.now()` inside; pass `today` in.

**Energy matrix** (`buildMatrix`)
- Window: last 14 local days × enabled blocks. Cell = level or `null` (not logged).
- Per-block score: exponentially weighted mean of levels, half-life 7 days. Also report `n` (samples) and SD.
- Confidence: `learning` if n < 4, `low` if 4–6, `ok` if ≥ 7.
- If ≥ 4 weekend samples exist for a block, compute weekday and weekend scores separately and use the one matching the target day.

**Peak and trough windows** (`classifyBlocks`)
- Among blocks with confidence ≥ low: peak = score ≥ 2.5 or top-ranked; trough = score ≤ 1.5 or bottom-ranked. Ties broken by more samples.

**Completion by energy** (`completionStats`)
- For each habit × block, completion rate with a Beta(1,1) prior: `(done + 0.5·partial + 1) / (attempts + 2)`.
- Also habit completion rate split by the *energy level logged in that block that day*.

**Recommendations** (`recommend`)
- Sort unpinned habits by demand (high → low). Greedily assign high-demand habits to peak blocks, low-demand/restorative to troughs, respecting a per-block capacity (default 2 high-demand habits).
- Only emit "move X from A to B" when: both blocks have confidence ≥ low, the score gap ≥ 0.5, and (if completion data exists) B's smoothed completion rate isn't worse than A's.
- Each recommendation carries its evidence object (scores, n, completion rates) which the UI renders, e.g. "Morning rated High on 9 of 12 days; you finished Study 78% of the time there vs 41% in Evening."
- A dismissed (habit, block) suggestion is suppressed for 7 days; dismissed 3 times → stop suggesting that block for that habit.

**Today ordering** (`orderToday`): pinned/recommended block first, then by demand matched to the current block's score.

## 6. Insights and summaries (deterministic first)

Compute every number in code (`src/engine/summary.ts`); the narrative is generated from those facts.

Facts for a period (30 or 90 days), compared against the user's **first 14 days** as baseline and against the previous equal-length period:
- Overall completion rate and change (percentage points), per category (esp. `deep-focus` and `learning`).
- **Alignment score**: % of high-demand completions done in that user's peak blocks; change vs baseline.
- Energy profile: best/worst blocks, average energy by block, stability (SD), days logged.
- Streaks and consistency (days with ≥ 1 completion / days in period).
- Recommendations accepted vs dismissed, and completion rate of habits after a move vs before.

Wording rules:
- Use "you completed 23% more learning sessions than in your first two weeks", **not** "PulseStack boosted your learning by 23%".
- Suppress any statistic with fewer than 5 underlying events; show "not enough data yet".
- Always show the period, the baseline, and the sample size next to a claim.

Default narrative = **template generator** (`src/summary/templateNarrative.ts`): picks 3–5 most notable facts (largest absolute changes above thresholds) and renders sentences from templates. Works offline, on every device, instantly.

## 7. Notifications / reminders

FAS has no cron or push backend. Reminders are best-effort and local: in-app nudge when the app opens in a block with no energy entry; optional Notification API prompts only while the app/PWA is open. Don't promise background reminders.

## 8. Optional on-device AI summary (phase 3, opt-in, behind a flag)

Goal: rewrite the template summary in friendlier prose using a small local model (~0.5–1.5B params, instruction-tuned, 4-bit). It is a **presentation layer only** — it never computes or invents numbers.

Constraints from the platform:
- Model weights (~0.5–1 GB) cannot ship in the bundle; they're fetched at runtime and cached by the browser (Cache Storage / IndexedDB via the runtime library). Downloading from a model host such as Hugging Face is a third-party request — disclose it in the opt-in dialog ("one-time ~X MB download from <host>; your data is not sent").
- The inference runtime must be bundled from npm (no third-party script tags) and loaded with a dynamic `import()` only after opt-in. **Spike this first:** build and check that the runtime's largest JS chunk is < 300 KB gzipped (`fas check` fails otherwise) and that its `.wasm` files deploy and load from our own origin.
- Feature-detect WebGPU and available memory (`navigator.gpu`, `navigator.deviceMemory` where present). Hide the option on unsupported devices, warn on cellular/low-memory phones, and always keep the template narrative as the fallback.

Generation contract:
- Input: the computed facts JSON + the template narrative. Prompt: rewrite in ≤ 120 words, second person, encouraging, use only the provided numbers, no medical/psychological claims.
- Output validation: extract every number in the output; each must match a number in the facts (after rounding). Reject outputs that mention causation words ("because of PulseStack", "boosted", "caused"). On any failure → show the template narrative.
- Low temperature, short max tokens, run in a Web Worker so the UI never blocks; show progress during download/warm-up; allow cancel.
- Settings: "Delete downloaded model" to free storage.

## 9. Tech choices

- Required platform stack (React 19, Vite 6, Tailwind 4, TS, pnpm). State: Zustand. Dates: date-fns. Icons: lucide-react.
- Heatmap: hand-rolled CSS grid/SVG (cheap, accessible) rather than a chart library. Trend lines on Insights may use Recharts inside the lazy chunk if the size budget allows.
- Colour for energy levels must not be the only signal: add H/M/L labels or patterns and accessible names on cells (`aria-label="Mon 6 Oct, Morning: High energy"`).
- Respect `:root[data-theme="dark"]` and the platform tokens; derive the 3 energy colours from `--success` / `--warning` / `--danger` or add app-specific tokens (don't redefine platform tokens).

## 10. Build order

1. Scaffold (`fas init pulsestack`), Shell + 5 nav screens with `PageHeader` stubs, storage layer + migrations, export/import.
2. Habits CRUD + Today logging (energy check-in + completions).
3. Engine: matrix, block classification, completion stats — with Vitest unit tests on fixture data (empty, sparse, 14 days, timezone/DST edge cases, 90 days).
4. Matrix screen + Today ordering + recommendations with evidence and accept/dismiss.
5. Insights: 30/90-day facts + template narrative.
6. PWA install prompt, persistence request, export reminder, polish, `fas check` + `fas screencheck` at 320×568.
7. (Optional) On-device LLM spike → opt-in feature if the bundle/wasm/device constraints hold.

## 11. Definition of done for any change

- Engine changes have unit tests; no `Date.now()` inside engine functions.
- No network requests added (except the opt-in model download path).
- `pnpm build`, `fas check`, `fas screencheck` pass; largest JS chunk < 300 KB gzipped.
- Works at 320×568 with no horizontal scroll; energy logging reachable in one tap from Today.
