# PulseStack: Decision log

Each non-obvious choice: what we decided, why, and what we rejected. Code comments point here by ID (`decision.md D-0xx`). Add new entries at the end. If a decision is reversed, don't delete it: mark it **Superseded by D-0yy**.

Tie-breaker for every decision: the product principles in `CLAUDE.md` §1. In short: nothing leaves the device, logging takes under 10 s, never overclaim, useful on day 1, suggestions not rules.

Status key: **Active** · **Provisional** (revisit with real usage data) · **Deferred** (not built yet, by choice).

---

## Setup and platform

### D-001 Scaffold with `fas init pulsestack` (standalone template) in a `pulsestack/` subfolder
**Active.** The platform CLI clones `template-standalone`, so the compliance workflows, deploy workflow, PWA config and Shell wiring match what the store expects. The repo lives in `pulse_stack/pulsestack/` because `fas init` always creates a folder. The spec files you supplied (`pulsestack-CLAUDE.md`, `skills.md`) stay one level up, outside the repo. `pulsestack-CLAUDE.md` became the repo's `CLAUDE.md`, plus a pointer to the canonical SKILLS.md URL.
*Rejected:* hand-cloning the template. Its README advises against that, and it skips the placeholder replacement.

### D-002 Pin pnpm to 10.30.3 (the template's `packageManager`)
**Active.** pnpm 12 tried to auto-switch to 10.30.3 and failed on Windows ("resolve the installed @pnpm/exe"). Installing 10.30.3 globally matches CI (`pnpm/action-setup` reads `packageManager`), so local and CI lockfile behaviour are identical.

### D-003 Remove the template's platform analytics loader from `index.html`
**Superseded by D-031** (reverted on request: the loader is back). The template includes `<script src="https://api.freeappstore.online/v1/analytics.js?app=pulsestack">`. PulseStack §1.1 says "no analytics", and SKILLS.md says "ZERO analytics, tracking". `fas check` still passes ("no direct tracker SDKs").
*Trade-off:* the store won't get visit counts for this app. **Open question for you:** if the platform needs that loader for listing or ranking, that's a product call, and it would break the "nothing leaves the device" claim in the About text.

### D-004 Self-host Manrope + Fraunces via `@fontsource/*` instead of Google Fonts
**Active.** The template loads fonts from `fonts.googleapis.com`, a third-party request that reveals the visitor's IP to Google. The fonts are now bundled from npm and served from our own origin: Latin subset only, 7 weights, about 110 KB of woff2, precached by the service worker. The compliance checker says outright that the font-loading mechanism is the app's choice (`brand-fonts` check). We used the static `@fontsource/manrope` package, not `@fontsource-variable/manrope`, because the variable package's family name ("Manrope Variable") would trip the `no-brand-overrides` font allowlist.
*Verified (before D-031):* in the browser, `performance.getEntriesByType('resource')` showed **zero** non-origin requests. After D-031 the platform analytics loader is the one expected external request.
*Note:* the template's Google Fonts `runtimeCaching` rules in `vite.config.ts` were restored with D-031. They're inert now (nothing requests Google Fonts) but keep the file identical to the template.

### D-005 Stop the SDK logger's upload timer (`fas.log.destroy()`)
**Superseded by D-031** (reverted on request: SDK default behaviour restored). `initApp()` builds a Logger that POSTs error logs to `api.freeappstore.online` every 30 s *when the user is signed in*. The Shell shows a Sign in button we can't remove, so a signed-in visitor would send logs. Calling `destroy()` clears only the timer: entries still go to memory/localStorage for local debugging, and auth and the Shell work as before. See `web/src/fas.ts`.
*Note:* signed-out visitors (the normal case) make no SDK network calls at all. We checked `auth.js`: the constructor only reads localStorage.

### D-006 Turn on TypeScript `strict`
**Active.** The template's tsconfig doesn't enable `strict`. The engine depends on null-safety (`score: number | null`, optional stats) to be correct, so `strict: true` is on in both tsconfigs. The template code compiled cleanly with it.

### D-007 No cached `summaries` key yet
**Deferred.** The spec reserves `pulsestack:v1:summaries`. Computing 90-day facts from at most 400 days of logs takes milliseconds (memoised in React), so a cache would only add an invalidation bug surface. Revisit if the on-device LLM (§8) lands: caching *generated prose* makes sense there because generation is slow.

