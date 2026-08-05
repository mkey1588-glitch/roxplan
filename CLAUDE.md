# RoxPlan — HYROX Training App

A web app that generates periodized HYROX training plans for non-elite athletes, adapts them from logged performance and recovery, and enforces safe progression by design.

**Read before working:** `docs/PRD.md` (requirements), `docs/ERRATA.md` (**amendments to the PRD — this wins where it differs, plus the open-defects register**), `docs/DECISIONS.md` (settled decisions — don't re-litigate D1–D9), `docs/research.md` (domain background).

---

## Non-negotiable rules

1. **The periodization engine is deterministic.** Pure functions, no network calls, no LLM calls, no unseeded randomness. Identical inputs must always produce an identical plan. AI may generate explanatory text only — never the training prescription itself.

2. **Safety guardrails are hard constraints.** The 8 rules in PRD §F8 are enforced by a validation pass over every generated plan. A plan that violates one is a P0 bug and must fail tests. Do not downgrade any of them to a UI warning.

3. **Never add body-composition features.** No weight tracking, calorie targets, body-fat metrics, or weight-loss framing anywhere in the product. This is a deliberate safety decision for a general-public audience — do not "helpfully" add these.

4. **No dark patterns.** No loss-framed streaks, no guilt notifications, no manufactured urgency, no expiring plans. Adherence comes from clarity and visible progress.

5. **Missed sessions are absorbed, never stacked.** Recalculate forward. Never pile missed volume onto the following week.

6. **`Plan` is immutable.** Auto-regulation and overrides write `SessionAdjustment` records. Nothing mutates a generated plan in place. Rendered session = Plan session + adjustments + gate resolution, computed at read time.

---

## Conventions

- TypeScript strict mode. No `any`.
- **SI units everywhere internally** — metres, kilograms, seconds. Parameter names carry the unit (`distanceM`, `loadKg`, `durationSecs`). Imperial is display-layer only.
- Dates are **date-only** (no time component), resolved against the user's timezone. `Session.dayOffset` is an integer from `Plan.startDate`.
- Engine lives in `lib/engine/` and imports **nothing** from `app/` or `components/`. Enforce with a lint rule if possible.
- Engine emits **i18n string keys + parameters**, not prose. User-facing strings never hardcoded in components.
- Seed data versioned by season under `seeds/`, never hardcoded in engine logic.
- Tests colocated as `*.test.ts`.

---

## Testing priority

Engine unit tests > guardrail validation tests > UI tests.

Run the test suite before declaring any engine work complete. The phase-allocation invariant (parts sum exactly to `weeksToRace`) must be asserted for every integer from 5 to 52.

---

## How to work with me

- Propose before building. For anything beyond a small edit, show the plan first.
- One task per session. Don't scope-creep into adjacent work.
- If the PRD is ambiguous or self-contradictory, **stop and ask** — do not pick an interpretation and proceed silently. The PRD has already had one round of bug-fixing; assume more errors exist.
- Flag it explicitly if you think a spec decision is wrong. I'd rather argue now than refactor later.
