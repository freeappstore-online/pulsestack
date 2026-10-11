# PulseStack

Local-first, energy-adaptive habit optimizer. Rate your energy (Low / Medium / High) in each time block of the day, tick off habits, and PulseStack learns your peaks and dips over a rolling 14 days, then suggests when each habit fits best, always showing the numbers behind the suggestion.

**Your data never leaves this device.** No account and no sync: habits, energy ratings and summaries stay in your browser. (The page includes the FreeAppStore platform's standard analytics loader.)

Live at `pulsestack.freeappstore.online` (once published). Part of [FreeAppStore](https://freeappstore.online). MIT licensed.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # type-check (template script)
pnpm test:unit  # engine + storage unit tests (Vitest)
pnpm build      # type-check + production build
fas check       # platform compliance
fas screencheck # real-browser viewport check (needs Playwright, see implementation&workflow.md)
```

## Where to look

- `CLAUDE.md`: the product spec (principles, screens, domain model, heuristics).
- `decision.md`: every non-obvious decision and why.
- `implementation&workflow.md`: architecture, data flow, workflow and build status.
- `web/src/engine/`: pure, unit-tested heuristics (matrix, peaks/dips, completion stats, recommendations, summaries).
- `web/src/storage/`: the `Store` interface, localStorage implementation, schema validation, migrations, import merge.
- `web/src/screens/`: Today, Matrix, Habits, Insights, Settings.
