# PulseStack: Implementation & workflow

How the app is put together, how to work on it, and where the build stands. The *why* behind choices lives in `decision.md` (IDs like D-012). The product spec is `CLAUDE.md`.

_Last updated: 2026-10-09_

---

## 1. Build status (CLAUDE.md §10)

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | Scaffold, Shell + 5 screens, storage + migrations, export/import | ✅ Done | `fas init pulsestack` (D-001). Store, schema validation, `migrate()`, merge-on-import |
| 2 | Habits CRUD + Today logging | ✅ Done | One-tap energy, one-tap Done, ⋯ for partial/skip/block |
| 3 | Engine: matrix, classification, completion stats + tests | ✅ Done | Fixtures: empty, sparse, 14-day, DST/timezone, 90-day+ |
| 4 | Matrix screen, Today ordering, recommendations + accept/dismiss | ✅ Done | Plus "Pin here" and `place` suggestions (D-021) |
| 5 | Insights: 30/90-day facts + template narrative | ✅ Done | Number-provenance and no-causal-language tests |
| 6 | PWA install prompt, persistence request, export reminder, polish, checks | 🟡 Mostly | `fas check` ✅. `fas screencheck` not run (needs Playwright, D-029); expected to fail at 320 px until the SDK topbar is fixed (D-031) |
| 7 | (Optional) on-device LLM | ⏸ Deferred | D-029 |

**Definition of done (CLAUDE.md §11) at this point:**
- Engine changes have unit tests; no `Date.now()` in `src/engine/`: ✅ (81 tests)
- No network requests added: ✅ (no app code makes requests; Google Fonts replaced by bundled fonts, D-004). The template's platform analytics loader is the one external request (D-031)
- `pnpm build` ✅ · `fas check` ✅ (all hard checks; 1 soft warning, D-028) · largest JS chunk **~100 KB gzipped** of 300 KB ✅
- Works at 320×568 with no horizontal scroll: ⚠ the SDK Shell topbar overflows by ~22 px at 320 px (workaround removed on request, D-031); app content itself fits. Energy logging is one tap from Today ✅

---

## 2. Architecture

```
┌──────────────────────────── web/src ─────────────────────────────┐
│                                                                  │
│  screens/  Today · Matrix* · Habits · Insights* · Settings       │  (* React.lazy)
│      │  read state, call actions              ▲ derived data     │
│      ▼                                        │                  │
│  state/appStore.ts (Zustand) ──────► state/useEngine.ts          │
│      │  actions: logEnergy, setCompletion,    │ useMemo over     │
│      │  saveHabit, giveFeedback, import...    │ engine/*         │
│      ▼                                        │                  │
│  storage/  Store interface                  engine/  (pure TS)   │
│   ├ store.ts   localStorage impl (+ memory    ├ matrix.ts        │
│   │            fallback), prune, backups      ├ classify.ts      │
│   ├ schema.ts  row validation, migrate()      ├ completion.ts    │
│   └ merge.ts   import merge rules             ├ recommend.ts     │
│                                               ├ today.ts         │
│  lib/  dates · format · platform · backup     └ summary.ts       │
│  summary/templateNarrative.ts  (facts → sentences)               │
│  fas.ts  SDK instance for the Shell only (SDK defaults, D-031)   │
└──────────────────────────────────────────────────────────────────┘
          │ only I/O: window.localStorage (keys pulsestack:v1:*)
```

**Rules that keep it this shape**
- `engine/` and `summary/` never import React or touch storage, and never call `Date.now()`/`new Date()` without an argument. `today` is always passed in. That's what makes the 81 tests deterministic.
- Only `storage/store.ts` knows about `localStorage`. Moving to IndexedDB means writing another `Store`.
- Screens never write storage directly; they call `useApp` actions. Actions never throw into React: storage errors become `notices`, which `<StorageNotices>` turns into Shell toasts (D-023).
- Matrix and Insights are `React.lazy` chunks. `engine/summary.ts` and the narrative ship only in the Insights chunk.

### Data model on disk

| Key | Content |
|---|---|
| `pulsestack:v1:meta` | `{ schemaVersion: 1 }` |
| `pulsestack:v1:habits` | `Habit[]` |
| `pulsestack:v1:energy` | `EnergyEntry[]`, one per (date, block) |
| `pulsestack:v1:completions` | `CompletionEntry[]`, one per (date, habitId) (D-022) |
| `pulsestack:v1:feedback` | `RecFeedback[]` |
| `pulsestack:v1:settings` | blocks, capacity, reminders, firstUsedAt, lastExportAt, … |
| `pulsestack:v1:backup:<key>:<iso>` | untouched copies of unreadable data (D-008) |

Raw logs older than 400 days are pruned on load. Export file: `{ app: "pulsestack", schemaVersion, exportedAt, data }`.

### Request flow: "tap High on Today"

1. `EnergyPicker` → `Today.onPick(3)` → `useApp.logEnergy(slot.day, slot.block, 3)`
2. The action replaces any entry for that (date, block), updates memory, then `store.save({ energy })`
3. `useEngine(slot.day)` recomputes matrix → classification → stats → recommendations (memoised on `data`)
4. Today re-renders: the button shows ✓, the "N suggestions" card updates, and a toast says "Logged: Evening High"