---

## Storage

### D-008 Validate every row on its own; count rejects, back up anything unreadable
**Active.** `storage/schema.ts` validates each habit, energy entry, completion and feedback row separately, so one malformed row never sinks an import or a load. Rejected rows are counted and reported ("3 invalid rows skipped"). On load, corrupt JSON or invalid rows are copied to `pulsestack:v1:backup:<key>:<timestamp>` before the cleaned data is written back once. That keeps the spec's "never silently drop data" and avoids a fresh backup on every launch (there's a test for this).

### D-009 Import merges by natural key; the newer write wins; habits gain an optional `updatedAt`
**Active.** Energy merges on `(date, block)` and completions on `(date, habitId)`. On conflict, the later `loggedAt` wins, compared as instants rather than strings so other UTC offsets work. Restoring an *old* backup over newer local data therefore never rolls anything back. Habits merge by `id` using `updatedAt ?? archivedAt ?? createdAt`. `updatedAt` is an **optional extension** to the spec's `Habit` type: without it, an edited habit's conflict can't be resolved. Feedback is unioned. Settings come from the file only when the local install is empty (a fresh-device restore). Otherwise local settings are kept, and the report says which happened.

### D-022 One completion per (date, habit)
**Active.** This follows from the spec's merge key. The habit model is at most daily (`targetPerWeek` ≤ 7), so tapping again replaces the day's status instead of stacking entries.

### D-023 What happens when storage fails
**Active.**
- **localStorage unavailable** (private mode, blocked): fall back to an in-memory store and show a persistent error toast plus a red notice in Settings ("nothing will be kept after this tab closes; export before leaving").
- **A save fails** (quota and the like): keep the change in memory for this session and show an error toast that stays until dismissed. We don't silently revert: losing what the user just typed would be worse.
- **Data from a newer schema version** (e.g. a stale tab after an update): load it **read-only** and refuse writes, so the old code can't overwrite data it doesn't understand.
- `migrate()` exists from day one with an empty migration table. The first schema change is a one-function addition.

### D-024 Backup reminder cadence
**Active / Provisional.** If you've never exported, the first nudge comes after 14 days of use. After that, it comes 30 days after the last export. It shows on Today (with an Export button) and in Settings. Rationale: the risk of local-only data is highest before the first backup exists.

### D-017 Install prompt after 3 distinct days with logs; "Not now" snoozes for 14 days
**Active / Provisional.** "A few days" (spec) is 3. Asking on day 1 is premature. Waiting too long leaves Safari's eviction risk uncovered. Skipped when already installed (`useStandalone()`). Chrome/Edge get a real Install button (`beforeinstallprompt` is captured in `main.tsx` before React mounts, because the event can fire early). iOS gets "Share → Add to Home Screen" text, since Safari has no install API.

---

## Dates and time

### D-010 Between midnight and the first block, you're still in "last night"
**Active.** `slotAt()` maps 01:30 (with blocks starting at 05:00) to the **previous date's last block** (Night). Someone logging at 01:30 is almost always finishing their day, not starting the next one. Gaps between enabled blocks map to the most recent block that has started. Today shows "(late night: still counts for this day)".
*Rejected:* returning "no block" (blocks logging at night) or keying on the new calendar date (scatters one evening across two days).

### D-011 Tests run with `TZ=America/New_York`
**Active.** It's a real zone with DST (8 Mar / 1 Nov 2026) and a UTC offset large enough that `toISOString()` gets 23:30 wrong. Pinned in `vitest.config.ts`, so date/DST tests are deterministic on every machine and in CI. A guard test fails if the pin ever stops working. All date arithmetic goes through local noon, so a ±1 h DST shift can't cross midnight.

---

## Heuristics engine

### D-012 Peak/dip classification: thresholds first, then rank, but only for a *unique* top or bottom
**Active.** The spec says "peak = score ≥ 2.5 or top-ranked; trough = score ≤ 1.5 or bottom-ranked". Taken literally, that gives two bugs:
1. A flat profile (every block 2.0) would still label some block "peak" and another "trough".
2. A block at 1.4 that happens to be top-ranked would be both.

So thresholds decide first. Rank-based labels then go only to a top or bottom block whose score is *strictly* better or worse than the next block, and only if the threshold hasn't already labelled it. Ties are broken by more samples. Blocks with fewer than 4 samples are always "Still learning". Each case has a test.

