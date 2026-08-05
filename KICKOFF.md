# Claude Code — Preparation & Kickoff Guide
## RoxPlan

Everything to do **before** you type your first message in Code mode, then the exact prompts to use.

---

## Part 1 — Pre-flight checklist

Work through this first. It takes about 20 minutes and saves considerably more.

### 1.1 Environment
- [ ] Claude Desktop installed (claude.com/download), signed in, **Code** tab visible
- [ ] Windows only: Git for Windows installed, app restarted afterwards
- [ ] Node.js 20+ installed (`node --version`)
- [ ] Git configured (`git config --global user.name` returns something)
- [ ] A code editor you can read diffs in, if you want a second opinion outside the app

### 1.2 Project folder

```
roxplan/
├── CLAUDE.md              ← from this package, repo root
├── .gitignore
└── docs/
    ├── PRD.md             ← from this package (v0.2)
    ├── DECISIONS.md       ← from this package
    └── research.md        ← rename HYROX_Training_Program_Research.md
```

```bash
mkdir -p roxplan/docs && cd roxplan
git init
printf "node_modules/\n.next/\n.env*\n.DS_Store\ndist/\n" > .gitignore
# copy the four markdown files into place, then:
git add -A && git commit -m "docs: PRD, decisions, research, project rules"
```

That commit matters. It gives you a clean point to return to when a build session goes sideways.

### 1.3 Decisions to make yourself, now

`DECISIONS.md` settles D1–D9. One is yours:

- [ ] **D10 — deployment target.** Not blocking for the first four sessions. Decide before wiring up the database.

### 1.4 Set expectations for yourself

The first four sessions produce **no visible UI**. That's deliberate — the engine is the product, and a pretty interface over a broken plan generator is worse than useless. If you find yourself wanting to skip ahead to screens, resist it.

---

## Part 2 — Session 1: Planning (no code)

Open the Code tab, select the `roxplan/` folder, and paste this:

```
Read these files in full before responding:

- docs/research.md — domain research on HYROX and training program design
- docs/PRD.md — product requirements (v0.2)
- docs/DECISIONS.md — settled decisions, D1 through D8
- CLAUDE.md — project rules

Context: solo project. I want a codebase I can reason about, not a sprawling one.
Prefer boring, well-established choices over clever ones.

Your first task is NOT to write code. Produce a plan:

1. Confirm your understanding of the domain in 5–10 bullets — particularly the
   periodization engine's inputs, outputs, and why determinism is a hard requirement.

2. Propose project structure and tech stack. The PRD suggests Next.js + TypeScript +
   Postgres + Tailwind with the engine as a framework-agnostic module. Disagree if you
   disagree, and say why.

3. The PRD has already been through one round of bug-fixing (see the v0.2 changelog).
   Assume more errors remain. Identify anything you find that is ambiguous,
   self-contradictory, or under-specified — especially in §7.1 phase allocation,
   §F8 guardrails, and §8 data model. Ask me about those before building.

   In particular, check the data model against DECISIONS.md D9: users train in
   multiple sequential blocks across a season, so nothing may assume one plan
   per user. Tell me if §8 as written breaks that.

4. Propose a build order that gets me something testable as early as possible. The
   engine must be built and unit-tested before any UI exists.

Do not create files yet. Give me the plan and wait for approval.
```

**What to look for in the answer:** if it doesn't find at least one problem in the PRD, it probably didn't read carefully enough — push back and ask it to look harder at the interaction between guardrail #1 and guardrail #3.

---

## Part 3 — Subsequent sessions

One prompt per session. Start a fresh session for each — context stays clean and rollback is easier. **Commit between every one.**

### Session 2 — Scaffold
```
Approved. Scaffold the project: Next.js App Router + TypeScript strict + Tailwind,
with the engine as a standalone module at lib/engine/ having zero framework
dependencies. Set up the database schema from PRD §8 — note that Plan is immutable
and SessionAdjustment is a separate event log; do not collapse them.

Set up the i18n layer now (per DECISIONS.md D5), not later.

No UI beyond what the framework generates by default. Show me the file tree when done.
```

