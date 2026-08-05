# Product Requirements Document
# RoxPlan — HYROX Training Web App

**Version:** 0.2 (revised after engine-logic review)
**Date:** July 2026
**Companion docs:** `docs/research.md` (domain research), `docs/DECISIONS.md` (resolved questions — read this too)

> **Changelog from v0.1:** phase allocation replaced with a summing algorithm (the fixed table was arithmetically broken); volume guardrail rewritten to resolve a contradiction with deload weeks; beginner gating mechanism specified; insufficient-runway path added; data model split into `Plan` / `SessionAdjustment` to fix a regeneration data-loss flaw; 2-day/week template added.

---

## 1. Problem Statement

HYROX has a fixed, globally identical format, making it one of the few endurance events that can be trained for with genuine precision. Yet the general public — reasonably fit people who aren't competitive athletes — mostly prepare for it badly:

- They train strength, running, and "HYROX workouts" as three uncoordinated programs, silently pushing total weekly load past what their body can absorb.
- They ramp running volume too fast, the single most-cited cause of overuse injury in HYROX preparation.
- They train the eight stations in isolation and never practice the transitions, which is what the race actually tests.
- They go hard every session because no structure tells them not to.

Existing apps are mostly plan generators or workout loggers. Few adapt based on how the athlete actually performed, and none surveyed market injury-aware progression as a feature.

**RoxPlan generates a periodized, race-date-anchored HYROX training plan for non-elite athletes, adapts it based on logged performance and self-reported recovery, and enforces safe progression by design.**

---

## 2. Target User

**Primary — "First-timer Finn"**
28–45, trains 3–5×/week, has a HYROX race 8–16 weeks out. Can run 5km without stopping. Gym experience, no coach. Goal: *finish feeling strong*. Anxiety: *"Am I doing enough? Too much? Will I get injured?"*

**Secondary — "Second-race Sam"**
Has raced once, has a time to beat, knows their weakest station. Wants structure plus visible evidence of improvement.

**Not the target for v1:** elite/Pro-division athletes, coaches managing client rosters, and people with no current exercise habit (they need a general-fitness on-ramp, not a race plan).

---

## 3. Product Principles

1. **One plan, one load budget.** Running, strength, and station work are prescribed as a single coordinated weekly load.
2. **Deterministic before clever.** The periodization engine is pure, testable code. AI is used for explanation and natural-language interaction, never to invent the prescription at runtime.
3. **Safe by default, override by choice.** Progression caps and deloads are enforced automatically. Overrides are explicit and warned.
4. **Compromised running is a first-class citizen.** A named session type with its own progression curve.
5. **Meet the user's equipment, not the ideal gym.** Station-level substitution, not an all-or-nothing toggle.
6. **Never guilt the user.** Missed sessions get absorbed, not punished.

---

## 4. Scope

### 4.1 MVP (v1)

| # | Feature | Priority |
|---|---|---|
| F1 | Onboarding + athlete profile capture | P0 |
| F2 | Benchmark assessment (PFT or proxy) | P0 |
| F3 | Periodization engine | P0 |
| F4 | Weekly + daily plan views | P0 |
| F5 | Session detail with equipment substitution | P0 |
| F6 | Workout logging | P0 |
| F7 | Readiness check-in and auto-regulation | P0 |
| F8 | Safety guardrails | P0 |
| F9 | Progress dashboard + PFT re-test comparison | P1 |
| F10 | Race-week guidance + taper + checklist | P1 |
| F11 | Plan recalculation on input change | P1 |

