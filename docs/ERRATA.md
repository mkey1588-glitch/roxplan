# PRD Errata & Findings Register

**Against:** `docs/PRD.md` v0.2
**Opened:** 2026-07-30 (planning session, before any code)

Two parts:

- **Part 1 — Amendments (R1–R6).** Decided, authoritative. Where these differ from PRD v0.2, **this document wins.** Fold into PRD v0.3 when convenient.
- **Part 2 — Findings register (F04–F34).** Defects found against v0.2, plus those found during implementation. Resolved entries are struck through and say what resolved them; the rest carry a proposed resolution. Severity: **P0** = produces a wrong or unbuildable engine; **P1** = will need rework; **P2** = tidy-up.

**Still wanting your input:** F32 (race-pace formula is an unvalidated modelling assumption — needs a coach's eye at the step-7 snapshot review), F17 (define the high-intensity session set), F19 (what to do when the PFT recommends Doubles).

Section references (`§7.1`, `F8.3`) are to `docs/PRD.md`. Decision references (`D9`) are to `docs/DECISIONS.md`.

---

# Part 1 — Amendments

## R1 — Plan calendar is race-anchored, with an unstructured lead-in

Amends §7.1, §8 (date semantics). Resolves the calendar-anchoring ambiguity — the PRD never said whether plan weeks anchor to `startDate` or to race day, nor where the leftover days go. See also F30, a defect found in this amendment itself.

```
availableDays = differenceInDays(todayLocal, raceDate) + 1   // inclusive of both ends
weeksToRace   = floor(availableDays / 7)
leadInDays    = availableDays - (7 * weeksToRace)            // 0-6
startDate     = raceDate - (7 * weeksToRace) + 1
raceDate      = startDate + (7 * weeksToRace) - 1   // race day = final day of the taper week
week N        = dayOffset [7(N-1) .. 7N-1]          // every plan week is exactly 7 days
```

> **Corrected 2026-08-05 (see F30).** This block originally read
> `weeksToRace = floor(daysUntilRace / 7)` over an *exclusive* day difference,
> which contradicts R1's own "leftover 0–6 days" — it yields 1–7 — and
> silently discards a usable training week. Counting inclusively is the
> reading that makes the stated leftover range true.

The leftover 0–6 days between today and `startDate` are an **unstructured lead-in**: no prescriptions, not a week 0, outside the plan, and carrying no guardrail obligations.

Consequences for the engine:

- `startDate` is **derived**, not supplied. The engine takes `todayLocal` + `raceDate` and computes both `startDate` and `weeksToRace`. It never reads the clock itself.
- Plan weeks are not calendar weeks and need not begin on a Monday. `AthleteProfile.availableDays[]` is therefore a **soft weekday preference** used to order sessions within a 7-day window, not a hard schedule.
- §7.2's "2 full rest days before race day" is placeable because race day is always `dayOffset` `7*weeksToRace - 1`.
- Rolling plans (D4) have no race date: `startDate = todayLocal`, no lead-in.

## R2 — Guardrail 1 counts every planned running metre; simulation weeks displace other running

Amends F8.1, §7.2, §7.3. Resolves the collision between §7.2's simulation cadence and F8.1's volume ceiling, and supersedes the §7.3 `RUNNER` wording.

**Weekly running volume** = the sum of **all planned running metres** in the week, including compromised-run segments and race-simulation running. Race-Specific weeks containing a simulation must reduce their other running so the week still fits under the ceiling.

```
sim week:     8 000 m simulation + 14 000 m other  = 22 000 m
non-sim week:                      22 000 m other  = 22 000 m
=> ceiling never breached; weekly load stays flat across the simulation cycle
```

Consequences for the engine:

- **Generation order inverts.** The engine computes each week's **running budget first**, then allocates that budget across the week's sessions. It does *not* generate sessions and total them up afterwards. This is what makes F8.1 satisfiable by construction rather than by retry, and it is the most significant architectural consequence of this document.
- The F8.1 three-week lookback is over **planned** volume, so a generated plan is statically validatable.
- A **separate render-time rule** checks logged **actual** volume, to catch return-from-absence (a user who missed three weeks must not be handed a full-volume week).
- F8.1 is stated **once**, canonically, in the guardrail module. §7.3's `RUNNER` line "running volume increase capped at 5%/week" is amended to **"105% of the 3-week planned maximum"** — the "5%/week" phrasing is the previous-week formulation that caused the v0.1 deload deadlock, and must not reappear.

## R3 — Onboarding captures current weekly running volume

Amends §F1 step 3, §F2, §8 (`Baseline`). Resolves F8.1's missing baseline for weeks 1–3 — onboarding captured longest continuous run but never weekly volume.

Add to onboarding: **typical weekly running distance over the last month.** Stored SI as `weeklyRunDistanceM`.

- **Required**, because it seeds a hard safety rule (F8.1 has no lookback data for weeks 1–3 without it). §F1's current fields capture only *longest continuous run*, which says nothing about weekly volume.
- Offer an explicit "I don't run regularly" answer that maps to a conservative beginner floor — never to a missing value.
- D2's "reduce starting volumes by 15% when confidence is `LOW`" applies to this figure. Until now that rule had no defined operand.

## R4 — Absorption is render-layer only; `Plan` is never regenerated for adherence

Amends §F7, §8. Resolves the contradiction between §F7's "recalculate forward" and §8's claim that `Plan` is regenerable from `(inputs, engineVersion)`. Folds in F22, and the risk that an auto-regulated deload lands adjacent to the taper — recreating the exact bug F8.3 was written to prevent.

```
Plan (immutable, inputsHash stable)
  + SessionAdjustment[]      <- missed-session absorption lives here
  + gate resolution
  = rendered week            -> re-validated by the guardrail pass
```

Adherence is **not** an engine input. `inputsHash` therefore stays meaningful, and `Plan.version` increments only on genuine input changes (race date, availability, equipment, new baseline).

§F7's "Recalculate forward" is amended to mean **forward-looking `SessionAdjustment` records**, not plan regeneration. "Absorbed, never stacked" (CLAUDE.md rule 5) is unchanged and is implemented here.

Consequences for the engine:

- **The guardrail validator runs in two places** — over generated plans *and* over rendered weeks. Mandatory, not optional: overrides (F8.8) can raise load, and adjustments can restructure a week.
- **Auto-regulated deloads inherit F8.3's suppression window.** Without this, §F7's "3+ consecutive low-readiness days → suggest a deload" can drop a deload immediately before the taper — exactly the two-consecutive-easy-weeks bug F8.3 was written to prevent.
- **`SessionAdjustment.delta{}` needs a typed, versioned, scoped schema.** It must target a specific `SessionBlock`, and must only apply when the target session still matches — after a race-date change regenerates the plan, a "−40% volume" adjustment keyed to a date would otherwise land on a completely different session type.

## R5 — Race loads and rep counts come from the 26/27 Singles rulebook, and three PRD figures were wrong

Amends §5.1, §5.2. Resolves finding F25. Verified against the official [HYROX EN SINGLE RULEBOOK 26/27](https://maintain.hyrox.com/rulebooks/HYROX_RulebookSingles_EN.pdf), sections 8.2, 8.3, 8.6, 8.7, 8.8, retrieved 2026-08-05.

**Three corrections, in descending order of how much damage they would have done:**

1. **Open wall-ball loads in the PRD are wrong, and so is `research.md`.** §5.2 gives Open as "Wall Ball 9kg→10ft (men) / 6kg→9ft (women)", and `research.md` §2.2 repeats it. The rulebook is unambiguous: **Open is 6kg for men and 4kg for women.** The 9kg figure is *Men Pro*. Prescribing 9kg wall balls to an Open first-timer for 100 reps at the end of a race simulation is exactly the kind of overload this product exists to prevent.
2. **Wall balls are 100 reps for every division and both sexes.** §5.1's "75–100 reps (division dependent)" is wrong; §5.2 and `research.md` §2.2 ("only the weights change") are right. Correct §5.1.
3. **Target heights are metric and exact: 2.70m for women, 3.00m for men.** The PRD's "10ft / 9ft" are imperial approximations that do not convert cleanly (10ft = 3.048m, 9ft = 2.743m). Per D3 the metric values are authoritative and imperial is display-only.

**Structural finding — the load table is one ladder, not two.** The rulebook prints `WOMEN PRO / MEN` as a single row at every loaded station, so **a Pro woman lifts exactly what an Open man lifts**. §5.2's "keyed by `(division, sex, station)`" is still the right storage shape, but the equality is a domain invariant and is asserted in `lib/seeds/index.test.ts` so a future season update cannot silently break it. Wall-ball *target height* is the sole exception: it tracks sex only, never the ladder.

| Station | Women Open | Women Pro / Men Open | Men Pro |
|---|---|---|---|
| Sled Push (50m) | 102 kg | 152 kg | 202 kg |
| Sled Pull (50m) | 78 kg | 103 kg | 153 kg |
| Farmers Carry (200m) | 2 × 16 kg | 2 × 24 kg | 2 × 32 kg |
| Sandbag Lunges (100m) | 10 kg | 20 kg | 30 kg |
| Wall Balls (100 reps) | 4 kg @ 2.70m | 6 kg @ 2.70m (W) / 3.00m (M) | 9 kg @ 3.00m |

Sled figures are total mass **including the sled itself**, as the rulebook states.

**Doubles, Mixed Doubles and Relay have no load data.** The Singles rulebook does not cover them and I will not infer them. `seeds/divisions.2026-27.json` omits those divisions and the loader throws `MissingDivisionDataError`, which is distinct from the engine's `UnsupportedDivisionError` (D1): "we have no data" is not the same as "the engine refuses to plan this".

## R6 — Gate semantics: monotonic progress, a plan-scaled simulation threshold, and counted fallbacks

Amends §7.5, §F6. Resolves findings F14 and F15. Approved 2026-08-05.

**Latching is structural, not a flag.** Every field of `GateProgress` is monotonic — a maximum, a count, or elapsed time — so a satisfied condition can never become unsatisfied. F14 asked whether the unlock latches or re-evaluates; making the *inputs* monotonic answers it without a latch bit to keep in sync, and keeps gate resolution a pure function of current progress.

**`CONTINUOUS_RUN_MINUTES` gets a data source** (F14). §F6's log records session duration, which for a run/walk beginner is strictly longer than their unbroken running — so the gate had nothing valid to read. Runs now log `continuousRunSecs` explicitly, and progress is **seeded from `Baseline.longestRunMins`**: a beginner who reported 35 minutes at onboarding is not locked out of intervals in week 1 for want of a log entry.

**The simulation threshold scales to the plan** (F15). A flat threshold of 3 compromised runs is unreachable in a 6-week plan, which schedules only 2 before Race-Specific — the gate would never open and the athlete would never rehearse the race at all. The threshold is now `clamp(scheduledBeforeFirstSimulation, 1, 3)`: it keeps the safety intent (you must have done the preparatory work the plan actually contains) while staying reachable. **It never falls to 0** — a simulation with no rehearsal is precisely what the gate exists to prevent.

**Fallback completions count** (F15). A locked simulation falls back to a compromised run, and completing it is genuine transition practice; refusing to count it would be perverse. This cannot self-unlock: progress is read *before* the day's session is served, so an increment only ever affects a later session.

**Guardrail 6 is unbreakable by construction.** `Gate.fallbackType` is a required field, not an optional one, so a gated session without a fallback cannot be represented. Validation additionally rejects a fallback identical to the gated session, and rejects falling back to `REST` — a locked session should still train something.

---

# Part 2 — Findings register

## Verified correct (no action)

- **§7.1 worked-examples table.** All six rows (20, 16, 12, 8, 6 weeks, and 12-week BEGINNER) reproduce exactly under the stated algorithm. The table is right.
- **F8.1 vs F8.3 — the v0.2 rewrite does resolve the v0.1 contradiction.** Ramp 20 → 22 → 24.2 km, deload week 4 to 14.5 km; week 5's ceiling is `1.10 × max(22, 24.2, 14.5) = 26.6 km`, so the return to full volume is legal. The 3-week rolling maximum works. The residual problems were F01/F02 (now amended by R2/R3) and F03.

## D9 (multi-block) violations in §8

| # | Sev | Finding | Proposed resolution |
|---|---|---|---|
| **F04** | P0 | **`Plan(id, userId, version, …)` cannot express sequential blocks.** With only `userId` + `version`, there is no way to distinguish "v2 supersedes v1" (regeneration, per §8) from "block 2 for the next race" (D9). Two different relationships collapsed into one integer. | Introduce `TrainingBlock(id, userId, goalId, baselineId, startDate, status, createdAt)`. `Plan` belongs to a block and versions *within* it. |
| **F05** | P0 | **`Goal(userId, …)` reads as a singleton per user.** Block 2 targets a different race; editing the goal in place destroys block 1's provenance and makes its `inputsHash` unverifiable. `AthleteProfile` has the same problem — it is mutable yet feeds `inputsHash`. | Goal gets its own id and is snapshotted per block. Snapshot the profile fields that feed `inputsHash` at generation time. |
| **F06** | P0 | **`sessionKey = (userId, date)` collides across blocks**, which D9 makes realistic (a new block created during the previous race week) — a block-1 log would attach to a block-2 session. It also hardcodes **one session per calendar day**, while the research recommends separating strength and endurance by several hours. | `sessionKey = (blockId, date, slot)`. |
| **F07** | P1 | **D9's mandated fields are absent.** D9 requires `Baseline.source` to include `'RACE_RESULT'`; §8 and §F2 list only `'PFT' \| 'SELF_REPORT'`. D9 requires storing per-station and per-run race splits; there is no `RaceResult` entity. `Baseline` also has no id despite needing to be a history (PFT re-tests at end of Foundation *and* Build, plus race results). | Add `'RACE_RESULT'`; add `RaceResult(id, userId, raceDate, division, totalSecs, stationSplits{}, runSplits{})`; give `Baseline` an id. |

## Other P0 findings

| # | Finding | Proposed resolution |
|---|---|---|
| **F08** | ~~**The 6-day weekly template is arithmetically broken and violates F8.4.** §7.4's "3 run, 2 strength, 1 hybrid + 1 recovery" is **7 sessions**, leaving no day for the mandatory full REST day in a 7-day week.~~ | **RESOLVED — approved 2026-08-05.** Six counted sessions (3 run, 2 strength, 1 hybrid) + 1 REST. `RECOVERY_MOBILITY` stays in the session-type enum for auto-regulation to downgrade into, but is never a scheduled training day. `lib/engine/templates.ts`. |
| **F09** | ~~**The `RUNNER` modifier overflows the week.** §7.3's "+1 strength session/week in Foundation" is additive on top of the template, so a 5-day RUNNER gets 6 sessions and a 6-day RUNNER gets 7–8 — exceeding the athlete's stated availability and destroying the rest day.~~ | **RESOLVED — approved 2026-08-05.** Substitutive: a run becomes a strength session, so the week never exceeds stated availability and the rest day survives. A deliberate no-op at 2 and 3 days/week, where only one run exists to trade. `lib/engine/templates.ts`. |
| **F10** | **§7.3 contradicts §7.7.** `STRENGTH` background: "compromised running introduced one week earlier" — earlier than Build week 1 is Foundation, where §7.7 says compromised running is "not prescribed". | Introduce it in the final Foundation week for `STRENGTH` only, and amend §7.7's Foundation row to say so. |
| **F11** | **§7.1 is not fully deterministic as written.** `largestRemainderRound` has no tie-break rule and ties genuinely occur: `weeksToRace` = **11, 31, 51** each produce an exact 0.5/0.5 tie between Build and Race-Specific (w=11 → floors 4/3/2, one week to distribute). Compounded by float arithmetic: `0.35 × r` yields values like `4.19999…`. | Integer math (scale by 100) plus a documented tie-break priority: **`raceSpec > build > foundation`**. Test w=11/31/51 explicitly. |
| **F12** | **`fallbackSessionId` has no valid home in the schema.** §8's `Session` requires a `dayOffset`, so a fallback session either double-books the gated session's day or breaks the model — and it collides with `sessionKey`. | Fallbacks are unscheduled variants: nullable `dayOffset`, or inline `fallbackBlocks` on the gated session. |
| **F13** | **`Session(title, rationale)` are prose columns**, contradicting D5 and CLAUDE.md ("engine emits i18n keys + parameters"). | `titleKey`, `rationaleKey`, `params{}`. |

## P1 findings

| # | Finding | Proposed resolution |
|---|---|---|
| **F14** | ~~**`CONTINUOUS_RUN_MINUTES` (§7.5) has no data source.** §F6 logs session duration and distance; nothing records *continuous* running minutes, which for a BEGINNER on run/walk progression is strictly less than session duration. Also unspecified: does `Baseline.longestRunMins` satisfy the gate at week 1 (a beginner who already runs 35 min should not be gated)? Is the unlock latched, or re-evaluated daily and therefore able to flap?~~ | **RESOLVED by R6 — approved 2026-08-05.** Runs log `continuousRunSecs`; progress seeds from `longestRunMins`; latching is structural via monotonic accumulators. `lib/engine/gates.ts`. |
| **F15** | ~~**In short plans the race simulation can never unlock — or unlocks itself.** `RACE_SIMULATION` is gated on ≥3 completed compromised runs; a 6-week plan has 2 Build weeks × 1 hybrid = 2 compromised runs before Race-Specific, so the gate never opens. And because the *fallback* for a locked simulation is itself a compromised run, completing the fallback increments the counter that unlocks the thing it replaced. Separately, F8.5 (no simulation within 10 days of race) leaves only a 1–3 day placement window in 6- and 8-week plans. | Needs a decision: lower the gate threshold for short plans, or accept that short plans legitimately get no full simulation. State explicitly whether fallback completions count toward the gate.~~ | **RESOLVED by R6 — approved 2026-08-05.** Threshold scales to what the plan schedules, clamped to 1–3 so it is always reachable and never zero. Fallback completions count; they cannot self-unlock. `lib/engine/gates.ts`. |
| **F16** | **Deload cadence is under-specified (F8.3).** "Every 4th week" — counted from plan start or phase start? When a deload is suppressed, is it dropped or deferred (does the counter reset)? Is "within 3 weeks of race day" inclusive? | Count from plan start; suppressed deloads are **dropped**, not deferred; "within 3 weeks" is inclusive. |
| **F17** | **"Never two consecutive high-intensity days for BEGINNER" (§7.4) is unimplementable as stated.** "High intensity" is never defined against the session-type enum. At 6 sessions/week with one rest day the six training days are contiguous, so at most 3 can be non-adjacent — the constraint implicitly caps BEGINNER high-intensity work at ≤3/week. Is it a validated hard constraint (a 9th guardrail) or a scheduler preference? | Define the high-intensity set explicitly (`INTERVAL_RUN`, `RACE_SIMULATION`, `COMPROMISED_RUN`, heavy `STRENGTH_*`) and make it a validated rule. |
| **F18** | **F8 rule 8 is not a plan property.** "Manual overrides are logged with a warning" is a UI/logging requirement; a validator over a `Plan` cannot check it. | F8 is **7 validatable rules + 1 process requirement**. Say so in the test suite rather than writing a fake test. |
| **F19** | **The PFT can recommend a division the engine refuses.** §5.3 maps 30–45 min to Doubles, so `recommendedDivision` may be `DOUBLES`, which D1 requires the engine to reject with `UnsupportedDivisionError`. | Product decision needed: clamp to `OPEN_SINGLES` with an explanation, or surface "Doubles may suit you better, but we don't support it yet". |
| **F20** | **`AthleteBaseline` (§F2) and `Baseline` (§8) are different shapes.** `weakestStations` and `recommendedDivision` are computed in §F2 but never persisted; `stationComfort{}` / `computedScores{}` appear only in §8. | One canonical type. Decide per field whether it is stored or recomputed. |
| **F21** | **`Plan.inputsHash` must cover the seed-data version** and `engineVersion`, or a `seeds/divisions.<season>.json` change silently alters plans without invalidating the hash. Also: `Plan.status` values undefined; `Phase` has no id or ordinal; `Phase.weekStart/weekEnd` don't say whether they are week indices or dates; `Override` is keyed to `planId` rather than `sessionKey`, so unlike everything else it does not survive regeneration. | Hash `(inputs, engineVersion, seedVersion)`. Enumerate `Plan.status`. `Phase.weekStart/weekEnd` are **week indices**. Re-key `Override` to `sessionKey`. |
| **F22** | **`SessionAdjustment.delta{}` is untyped and unscoped.** See R4 — folded in there. | Discriminated, versioned schema targeting a specific `SessionBlock`, applied only on session-type match. |
| **F23** | **D4's rolling-plan structure is under-specified.** Is each 4-week cycle wholly Foundation or Build, or 2+2? Where does the mandatory 4th-week deload sit relative to the cycle boundary? How does F8.1's lookback behave across cycle boundaries? | Not blocking until `generateRollingPlan` is built. Decide then. |
| **F24** | **Cross-block continuity is undefined for F8.1 and F8.2.** Block 2's week 1 follows a taper + race week, so both the volume ceiling and the "+1 session/week" cap are computed against an artificially low three weeks — either blocking a legitimate return to training or requiring an explicit reset rule. D9 makes this a real scenario. | A new block resets the lookback, seeded from R3's `weeklyRunDistanceM` re-captured (or carried from pre-taper volume). |

## P2 findings

| # | Finding | Proposed resolution |
|---|---|---|
| **F25** | ~~**Seed-data contradiction.** §5.2 says only weights change between divisions; §5.1 says wall balls are "75–100 reps (division dependent)"; `research.md` §2.2 says rep counts stay constant.~~ | **RESOLVED by R5.** §5.1 was wrong (100 reps for everyone). Checking the rulebook also turned up a worse error the original finding missed: the PRD's and `research.md`'s **Open wall-ball weights are wrong** — 6kg/4kg, not 9kg/6kg. |
| **F26** | For `BEGINNER` at exactly 8 weeks, Build and Race-Spec are already at their minimums (3/2/2), so §7.3's "extend Foundation up to 2 weeks" silently becomes a no-op. | Probably acceptable — §7.5 gating carries the beginner safety. Confirm it is deliberate. |
| **F27** | Undefined edge inputs: race date today or in the past (`weeksToRace ≤ 0`); `availableDays.length < sessionsPerWeek`. | Explicit handling and error types for both. |
| **F28** | §7.3 `RUNNER`: "station-strength work introduced earlier" — earlier than what? §7.2 already puts light-load station work in Foundation. As written it is a no-op. | Either delete the line or make it concrete. |
| **F29** | Repo had no git history and no `.gitignore`. | Done in this commit. |

## Found during implementation

| # | Sev | Finding | Resolution |
|---|---|---|---|
| **F34** | P1 | **A full race simulation can exceed a low-volume athlete's entire weekly running budget.** A simulation is 8km of running on its own. An athlete whose Race-Specific budget is below that — a beginner who started around 4km/week, say — would breach guardrail 1 from the simulation alone, with nothing left to displace. | **Handled conservatively:** the simulation is skipped when the week's budget cannot cover it, and the hybrid stays a compromised run. Their gate and fallback still deliver transition practice. **Better fix deferred:** §7.2 says "full *or near-full* simulations", so a scaled rehearsal (4 stations + 4km) would serve these athletes better than none. Worth revisiting at the step-7 snapshot review. |
| **F32** | **P1 — wants a coach's eye** | **Race-pace estimation is a modelling assumption with no source.** §7.8 says goal race pace is "estimated from 5km time if provided" but gives no formula, and `research.md` establishes only that coaches use a recent 5–10km trial and that the race demands threshold-adjacent effort for 60–90+ minutes. I implemented `racePace = fiveKPace × 1.15`, chosen so a 25-minute 5k athlete is prescribed ~5:45/km against the ~6:22/km average the lab study reports for an ~86-minute finish. The per-zone multipliers (easy 1.25, Zone 2 1.15, threshold 1.0, hard 0.92) are the same kind of assumption. | **Implemented but unvalidated.** Isolated in named constants in `lib/engine/progression/running.ts` so it is one edit to change. Deliberately errs slow: a pace slightly too easy costs a little time, one too hard is how a first-timer blows up at the sled. **Needs review at the step-7 snapshot read.** |
| **F33** | P2 | **Two §7.7 prescriptions are ranges, which is non-deterministic.** "Build wk 3+: ×3–4 rounds" does not say which, and Taper is given only as "1 short session, reduced volume, race pace only". | **RESOLVED.** Build week 3 gets 3 rounds and week 4+ gets 4, so volume still progresses rather than sitting at an arbitrary point in the range. Taper is 2 rounds at race distance — 50% of the Race-Specific load, the upper end of §7.2's "volume cut 40–50%", asserted as such in the tests. |
| **F31** | P1 | **The weekly template repeats identically, so day 6 and day 0 are always adjacent across the week boundary — and can be the same kind.** At 4 sessions/week the slots are `RUN _ STRENGTH _ HYBRID _ RUN`, so every week ends and the next begins with a run. At 6 sessions/week the same happens, though there it is partly inherent: six training days in seven leaves only one gap. Within a week the scheduler never repeats a kind on consecutive days (tested), but it does not currently look across the boundary. This matters most for **BEGINNER at 6 days/week** — the exact adversarial case in the step-6 guardrail list — where §7.4 says "never two consecutive high-intensity days". | **Deferred, not fixed.** The fix depends on F17: until the high-intensity session set is defined, "same kind on consecutive days" and "two consecutive high-intensity days" are different constraints and a scheduler change could satisfy one while breaching the other. Two candidate fixes: rotate the slot sequence by week, or forbid the first and last slot sharing a kind. **The step-6 guardrail pass must evaluate consecutive-day rules across week boundaries, not only within a week.** |
| **F30** | P1 | **R1's own week formula was off by one against its own stated leftover range.** `weeksToRace = floor(daysUntilRace / 7)` over an exclusive day difference yields a leftover of 1–7 days, not the 0–6 R1 states one line later. The practical cost is a discarded training week: a race 13 days out leaves 14 usable days — two whole weeks — but the exclusive form gives a 1-week plan with a 7-day lead-in. | **RESOLVED.** Count `availableDays` inclusively (`differenceInDays + 1`). R1's code block is corrected above. `lib/engine/calendar.test.ts` asserts the 0–6 lead-in range and the "never discard a usable week" property across every horizon from 0 to 400 days. |