### Session 3 — Seed data & types
```
Implement the seed data from PRD §5: the 8 stations in fixed order, division load
tables keyed by (division, sex, station), and the PFT definition.

Versioned seed files under seeds/ as the PRD specifies — race loads change between
seasons and must not be hardcoded in engine logic.

All SI units, with unit-carrying parameter names. Full TypeScript types.
Per DECISIONS.md D1, the Division enum includes all five values but the engine will
reject the three unsupported ones — set up UnsupportedDivisionError now.
```

### Session 4 — The engine (the important one)
```
Build the periodization engine per PRD §F3 (7.1 through 7.8).

Hard requirements: pure functions, zero framework dependencies, no network calls,
no LLM calls, no unseeded randomness. Same inputs → same plan, always.

Build incrementally and show me each piece before moving on:
  (a) phase allocation (§7.1) — the largest-remainder algorithm. Assert the parts
      sum exactly to weeksToRace, and test EVERY integer from 5 to 52.
  (b) weekly template selection by available days (§7.4), including the 2-day case
  (c) background modifiers — RUNNER / STRENGTH / HYBRID / BEGINNER (§7.3)
  (d) gated sessions with fallbacks (§7.5) — this is how determinism survives
      progress-dependent unlocking. Get this right.
  (e) insufficient-runway path for weeksToRace ≤ 4 (§7.6)
  (f) compromised-running progression (§7.7)
  (g) session block generation with concrete prescriptions

Write unit tests as you go, not at the end. Remember the engine emits i18n keys plus
parameters, not prose.
```

### Session 5 — Guardrails
```
Implement the 8 safety guardrails from PRD §F8 as a validation pass over any generated
plan. Hard failures in tests, not warnings.

Pay attention to the interaction between rule 1 (volume ceiling as 110% of the
3-week rolling max) and rule 3 (deload weeks). The v0.1 spec had these in direct
contradiction; verify the v0.2 formulation actually resolves it, and tell me if it
doesn't.

Then write adversarial tests that deliberately try to generate unsafe plans:
- BEGINNER, 6 sessions/week, 4-week race window
- RUNNER whose volume would jump 30% week-over-week
- any plan with a race simulation 5 days out
- a deload week landing immediately before the taper
- a gated session with no fallback
- DOUBLES division requested

Assert the validator catches every one.
```

### Session 6 — Human-readable snapshots
```
Generate full plans for these profiles and print them as readable week-by-week tables
(not JSON) so I can review them as a human:

1. BEGINNER, 16 weeks out, 3 days/week, bodyweight + dumbbells only
2. RUNNER, 12 weeks out, 5 days/week, full commercial gym
3. STRENGTH, 8 weeks out, 4 days/week, full HYROX gym
4. HYBRID, no race date, 4 days/week, home gym
5. BEGINNER, 3 weeks out (insufficient runway path)
6. HYBRID, 5 weeks out, 2 days/week (minimum viable case)

Save these as snapshot tests. I want to read them and judge whether they'd actually
be sensible to train.
```

> **Do not skip this session.** A plan can pass every automated test and still be one no sensible coach would prescribe. This is the failure mode tests don't catch, and you're the only one who can catch it.

### Session 7 — UI, finally
```
Engine is solid. Build the UI in this order: onboarding (PRD §F1), weekly plan view
(§F4), session detail with equipment substitution (§F5), logging (§F6).

Keep it calm and legible — this is an app people open when tired, often on a phone at
the gym. Large touch targets, minimal chrome, mobile-first responsive.

No dark patterns, per CLAUDE.md rule 4. Adherence UI is supportive, never loss-framed.
```

### Session 8 — Auto-regulation
```
Implement the readiness check-in and auto-regulation rules from PRD §F7.

Critical: these write SessionAdjustment records. Nothing mutates Plan. Verify that a
plan regeneration preserves all prior adjustments and logs via sessionKey.
```

---

## Part 4 — Working habits

- **Keep permission mode on "Ask"** for the first few sessions. You'll learn how it approaches problems, and redirecting early beats unpicking a large diff.
- **Commit after every session.** Especially after the engine passes tests — that's the piece you least want to lose.
- **Use side chats** for questions mid-build, so you don't inject context that steers the main task.
- **When it proposes something that contradicts CLAUDE.md,** say so directly and point at the rule. It should correct course; if it argues, hear the argument — the rules aren't sacred, but they were written deliberately.
- **If a session goes badly, `git reset` and re-prompt** rather than trying to talk your way out of a tangled diff. Cheaper every time.
