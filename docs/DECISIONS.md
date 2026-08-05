# Decision Log — RoxPlan

Decisions made **before** implementation so they don't get made accidentally, mid-session, under pressure. Claude Code should treat D1–D9 as settled and not re-litigate them. D10 is genuinely open and flagged as such.

Format: decision → rationale → what it means for the code.

---

## D1 — Divisions supported in v1: Singles only

**Decision:** `OPEN_SINGLES` and `PRO_SINGLES` only. Doubles, Mixed Doubles, and Relay are out of scope.

**Rationale:** Doubles is not a lighter version of Singles — it's a different problem. Work is split between two athletes by mutual agreement, which means pacing strategy, station-splitting logic, and partner-relative load balancing all become engine inputs. That roughly doubles engine complexity to serve a minority of users.

**Code implication:** the `Division` enum includes all five values (seed data needs them for the load tables and for the PFT's division guidance). The engine must `throw new UnsupportedDivisionError(division)` for the three unsupported ones. **Do not** silently fall back to a Singles plan. Onboarding disables those options with a "coming soon" label.

---

## D2 — PFT is optional, heavily nudged

**Decision:** the benchmark PFT is not a gate. Path B (self-reported proxies) is the default onboarding route. The PFT is prompted at the end of Foundation and end of Build.

**Rationale:** requiring a 25–35 minute maximal fitness test before the user has seen a single screen of value is an onboarding-completion disaster. Worse, a maximal test on an untrained beginner is itself an injury risk — exactly what this product exists to avoid.

**Code implication:** `Baseline.confidence = 'LOW'` for Path B. The engine reduces starting volumes by 15% when confidence is `LOW`, and the UI surfaces "take the benchmark test to sharpen your plan" as a soft prompt, never a blocker.

---

## D3 — Metric internally, imperial as a display toggle

**Decision:** all storage and all engine math in SI units — metres, kilograms, seconds. Imperial exists only at the display layer.

**Rationale:** HYROX is metric everywhere in the world. Storing mixed units is how you get a 152kg sled quietly becoming 152lb.

**Code implication:** no unit fields on any database column. A `formatDistance(m, system)` / `formatLoad(kg, system)` display layer. User preference lives on `AthleteProfile`. Any engine function accepting a number is accepting SI, and its parameter names should say so (`distanceM`, `loadKg`, `durationSecs`).

---

## D4 — No race date is a first-class state, not an error

**Decision:** users without a race date get rolling 4-week Foundation → Build cycles, indefinitely. Plans never expire. At each cycle boundary, prompt (once, dismissible) for a race date.

**Rationale:** a large share of the target audience is "considering" HYROX before committing. Expiring their plan to force a decision is a dark pattern and violates Principle 6.

**Code implication:** `Goal.raceDate` is nullable throughout. The engine needs a separate `generateRollingPlan()` entry point that produces a 4-week block with no Race-Specific or Taper phase. When a race date is later set, F11 recalculation runs and the user keeps all logs.

---

## D5 — English only, i18n scaffolding from day one

**Decision:** ship English-only strings, but route every user-facing string through an i18n layer (`next-intl` or equivalent) from the first commit.

**Rationale:** HYROX participation is growing fast in Japan and wider APAC. Retrofitting i18n after the UI is built is a multi-week refactor; doing it up front costs about a day. This is cheap insurance.

**Code implication:** no hardcoded user-facing strings in components. Locale files under `messages/`. Note that engine-generated content (session titles, rationale text) also needs to be translatable — so the engine should emit **string keys plus parameters**, not prose. This is a real constraint on engine design and needs to be decided before the engine is written, not after.

---

## D6 — Two sessions per week is supported, with a caveat

**Decision:** `sessionsPerWeek` accepts 2–6. The 2-day template is 1 run + 1 hybrid.

**Rationale:** turning away someone honest about having two days is worse than serving them a thin but coherent plan. Two well-chosen sessions still meaningfully improve race readiness over nothing.

**Code implication:** the weekly template table must have a 2-day row (PRD §7.4). The UI shows a non-judgemental note that 3+ sessions is recommended for a first race. Do not block, do not nag repeatedly.

---

## D7 — Dates are date-only, in the user's timezone

**Decision:** no timestamps on training days. `Session.dayOffset` is an integer from `Plan.startDate`. Race date is date-only. `AthleteProfile.timezone` is captured at onboarding.

**Rationale:** "is today Tuesday's session?" is a question that breaks in a dozen subtle ways once UTC timestamps are involved, especially for a user in Japan racing in Europe.

**Code implication:** no `Date` objects with time components in the plan schema. Use a date-only type (a `YYYY-MM-DD` string, or your ORM's `@db.Date`). Resolve "today" against the user's timezone at request time.

---

## D8 — Auth: use a managed provider

**Decision:** do not hand-roll authentication. Use a managed provider (Supabase Auth, Clerk, or Auth.js with a hosted adapter — pick one and move on).

**Rationale:** this is a solo project. Auth is a solved problem and a security liability if done badly. Spending build cycles here is spending them in the wrong place.

**Code implication:** whatever is chosen, the app's own `User` table keys off the provider's user ID. Don't store password hashes.

---

## D9 — Multi-block usage: RoxPlan is a repeat-season tool

**Decision:** the app is designed around **repeated training blocks**, not a single race. HYROX runs a large global race calendar and a meaningful share of athletes race two or three times per season. A user finishing one race is expected to start a new block for their next one.

**Rationale:** the product does not have a built-in end date the way a one-race tool would. Retention is measured per-block, and the natural re-entry point is booking the next race.

**Code implication — this is the part that matters:**
- A user must be able to have **multiple sequential `Plan` records**, not one. Model this explicitly; don't assume one plan per user anywhere in the schema or queries.
- `Baseline.source` must include `'RACE_RESULT'` alongside `'PFT'` and `'SELF_REPORT'`. Block two's baseline should be derivable from block one's actual race splits, which is better input than a fresh self-assessment.
- Store real race splits: per-station times and per-run times from the user's completed race. This is what makes the second plan smarter than the first — the engine can weight `weakestStations` from actual race data rather than self-reported comfort scores.
- **Off-season/maintenance mode between blocks is out of scope for v1**, but the rolling-plan entry point from D4 covers the gap adequately: a user between races with no date set gets rolling Foundation/Build cycles.

**Not building in v1:** race-result analysis UI ("you lost 90 seconds on wall balls"). But the schema must support it without a migration.

---

## D10 — OPEN: Deployment target

Vercel is the path of least resistance for Next.js and has a usable free tier. Postgres via Supabase or Neon pairs with it cleanly. But this depends on your budget, where your users are (latency from APAC matters if you're in Osaka), and whether you care about vendor lock-in.

**Not blocking for the first several build sessions.** Decide before you wire up the database, not before you write the engine.