### D-013 Weekday/weekend split: the weekday half needs 4 samples too
**Active.** Once a block has 4 weekend samples, scores split as the spec says. With the 14-day window, that means rating *every* weekend day. When the target is a weekday and the weekday half has fewer than 4 samples, we fall back to the overall score rather than trusting a 2-sample mean.

### D-014 Completion history window: 28 days; "usual block" = most frequent block of done/partial check-offs
**Active / Provisional.** The spec doesn't set a window for completion stats. 28 days is two energy windows: long enough for the Beta(1,1)-smoothed rates to mean something, short enough to follow habit changes. A habit's current block (the A in "move from A to B") is the latest **accepted** suggestion, otherwise the mode of its recent completion blocks (ties go to the most recent).

### D-021 Recommendation rules beyond the spec
**Active.**
- **Kinds.** `move` (the habit has a usual block) and `place` (no history yet: "Try X in Morning"). Without `place`, a new habit would get no help until it had history in the wrong block. A `place` suggestion still needs the target block to have confidence ≥ low.
- **Restorative** habits count as low-demand for trough placement, whatever their demand setting (as the spec says: "low-demand/restorative to troughs").
- **Medium-demand** habits only get a suggestion when they currently sit in a dip, and then move to the best non-dip block. Otherwise they stay put, to avoid churn.
- **High-demand** habits already in a peak with room stay there. No peak-to-peak shuffling.
- **Pinned** habits never move, but pinned high-demand habits *count* toward their block's capacity.
- **Accept** records feedback, and that block becomes the habit's plan, so the suggestion doesn't repeat. **Pin here** accepts and pins. **Dismiss** suppresses that (habit, block) for 7 days; after 3 dismissals it's suppressed for good.
- The gap direction is reversed for low-demand moves: the target must be ≥ 0.5 *lower*.

### D-025 Rates: smoothed for decisions, raw for display
**Active.** Recommendations compare Beta(1,1)-smoothed rates (the spec), so a 1-of-1 never beats an 8-of-10. The evidence text shows the **raw** rate with its sample size ("89% of 18 logged times"): that's what the user can check against their own memory.

### D-034 Scores rounded to 6 decimals
**Active.** The weighted mean of fourteen 3s came out as 2.9999999999999996. That noise could flip a `≥ 2.5` threshold comparison, so `ewMean` rounds to 1e-6.

### D-015 Today ordering
**Active.** (1) Not yet logged today comes before already logged. (2) Habits with a pinned, suggested or usual block, ordered from the **current** block onward (current, then later today, then earlier blocks), so what's relevant now sits at the top. (3) Habits with no block, sorted by how well their demand matches the current block's score. One tap on the round button = Done; ⋯ opens partial, skipped, clear, and a different block.

---

## Insights

### D-019 "Completion rate" = share of weekly targets met, capped per habit
**Active.** Rate among *logged attempts* is biased because people rarely log skips. So the rate is `Σ min(sessions_h, expected_h) / Σ expected_h`, where expected = `targetPerWeek / 7 × days the habit was active in the period` and done = 1, partial = ½. The cap stops one over-achieved habit from hiding another that was neglected. The sample size `n` is the number of logged check-offs, and values with n < 5 are suppressed.

### D-016 The first-14-days baseline only exists if it ends before the period starts
**Active.** For a user in their 3rd week, "last 30 days vs first 14 days" would partly compare a period with itself. In that case the baseline is `null`, and the UI says "not available yet (needs history before this period)". The previous-period comparison still works.

### D-020 Alignment uses the peaks *as they were on that day*
**Active.** Each high-demand session is checked against the peak blocks of the 14-day matrix ending on that session's date (memoised per date). Using today's peaks would rewrite history every time the energy profile shifts. Days with no confident block yet are left out of both numerator and denominator.

### Narrative rules (implements CLAUDE.md §6)
**Active.** `templateNarrative` only uses numbers from `computeFacts`. A test extracts every number in every sentence and checks it exists in the facts (the same contract the future on-device LLM must meet). Another test bans causal phrasing (`CAUSAL_WORDS`: "because of", "boosted", "caused", "thanks to", "due to", "helped you", …). Every sentence has a basis line: period, comparison period, sample size. Notability thresholds: ±5 pts for the completion rate, ±15 % for category sessions, ±10 pts for alignment. Deep-focus and learning get a 1.25× weight because the spec singles them out.