### 4.2 Explicit non-goals for v1
Native mobile apps; wearable integrations (design the data model to accommodate, don't build); social features and leaderboards; coach-facing dashboards; nutrition tracking or macro calculation; video form analysis; payments.

---

## 5. Domain Model (seed data — static, not user-configurable)

### 5.1 Stations
Fixed order, identical worldwide. 1km run precedes each station; 8km running total.

| # | Station | Work | Primary demand |
|---|---|---|---|
| 1 | SkiErg | 1000m | Upper-body aerobic power |
| 2 | Sled Push | 50m (4×12.5m) | Leg drive, strength-endurance |
| 3 | Sled Pull | 50m (4×12.5m) | Posterior chain, grip |
| 4 | Burpee Broad Jumps | 80m | Explosive endurance, full body |
| 5 | Rowing | 1000m | Full-body aerobic |
| 6 | Farmers Carry | 200m | Grip, trunk stability |
| 7 | Sandbag Lunges | 100m | Unilateral leg endurance |
| 8 | Wall Balls | 75–100 reps | Legs + shoulders under fatigue |

### 5.2 Divisions
Enum: `OPEN_SINGLES`, `PRO_SINGLES`, `DOUBLES`, `MIXED_DOUBLES`, `RELAY`.

**v1 supports `OPEN_SINGLES` and `PRO_SINGLES` only.** The engine must throw `UnsupportedDivisionError` for the others rather than silently generating a singles plan — see `DECISIONS.md` D1.

Load table keyed by `(division, sex, station)`. Example Open values: Sled Push 152kg M / 102kg W (incl. sled), Sled Pull 103kg / 78kg, Farmers Carry 2×24kg / 2×16kg, Sandbag Lunges 20kg / 10kg, Wall Balls 9kg→10ft / 6kg→9ft.

> Race loads and rules change between seasons. Versioned seed file (`seeds/divisions.<season>.json`), never hardcoded in engine logic.

### 5.3 The PFT (benchmark test)
Fixed sequence, for time: 1000m run (2% treadmill incline if indoors) → 50 burpee broad jumps (90cm) → 100 stationary lunges → 1000m row → 30 hand-release push-ups → 100 wall balls (6kg M / 4kg W).

Rough division guidance: ~15–25 min → Pro-capable; ~25–35 min → Open Singles; ~30–45 min → Doubles.

---

## 6. Feature Specifications

### F1 — Onboarding

Progressive disclosure, five steps. Target: under 3 minutes.

**Step 1 — Goal:** race date (or "no date yet"), division target, goal type (`FINISH` | `TARGET_TIME` | `GENERAL_FITNESS`).

**Step 2 — Athletic background** *(primary branch point, see §7.3)*: `RUNNER` (comfortable 10km+) | `STRENGTH` (regular lifting/CrossFit) | `HYBRID` | `BEGINNER` (occasional, unstructured).

**Step 3 — Current capacity:** longest continuous run in last month (minutes); recent 5km time (optional); sessions/week available (2–6); typical session length; available weekdays.

**Step 4 — Equipment** (multi-select): `FULL_HYROX_GYM`, `COMMERCIAL_GYM`, `ROWER`, `SKIERG`, `SLED`, `DUMBBELLS`, `KETTLEBELLS`, `MED_BALL`, `RESISTANCE_BANDS`, `WEIGHTED_VEST`, `TREADMILL`, `OUTDOOR_ONLY`, `BODYWEIGHT_ONLY`.

**Step 5 — Health:** injury history (free text + checkboxes: knee, lower back, shoulder, ankle/foot); medical disclaimer acknowledgement (§10).

**Acceptance criteria:** all fields except race date and 5km time required before generation; all answers editable later, triggering F11 recalculation.

---

### F2 — Benchmark Assessment

**Path A (preferred):** user performs the PFT, enters total time + per-segment splits.
**Path B (default):** self-reported proxies — longest run, estimated 5km, per-station comfort 1–5.

Produces an `AthleteBaseline`:
```ts
{
  aerobicScore: number           // 0-100, from run capacity
  strengthEnduranceScore: number // 0-100, from PFT segments or comfort scores
  weakestStations: Station[]     // ranked
  recommendedDivision: Division
  source: 'PFT' | 'SELF_REPORT'
  confidence: 'HIGH' | 'LOW'     // LOW for Path B — engine starts more conservatively
}
```

Path B baselines are marked `LOW` confidence; the engine applies more conservative starting volumes when confidence is `LOW`.

Automatic PFT re-test prompts at the end of Foundation and end of Build.

---

### F3 — Periodization Engine

**Pure, deterministic, unit-tested TypeScript.** Input: `AthleteProfile` + `AthleteBaseline` + `raceDate`. Output: a complete `Plan`. No network calls, no LLM, no unseeded randomness.

#### 7.1 Phase allocation — algorithm, not lookup table

> **v0.1 bug:** the fixed table did not sum to `weeksToRace` at most inputs and over-allocated below 8 weeks. Replaced with proportional allocation.

```
allocatePhases(weeksToRace, background):
  if weeksToRace <= 4:  return insufficientRunwayPlan()   // see §7.6

  taper     = 1
  remaining = weeksToRace - taper

  // proportional split
  raw = { foundation: remaining * 0.40,
          build:      remaining * 0.35,
          raceSpec:   remaining * 0.25 }

  // largest-remainder rounding so the parts sum exactly to `remaining`
  alloc = largestRemainderRound(raw, remaining)

  // minimums
  if weeksToRace >= 8:  minBuild = 2; minRaceSpec = 2
  else:                 minBuild = 1; minRaceSpec = 1
  alloc = enforceMinimums(alloc, minBuild, minRaceSpec)  // borrows from foundation

  // background modifier
  if background == BEGINNER:
    shift up to 2 weeks into foundation, taking from build first
    (floor at minBuild), then raceSpec (floor at minRaceSpec)

  assert alloc.foundation + alloc.build + alloc.raceSpec + taper == weeksToRace
  return alloc
```

Worked examples (must be asserted in tests):

| weeksToRace | Foundation | Build | Race-Spec | Taper | Σ |
|---|---|---|---|---|---|
| 20 | 7 | 7 | 5 | 1 | 20 ✓ |
| 16 | 6 | 5 | 4 | 1 | 16 ✓ |
| 12 | 4 | 4 | 3 | 1 | 12 ✓ |
| 8 | 3 | 2 | 2 | 1 | 8 ✓ |
| 6 | 2 | 2 | 1 | 1 | 6 ✓ |
| 12 (BEGINNER) | 6 | 2 | 3 | 1 | 12 ✓ |

The `assert` is not decorative — it must be a runtime invariant and a test case across every integer from 5 to 52.

#### 7.2 Phase intents

- **Foundation** — aerobic base (Zone 2 dominant), movement quality on all 8 stations at light load, general compound strength. No race simulations.
- **Build** — heavier strength, threshold running at goal race pace, *compromised running introduced*, half-race simulations every other week.
- **Race-Specific** — full/near-full simulations every 10–14 days at race weight, transition practice, general strength volume cut while retaining 1–2 short heavy sessions.
- **Taper** — volume cut 40–50%, intensity retained, technique polish on weakest station only, 2 full rest days before race day.

#### 7.3 Background modifiers

| Background | Modifier |
|---|---|
| `RUNNER` | +1 strength session/week in Foundation; running volume increase capped at 5%/week (their absolute volume is already high); station-strength work introduced earlier |
| `STRENGTH` | Zone 2 volume front-loaded; heavy lifting capped at 2 sessions/week from the start; compromised running introduced one week earlier |
| `HYBRID` | Baseline template, no modifier |
| `BEGINNER` | Foundation extended up to 2 weeks (§7.1); run/walk progression; interval and simulation sessions gated (§7.5); station work technique-only for 3 weeks |

#### 7.4 Session types and weekly templates

```
EASY_RUN | INTERVAL_RUN | LONG_RUN |
STRENGTH_LOWER | STRENGTH_UPPER |
STATION_SKILL | COMPROMISED_RUN |
RACE_SIMULATION | RECOVERY_MOBILITY | REST
```

| Days/wk | Composition |
|---|---|
| 2 | 1 run, 1 hybrid (station/compromised). Surface a note that 3+ is recommended for race readiness. |
| 3 | 1 run, 1 strength, 1 hybrid |
| 4 | 2 run, 1 strength, 1 hybrid |
| 5 | 2 run, 2 strength, 1 hybrid *(a hybrid replaces one strength day in Race-Specific)* |
| 6 | 3 run, 2 strength, 1 hybrid + 1 recovery |

Always at least one full `REST` day. Never two consecutive high-intensity days for `BEGINNER`.

#### 7.5 Gated sessions — preserving determinism

> **v0.1 bug:** "no intervals until a 30-minute continuous run is logged" was circular against a plan generated up-front.

The engine emits gated sessions with a deterministic unlock predicate plus a fallback. The `Plan` object never mutates; resolution happens at serve time.

```ts
Session {
  ...
  unlockCondition?: {
    type: 'CONTINUOUS_RUN_MINUTES' | 'COMPROMISED_RUNS_COMPLETED' | 'WEEKS_ELAPSED'
    value: number
  }
  fallbackSessionId?: string  // served while locked
}
```

Applied gates:
- `BEGINNER`: all `INTERVAL_RUN` gated on `CONTINUOUS_RUN_MINUTES ≥ 30`; fallback is `EASY_RUN` Zone 2, equal duration.
- All profiles: `RACE_SIMULATION` gated on `COMPROMISED_RUNS_COMPLETED ≥ 3`; fallback is a `COMPROMISED_RUN` session.

This keeps the engine pure (identical inputs emit identical gates) while making the plan responsive to real progress.

#### 7.6 Insufficient runway (`weeksToRace ≤ 4`)

Do not generate a performance plan. This path must:
1. Tell the user plainly there isn't enough time to build race fitness safely.
2. Generate a **readiness plan**, not a training plan: technique familiarization on all 8 stations, one moderate compromised-running session, pacing guidance, taper, race-day logistics.
3. Explicitly prescribe **no** race simulations, **no** new maximal loading, **no** volume increases over their current habit.
4. For `BEGINNER` + `weeksToRace ≤ 4`, additionally suggest considering a later race date, and note Relay or Doubles as lower-load alternatives.

This is a safety path, not a degraded-experience path. It should read like honest coaching.

#### 7.7 Compromised-running progression

| Phase | Prescription |
|---|---|
| Foundation | Not prescribed (station circuits only, no run coupling) |
| Build wk 1–2 | 1 station → 400m run, ×3 rounds |
| Build wk 3+ | 1 station → 800m run, ×3–4 rounds |
| Race-Specific | 2 stations → 1km run at race pace, ×4 rounds; then full race-order sequences |
| Taper | 1 short session, reduced volume, race pace only |

Station selection prioritizes the user's `weakestStations` and the leg-dominant stations (sled push, sled pull, burpee broad jumps, sandbag lunges), which produce the most running impairment.

#### 7.8 Running intensity

Prescribe by RPE **and** optional HR zone (many users have no monitor).

| Zone | %HRmax | RPE (1–10) | Use |
|---|---|---|---|
| Easy | <70% | 3–4 | Recovery, warm-ups |
| Zone 2 | 70–80% | 5–6 | Base building — majority of volume |
| Threshold | 80–90% | 7–8 | Race pace, intervals |
| Hard | >90% | 9–10 | Short intervals, simulations |

Goal race pace estimated from 5km time if provided; otherwise RPE-only, refined after the first logged interval session.

---

### F4/F5 — Plan Views & Session Detail

- **Weekly view** (default landing): seven day-cards colour-coded by session type, name + estimated duration, current day highlighted.
- **Calendar view**: full plan, phase bands, race day with countdown.
- **Session detail**: warm-up, main blocks (sets/reps/distance/load/RPE target), cool-down, plus a one-line *"why this session exists."*
- **Equipment substitution**, resolved per station at render time:

| Station | Fallback chain |
|---|---|
| SkiErg | SkiErg → band high-pulls → med-ball slams |
| Sled Push | Sled → heavy loaded carry → weighted step-ups |
| Sled Pull | Sled → heavy bent-over row → band pull-through |
| Burpee BJ | (none needed) |
| Rowing | Rower → interval running |
| Farmers Carry | DB/KB → loaded backpack |
| Sandbag Lunges | Sandbag → DB walking lunge → loaded backpack |
| Wall Balls | Wall ball → DB thruster → med-ball squat-to-press |

Show substitutions transparently — *"Sled Push → Weighted Step-Ups (no sled in your equipment profile)"* — with a one-tap "I have a sled today" override.

---

### F6 — Logging

Per session: `COMPLETED` | `PARTIAL` | `SKIPPED`, plus actuals (distance, time, load, reps), RPE 1–10, optional notes. Under 20 seconds to log. Auto-detect PRs on repeated benchmark efforts.

---

### F7 — Readiness Check-in & Auto-regulation

Three questions before each session (dismissible, remembered per day): soreness 1–5, sleep quality 1–5, energy/motivation 1–5.

| Condition | Action |
|---|---|
| Score sum ≤ 7, or soreness = 5 | Downgrade today: high-intensity → Zone 2 equivalent; strength → 60% volume. Show the reason. |
| 3+ consecutive low-readiness days | Suggest an unscheduled deload week; one-tap adjustment. |
| Same-area soreness 4+ days | "Consider seeing a professional" prompt; suppress high-load work for that movement pattern. |
| 2+ sessions missed in a week | Absorb, don't stack. Recalculate forward; never pile missed volume onto the next week. |

All auto-regulation writes a `SessionAdjustment` record (§8) — it never mutates the `Plan`.

---

### F8 — Safety Guardrails

Hard constraints enforced by a validation pass over every generated plan. **These throw in tests. A plan that violates one is a P0 bug.**

1. **Running volume:** planned weekly running volume must not exceed **110% of the highest weekly volume in the previous three weeks** (105% for `RUNNER` profiles).
   > *v0.1 bug fix:* the original "10% over previous week" rule made return-from-deload mathematically impossible (a 40% cut then requires a +67% return) and would have failed every plan. The 3-week rolling maximum resolves this.
2. **Session count** must not increase by more than 1 week-over-week.
3. **Deload every 4th week** (volume −40%, intensity retained), **suppressed** when the week falls in Race-Specific or Taper, or within 3 weeks of race day. Race-Specific manages its own load via simulation spacing.
   > *v0.1 bug fix:* unsuppressed deloads could land adjacent to the taper, producing two consecutive easy weeks before race day.
4. **Minimum one full rest day per week**, always.
5. **No race simulation within 10 days of race day.**
6. **Gated sessions** (§7.5) must always carry a valid fallback.
7. **`weeksToRace ≤ 4`** must route to the insufficient-runway path (§7.6) — never to a standard plan.
8. Manual overrides are logged with the specific rule violated and display a plain-language injury-risk warning.

---

### F9 — Progress Dashboard

PFT time over time (headline metric); weekly volume trend coloured by phase; per-station performance trend surfacing the current weakest station; adherence rate (supportive stat, never a breakable streak); estimated race-time **range** with an explicit confidence caveat — never a single confident number.

---

### F10 — Race Week Module

Unlocks 7 days out: taper explanation, per-station technique and movement standards, pacing strategy from the user's data, general fueling/hydration education (non-prescriptive, §10), kit and logistics checklist.

---

## 8. Data Model

> **v0.1 bug:** the model claimed `Plan` was regenerable from inputs while auto-regulation mutated sessions in place — so any regeneration silently destroyed every adaptation. Split into immutable plan + event-sourced adjustments.

```
User(id, email, createdAt)

AthleteProfile(userId, sex, dob, background, sessionsPerWeek,
               availableDays[], sessionLengthMins, equipment[],
               injuryFlags[], timezone, disclaimerAcceptedAt)

Goal(userId, raceDate?, division, goalType, targetTimeSecs?)

Baseline(userId, source, confidence, recordedAt, pftTotalSecs?, pftSplits?,
         longestRunMins, fiveKSecs?, stationComfort{}, computedScores{})

Plan(id, userId, version, engineVersion, generatedAt,
     inputsHash, startDate, raceDate?, status)          // IMMUTABLE once generated
Phase(planId, type, weekStart, weekEnd, intent)
Session(id, planId, dayOffset, type, title, rationale,
        estDurationMins, unlockCondition?, fallbackSessionId?)
SessionBlock(sessionId, order, kind, prescription{}, stationRef?, targetRPE?)

SessionAdjustment(id, userId, sessionKey, reason, delta{}, createdAt)  // event log
Log(id, userId, sessionKey, status, actuals{}, rpe, notes, loggedAt)
ReadinessCheckin(userId, date, soreness, sleep, energy, actionTaken)
Override(userId, planId, ruleViolated, acknowledgedAt)
```

**Key architecture:**
- `Plan` is immutable and fully regenerable from `(inputs, engineVersion)`. Store `inputsHash` to detect when regeneration is needed.
- `sessionKey` = `(userId, date)` — stable across plan versions, so logs and adjustments survive regeneration.
- **Rendered session** = `Plan.Session` + applied `SessionAdjustment`s + gate resolution. Computed at read time; never written back into `Plan`.
- Regeneration creates `Plan.version + 1`. Prior versions retained for audit.

**Date semantics:** all dates are date-only (no time component) in the user's `timezone`. `Session.dayOffset` is an integer offset from `Plan.startDate`, not an absolute date — keeping plans portable across timezone and race-date changes.

---

## 9. Technical Recommendations

- **Frontend:** Next.js (App Router) + TypeScript strict + Tailwind. Server components for plan views, client components for logging.
- **Database:** Postgres, via Prisma or Drizzle.
- **Auth:** whatever is fastest and boring. Don't build it yourself.
- **Engine:** standalone module at `lib/engine/` with **zero framework dependencies** — pure functions, exhaustive unit tests, snapshot tests across representative profiles. This is the part that must not break.
- **AI usage (post-MVP only):** natural-language plan questions, session rationale phrasing. Never plan generation.
- **Testing priority:** engine unit tests > guardrail validation > UI.

---

## 10. Safety, Legal, Ethical

1. **Medical disclaimer** shown and acknowledged during onboarding, not buried in a footer: general fitness information, not medical advice; consult a physician before starting, particularly with existing conditions or injuries.
2. **Injury-flag handling.** A reported current injury must reduce loading on that movement pattern and surface a recommendation to consult a professional. The app must not simply proceed.
3. **Nutrition content is educational only.** General ranges with sources; no automated per-user macro prescriptions.
4. **No body-composition or weight-loss framing anywhere.** No weight tracking, calorie targets, or body-fat metrics. The goal is race readiness; these are unnecessary and carry real risk with a general-public audience.
5. **No dark-pattern engagement mechanics.** No loss-framed streaks, guilt notifications, or artificial scarcity.

---

## 11. Success Metrics

| Metric | Target (v1) | Measurement |
|---|---|---|
| Onboarding completion | > 70% | Funnel: step 1 started → plan generated |
| Week-4 adherence | > 60% | Sessions logged `COMPLETED` ÷ prescribed |
| PFT re-test completion | > 40% | Users with ≥2 PFT records |
| Week-8 retention | > 35% | Any session logged in week 8 |
| Training-related injury | < 5% | Post-race survey + in-app injury flag raised after onboarding |
| Guardrail violations shipped | 0 | CI test suite; non-negotiable |

---

## 12. Open Questions

Previously-open questions are resolved in `docs/DECISIONS.md` (D1–D9). Only **D10** (deployment target) remains open, and it is not blocking for engine work.

Note D9 in particular: RoxPlan supports **multiple sequential training blocks per user**, since athletes race repeatedly across a season. The schema must not assume one plan per user, and must be able to store real race splits as a baseline source.