`slot` comes from `slotAt(now, blocks)`: current block, or last night between 00:00 and the first block (D-010). `useNow()` ticks every minute and when the tab becomes visible again.

---

## 3. Engine at a glance

| Function | Input → output | Key rules |
|---|---|---|
| `buildMatrix` | energy, blocks, today → 14×blocks cells + per-block stats | EW mean (half-life 7 d), n, SD, counts, confidence (`<4` learning, `4–6` low, `≥7` ok), weekday/weekend split at ≥4 weekend samples |
| `effectiveScore` | stats, target day → score | Uses the matching half of the split; weekday half needs ≥4 samples (D-013) |
| `classifyBlocks` | matrix → peak/trough/neutral/learning | Thresholds 2.5/1.5 first, then a unique top/bottom (D-012) |
| `completionStats` | completions, energy → rates by habit×block and habit×energy | Beta(1,1) smoothing, 28-day window (D-014) |
| `recommend` | everything above + feedback → suggestions + assignments | Greedy by demand, capacity per block, gap ≥ 0.5, completion-not-worse, dismiss suppression (D-021) |
| `orderToday` | habits, assignments, current block → ordered list | D-015 |
| `computeFacts` | AppData, today, 30\|90 → facts | Baseline only if it precedes the period (D-016), target-based rate (D-019), alignment vs that day's peaks (D-020), n < 5 → `null` |
| `templateNarrative` | facts → 3–5 sentences + basis | Numbers only from facts, no causal words |

---

## 4. Workflow

### First-time setup (Windows, as done here)
```bash
npm install -g @freeappstore/cli pnpm@10.30.3   # pnpm pinned to the repo's packageManager (D-002)
cd pulsestack
pnpm install
```

### Day-to-day
```bash
pnpm dev          # Vite on http://localhost:5173 (also on your LAN IP)
pnpm test:unit    # Vitest, TZ pinned to America/New_York (D-011)
pnpm test         # template script: tsc -b (same as typecheck)
pnpm typecheck    # tsc -b (strict)
pnpm build        # tsc -b && vite build → web/dist (+ service worker)
fas check         # platform compliance (bundle size, brand, PWA, tracking, …)
```

Optional before publishing (one-time ~150 MB browser download):
```bash
pnpm add -D -w playwright && npx playwright install chromium
fas screencheck   # portrait + landscape at min_viewport_width = 320
```

### Making a change (checklist)
1. Engine change? Write or adjust the test in `src/engine/*.test.ts` first; keep functions pure (`today` as an argument).
2. New stored field? Add it to `types.ts`, validate it in `storage/schema.ts`, and if the shape of existing data changes, bump `SCHEMA_VERSION` and add `MIGRATIONS[n]` (n → n+1) with a test.
3. New user-facing claim? It must come from `computeFacts`, show its sample size, and pass `CAUSAL_WORDS`.
4. `pnpm test:unit && pnpm build && fas check`. Check 320×568 in a browser (no horizontal scroll).
5. Record any non-obvious choice in `decision.md`; update the status table above.

### Publishing and deploying (your steps; the agent doesn't do these, D-030)
```bash
fas login                       # GitHub device flow
fas publish                     # one-time: provisions repo + hosting + DNS + store listing
git add -A && git commit -m "…"
git push origin main            # every push to main = production deploy (GitHub Actions → R2)
```
There is no staging: fix forward, and revert commits if needed.

---

## 5. Verification log

| Date | What | Result |
|---|---|---|
| 2026-10-09 | `pnpm test` | 8 files, 81 tests pass |
| 2026-10-09 | `pnpm build` | ✅ main chunk 329.8 KB raw / 100.7 KB gzip; Insights 5.3 KB, Matrix 1.7 KB gzip; precache 17 entries |
| 2026-10-09 | `fas check` | ✅ all hard checks; ⚠ CLAUDE.md length (accepted, D-028) |
| 2026-10-09 | Browser, 320×568 dark: log energy, add habit, mark done | ✅ persisted under `pulsestack:v1:*`, toasts shown, no console errors |
| 2026-10-09 | Browser, injected 130 days of test data: Insights | ✅ 3 suggestions with evidence; narrative with period/baseline/n on every line |
| 2026-10-09 | Browser: horizontal overflow on all 5 screens | ❌ 342 px at 320 → fixed (D-018) → ✅ 320/320 and 568/568 |
| 2026-10-09 | Browser: third-party requests | ✅ none (Resource Timing shows only our origin) |
| 2026-10-09 | Browser: light mode | ✅ energy colours readable, letters shown |
| 2026-10-09 | Reverted D-003/D-005/D-018 and template scripts on request (D-031) | see entries below |

---

## 6. Next steps (suggested order)

1. **You:** review, `git commit`, `fas login`, `fas publish`, push.
2. Run `fas screencheck` once Playwright is installed.
3. Real app icons (192/512 maskable) to replace the template's.
4. Report the Shell topbar overflow at 320 px upstream (D-018/D-031) so the SDK fixes it.
5. Phase 3 spike: on-device LLM runtime chunk size + same-origin wasm (§8). The output validator already exists as a test helper (`numbersIn` in `summary.test.ts`).
6. Tune the provisional values (D-014, D-017, D-024) once there are a few weeks of real use.