---

## UI

### D-018 Workaround: the Shell topbar is 22 px too wide at 320 px
**Superseded by D-031** (workaround removed on request; the overflow is back, see D-031). At 320 × 568, the SDK Shell's header (brand + app name + menu + text-size + theme + Sign in) doesn't shrink, which caused a horizontal scroll and would fail the auditor's most important viewport. A scoped CSS rule hides **only the app-name label** in the topbar below 360 px. Every screen's PageHeader still names it. Verified: no horizontal scroll on any screen at 320 × 568 or 568 × 320. **Worth reporting upstream** (SDK 0.14.35): any app with a name longer than about 6 characters hits this.

### D-026 Using SDK `Tabs`/`ListRow` despite their limits
**Active.** CLAUDE.md asks for the SDK components, and SKILLS.md forbids custom tabs. SDK `Tabs` buttons are about 30 px tall (under the 44 px target) and have no `role="tab"` semantics. We use them for the two low-frequency switches (Active/Archived, 30/90 days) and our own 44 px radio group (`Segmented`) for the frequent energy, demand and status inputs, which aren't tab UIs.

### D-027 Keep the template's accent colour
**Active.** SKILLS.md's quick reference says apps use blue `#2563eb`, but the current template ships an orange accent and `fas check` enforces *the template's* tokens. We follow the template. Energy colours are derived with `color-mix` from `--success / --warning / --danger` as new `--energy-*` tokens, so no platform token is redefined. Primary buttons use `--accent-deep` (light) for about 6.5:1 contrast with white text. Plain `--accent` was about 3:1.

### D-028 `CLAUDE.md` holds the full product spec despite the "slim" warning
**Active.** `fas check` warns at more than 60 non-blank lines. It's a warning, and SKILLS.md allows repo-specific architecture and rules below the slim header. Everything in there is PulseStack-specific (no platform boilerplate), so it stays.

---

## Deferred and out of scope

### D-029 Not built yet
**Deferred.**
- **On-device LLM summary (§8, build step 7).** Opt-in phase 3. The narrative-number validator it needs already exists as a test. Next: a spike to check the runtime's chunk size (< 300 KB gzipped) and that its `.wasm` loads from our own origin.
- **`fas screencheck`.** It needs `pnpm add -D playwright` plus a Chromium download (~150 MB), which we left for you to approve. Expect it to fail at 320 px portrait now that D-018 is reverted (see D-031).
- **Recharts trend lines on Insights.** Optional in the spec. The facts table and narrative cover it for now.
- **App icons.** Still the template's generic icons.

### D-030 The agent doesn't commit, push or publish
**Active.** Publishing (`fas login`, `fas publish`) provisions a public repo, hosting and a store listing under your GitHub account, and pushing to `main` deploys to production (there's no staging). Those are your calls. The working tree builds, tests and passes `fas check`, ready for you to commit.

### D-031 Revert three platform deviations and restore the template's scripts
**Active.** Requested by the project owner on 2026-10-09: the template's platform behaviour wins over PulseStack's stricter privacy reading. Styling changes (self-hosted fonts, text, energy and component colours in `index.css`) are kept.
- **Analytics loader restored** in `web/index.html`, exactly as the template had it (supersedes D-003). The store gets visit counts. The app now makes one external request on load (`api.freeappstore.online/v1/analytics.js`). Habit, energy and summary data are still never sent anywhere.
- **SDK log upload restored**: `fas.log.destroy()` removed from `web/src/fas.ts` (supersedes D-005). If a visitor signs in through the topbar, the SDK batches error logs to the platform API every 30 s. Signed-out visitors make no SDK calls.
- **Topbar workaround removed** from `web/src/index.css` (supersedes D-018). At 320 px the Shell header is again about 22 px wider than the screen, causing a small horizontal scroll on every screen. Wider phones (360 px and up) are unaffected. Fixing it belongs in the SDK.
- **Template scripts restored:** `web/vite.config.ts` is back to the template version (Google Fonts `runtimeCaching` rules), and the root `test` script is back to the template's `tsc -b`. The Vitest suite moved to a new root script, `pnpm test:unit` (an addition, not a change to a template script).
- **Wording:** "no analytics / no third-party requests" claims were removed from the README. The About screen's "your data never leaves this device" stays true for user data.
