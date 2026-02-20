# The Architect's Factory: An AI-Native Development Architecture

**Your role: Architect. Claude's role: Everything else.**

---

## 1. Philosophy

You don't write code. You don't review code. You define *what* the system should do, *why* it should do it, and *how you'll know it's working*. Claude Code does the rest — writing, refactoring, debugging, testing, and iterating until the system satisfies your specification.

This architecture transitions you from **vibe-coding** (conversational, improvised, fragile) to a **factory** (repeatable, autonomous, verifiable). The factory has three layers:

```
┌─────────────────────────────────────────────────┐
│                 YOU (Architect)                  │
│         Specs · Scenarios · Decisions            │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              SEED LAYER                         │
│   Natural language specs that define intent      │
│   PRDs · ADRs · Scenario files · Constraints     │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│            EXECUTION LAYER                      │
│   Claude Code turns specs into working code      │
│   CLAUDE.md · Agents · Hooks · Automation        │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│           VALIDATION LAYER                      │
│   Automated proof that the code is correct       │
│   Scenarios · E2E tests · CI gates · LLM judge   │
└─────────────────────────────────────────────────┘
```

The feedback loop runs continuously: validation failures feed back into the execution layer until all scenarios pass. You only intervene when the system needs a new architectural decision.

---

## 2. The Seed Layer — What You Actually Do All Day

### 2.1 Specification Documents (Specs)

Every feature, change, or product starts as a **spec** — a natural language document stored in your repo. This is the source of truth, not the code.

**Directory structure:**

```
/specs
  /features
    user-auth.md
    billing.md
    dashboard.md
  /architecture
    database-schema.md
    api-design.md
    deployment.md
  /scenarios
    auth-scenarios.md
    billing-scenarios.md
    edge-cases.md
  /decisions
    adr-001-database-choice.md
    adr-002-auth-provider.md
```

**Spec format — keep it consistent:**

```markdown
# Feature: [Name]

## Intent
What this feature does and why it exists. Written for a human reader
AND for Claude. Be precise about outcomes, not implementation.

## Constraints
- Must work across web, API, mobile, and CLI surfaces
- Must not break existing scenarios
- Performance budget: [specific numbers]
- Security requirements: [specific requirements]

## Behavior
Describe what the user/system experiences. Use concrete examples:

When a user signs up with email and password:
- They receive a verification email within 30 seconds
- The email contains a 6-digit code valid for 10 minutes
- After 3 failed attempts, the code is invalidated
- After verification, they land on the onboarding flow

## Out of Scope
What this feature explicitly does NOT do. This prevents Claude
from over-building.

## Open Questions
Decisions you haven't made yet. Claude should ask about these
rather than guess.
```

### 2.2 Architecture Decision Records (ADRs)

Every significant decision gets an ADR. These accumulate into a knowledge base that Claude reads before writing code.

```markdown
# ADR-003: Use PostgreSQL with Row-Level Security

## Status: Accepted

## Context
We need multi-tenant data isolation. Options considered:
separate databases, schema-per-tenant, RLS.

## Decision
Row-Level Security. Single database, single schema,
policies enforce tenant isolation at the database layer.

## Consequences
- Claude must include RLS policies in all migration specs
- Every table must have a tenant_id column
- All queries must go through authenticated sessions
- Testing requires per-tenant scenario isolation
```

### 2.3 Scenario Files

Scenarios are the contract between you and the AI. They define "done." They live *outside* the application code to prevent Claude from gaming them.

```markdown
# Scenario: New user signup (happy path)

## Setup
- Clean database with no existing users
- Email service is available
- Rate limiter is reset

## Steps
1. POST /api/auth/signup with {email, password}
2. Assert: 201 response with {user_id, status: "pending"}
3. Assert: email service received exactly 1 verification email
4. Extract code from email
5. POST /api/auth/verify with {user_id, code}
6. Assert: 200 response with {token, status: "verified"}
7. GET /api/me with bearer token
8. Assert: 200 response with user profile

## Failure Modes to Also Test
- Duplicate email → 409
- Weak password → 422 with specific error
- Expired code → 401
- Invalid code 3x → code invalidated, must request new one
```

---

## 3. The Execution Layer — How Claude Code Builds Your Product

### 3.1 CLAUDE.md — The Factory Configuration File

Your `CLAUDE.md` is the most important file in the repo. It's Claude Code's operating manual. Treat it like infrastructure.

```markdown
# CLAUDE.md

## Role
You are the sole developer on this project. The human is the
architect. They write specs, you write code. Never ask the human
to write, edit, or review code. If something is broken, fix it.
If something is ambiguous, check the specs/ directory first,
then ask.

## Workflow
1. Before writing ANY code, read the relevant spec in /specs/
2. Before writing ANY code, read related ADRs in /specs/decisions/
3. Write code that satisfies the spec
4. Run the scenario validation suite: `make validate`
5. If scenarios fail, fix the code — do NOT modify scenarios
6. Continue until all scenarios pass
7. Run the full test suite: `make test`
8. Run linting and type checking: `make lint`
9. Commit with a conventional commit message referencing the spec

## Architecture Rules
- All product types (web, API, mobile, CLI) share a core domain layer
- Business logic lives in /src/core/ — no framework dependencies
- Each surface (web, api, mobile, cli) adapts the core
- Database migrations are in /migrations/ — never modify existing ones
- Every public API endpoint must have an OpenAPI spec in /specs/api/

## Code Standards
- TypeScript strict mode, no `any`
- All functions must have JSDoc with @param and @returns
- No console.log in production code — use the logger
- Error handling: never swallow errors, always propagate or log
- No new dependencies without checking /specs/decisions/ for constraints

## When You're Stuck
1. Re-read the spec — the answer is usually there
2. Check ADRs for relevant architectural decisions
3. If genuinely ambiguous, ask the architect ONE specific question
4. Never guess at business logic — ask

## Never Do
- Modify scenario files in /specs/scenarios/
- Skip the validation suite
- Add TODO comments — fix it now or flag it as an open question
- Rewrite tests to match broken code
```

### 3.2 Task Decomposition — From Spec to Working Code

When you hand Claude Code a feature spec, the execution follows this cascade:

```
Architect writes spec
        │
        ▼
Claude reads spec + ADRs + existing code
        │
        ▼
Claude creates an implementation plan (in conversation or /plans/)
        │
        ▼
You approve or adjust the plan (30-second gut check)
        │
        ▼
Claude implements across all affected surfaces
        │
        ▼
Claude runs validation → scenarios pass? ──No──→ Claude fixes
        │                                            │
       Yes                                           │
        │                                            │
        ▼                                      (loops until pass)
Claude commits with spec reference
        │
        ▼
CI runs full suite (scenarios + tests + lint + types)
        │
        ▼
Auto-deploy to staging (if CI green)
```

### 3.3 The CLAUDE.md Hierarchy for Multi-Surface Products

Since you build across web, API, mobile, and CLI, use a layered CLAUDE.md structure:

```
/CLAUDE.md                     ← Root: global rules, architecture
/src/core/CLAUDE.md            ← Domain logic rules
/src/api/CLAUDE.md             ← API-specific patterns, middleware
/src/web/CLAUDE.md             ← Frontend framework rules, components
/src/mobile/CLAUDE.md          ← Mobile-specific constraints
/src/cli/CLAUDE.md             ← CLI patterns, argument parsing
/specs/CLAUDE.md               ← How to read and interpret specs
/infrastructure/CLAUDE.md      ← Deployment, Docker, CI rules
```

Each child CLAUDE.md inherits from the root and adds surface-specific rules. Claude Code reads the most relevant one for the task.

### 3.4 Autonomous Iteration with Claude Code

The key shift from vibe-coding to factory:

**Vibe-coding (your current mode):**
```
You: "add a billing page"
Claude: writes some code
You: "hmm, the button is wrong"
Claude: fixes it
You: "now it broke the signup flow"
Claude: fixes that
... (30 minutes of back-and-forth)
```

**Factory mode (your target):**
```
You: Write /specs/features/billing.md (5 minutes)
You: Write /specs/scenarios/billing-scenarios.md (10 minutes)
You: "Implement the billing feature per spec"
Claude: reads spec → implements → validates → fixes → commits
You: Review the deployed staging build (2 minutes)
```

The time you spend shifts from improvising to specifying. The payoff: Claude's output is constrained, verifiable, and repeatable.

---

## 4. The Validation Layer — Proving Correctness Without Reading Code

### 4.1 Three Tiers of Validation

```
┌───────────────────────────────────────────────┐
│  Tier 1: SCENARIO VALIDATION (you define)     │
│  E2E behavioral tests from /specs/scenarios/  │
│  Run against a real (or twin) environment      │
│  "Does it do what the spec says?"              │
├───────────────────────────────────────────────┤
│  Tier 2: STRUCTURAL VALIDATION (Claude runs)  │
│  Type checking, linting, compilation           │
│  "Is the code well-formed?"                    │
├───────────────────────────────────────────────┤
│  Tier 3: REGRESSION PROTECTION (automated)    │
│  Existing scenarios + unit tests               │
│  "Did we break anything?"                      │
└───────────────────────────────────────────────┘
```

All three tiers must pass before any code reaches staging. Claude Code is responsible for making Tier 2 and 3 pass. You are responsible for *defining* Tier 1. Nobody is responsible for "reviewing the code."

### 4.2 Scenario Runner

Build a lightweight scenario runner that Claude Code can invoke. This is the factory's heartbeat.

```
make validate
```

This command:
1. Spins up the application (or connects to a running instance)
2. Reads all scenario files from /specs/scenarios/
3. Executes each scenario step
4. Reports pass/fail per scenario
5. On failure: outputs the specific step that failed + actual vs expected

The runner itself can be AI-generated — but the scenario *definitions* are yours.

### 4.3 Satisfaction Scoring (Borrowed from StrongDM)

For features with non-deterministic behavior (anything involving LLMs, search ranking, recommendations), replace boolean pass/fail with a **satisfaction score**:

```
Scenario: "Search returns relevant results"
  Query: "billing invoice"
  Expected: results related to billing and invoices
  Scoring: LLM-as-judge rates relevance 1-5
  Threshold: average ≥ 4.0 across 10 runs
  Current satisfaction: 4.3 ✓
```

### 4.4 Digital Twins (For Integration-Heavy Features)

If your product integrates with third-party services (Stripe, Auth0, Twilio, etc.), build lightweight behavioral twins:

```
/twins
  /stripe
    mock-server.ts       ← Claude builds this from Stripe's API docs
    behaviors.md         ← You define expected behaviors
  /auth0
    mock-server.ts
    behaviors.md
```

You spec the twin's behavior. Claude builds it. Your scenarios run against the twin instead of the real service. This gives you unlimited test runs with zero API costs and zero rate limits.

---

## 5. The Feedback Loop — Continuous Convergence

### 5.1 The Inner Loop (Per Feature)

```
┌──────────────────────────────────────┐
│                                      │
│   Spec ──→ Claude Code ──→ Validate  │
│              ▲                │      │
│              │    ┌───────────┘      │
│              │    │                   │
│              │    ▼                   │
│            Fail? ──Yes──→ Fix        │
│              │                        │
│             No                        │
│              │                        │
│              ▼                        │
│           Commit                      │
│                                      │
└──────────────────────────────────────┘
```

Claude Code runs this loop autonomously. You don't participate. If Claude gets stuck after 3 attempts, it asks you a *specific architectural question* — never "what should I do?" but rather "should the billing service call Stripe synchronously or via a queue?"

### 5.2 The Outer Loop (Per Day/Week)

```
You review:
  1. Deployed staging environment — does it feel right?
  2. Scenario coverage — are we missing cases?
  3. Architecture — are the ADRs still correct?
  4. Velocity — are features shipping faster?

You produce:
  1. New specs for next features
  2. New scenarios for gaps found
  3. Updated ADRs for decisions made
  4. Updated CLAUDE.md if Claude is making repeat mistakes
```

### 5.3 The Meta Loop (Monthly)

Audit the factory itself:
- Which scenarios catch real bugs? Keep those, refine others.
- Where does Claude get stuck most? Add an ADR or CLAUDE.md rule.
- What specs led to good first-pass code? Template those.
- What specs needed heavy iteration? Improve the spec format.

---

## 6. Repository Structure

```
your-product/
├── CLAUDE.md                          ← Factory operating manual
├── Makefile                           ← validate, test, lint, deploy
│
├── specs/
│   ├── CLAUDE.md                      ← How to read specs
│   ├── features/                      ← Feature specs (your primary output)
│   │   ├── user-auth.md
│   │   ├── billing.md
│   │   └── ...
│   ├── architecture/                  ← System design docs
│   │   ├── database-schema.md
│   │   ├── api-design.md
│   │   └── ...
│   ├── scenarios/                     ← Validation contracts
│   │   ├── auth-scenarios.md
│   │   ├── billing-scenarios.md
│   │   └── ...
│   └── decisions/                     ← ADRs
│       ├── adr-001-database.md
│       └── ...
│
├── src/
│   ├── core/                          ← Shared domain logic (framework-free)
│   │   ├── CLAUDE.md
│   │   └── ...
│   ├── api/                           ← API surface
│   │   ├── CLAUDE.md
│   │   └── ...
│   ├── web/                           ← Web surface
│   │   ├── CLAUDE.md
│   │   └── ...
│   ├── mobile/                        ← Mobile surface
│   │   ├── CLAUDE.md
│   │   └── ...
│   └── cli/                           ← CLI surface
│       ├── CLAUDE.md
│       └── ...
│
├── twins/                             ← Digital twins of third-party services
│   ├── stripe/
│   ├── auth0/
│   └── ...
│
├── validation/                        ← Scenario runner + harness
│   ├── runner.ts
│   └── judges/                        ← LLM-as-judge configs
│
├── infrastructure/
│   ├── CLAUDE.md
│   ├── docker-compose.yml
│   └── ci/
│       └── pipeline.yml
│
└── migrations/                        ← Database migrations (append-only)
```

---

## 7. Daily Workflow — What Your Day Looks Like

### Morning (30 min): Plan
1. Check staging — does last night's work look right?
2. Write 1–2 feature specs for today's priorities
3. Write scenarios for those features
4. Prioritize the backlog in a simple task list

### Working hours: Architect + Supervise
5. Hand Claude Code the top spec: *"Implement billing per spec"*
6. Claude runs autonomously (inner loop)
7. While Claude works: write specs for tomorrow, refine scenarios, update ADRs
8. When Claude finishes: glance at staging, not at code
9. If Claude asks a question: answer it in the spec or ADR, not in chat
10. Repeat with next spec

### End of day (15 min): Reflect
11. Are scenarios catching real issues? Add more if not.
12. Update CLAUDE.md with any new patterns or mistakes observed.
13. Push all spec changes. Claude picks up where it left off tomorrow.

---

## 8. Migration Path — From Vibe-Coding to Factory

You don't flip a switch. You migrate gradually:

**Week 1–2: Foundation**
- Write your root CLAUDE.md with clear rules
- Create the /specs/ directory structure
- Write specs for your 3 most stable features (retroactively)
- Write scenarios for those features
- Set up `make validate` with even a basic scenario runner

**Week 3–4: Practice**
- For every new feature, write the spec BEFORE talking to Claude
- Write scenarios BEFORE implementation
- Start saying "implement per spec" instead of describing the feature in chat
- Notice where Claude drifts — add rules to CLAUDE.md

**Month 2: Automate**
- Build or refine the scenario runner
- Add CI that blocks on scenario failures
- Start building digital twins for your integrations
- Write ADRs for accumulated architectural decisions

**Month 3: Factory**
- Your CLAUDE.md is mature and Claude rarely drifts
- Scenarios cover your critical paths
- You spend 80% of your time writing specs, 20% reviewing deployed output
- You haven't read a line of code in weeks

---

## 9. Anti-Patterns to Avoid

**"Let me just quickly fix this myself"**
Don't. Update the spec or CLAUDE.md instead. Every time you hand-edit code, you bypass the factory and create knowledge that only exists in your head.

**Vague specs**
"Make the dashboard better" → Claude will guess. "Add a 30-day revenue chart to the dashboard using the /api/revenue endpoint, showing daily totals with a line chart" → Claude will deliver.

**Reviewing code instead of behavior**
Your instinct will be to read the diff. Resist. Check the deployed result. If it works and scenarios pass, the code is correct by definition. If something is wrong, add a scenario that catches it.

**Scenario drift**
Don't let Claude modify scenario files. Scenarios are YOUR contract. If Claude starts failing scenarios, the code needs to change — not the scenarios.

**Skipping ADRs**
Every "oh, Claude keeps doing X wrong" is a missing ADR. Write the decision down once; Claude reads it forever.

---

## 10. Key Metrics to Track

| Metric | What it tells you | Target |
|---|---|---|
| Spec-to-deploy time | How fast features ship | Decreasing over time |
| Scenarios passing on first run | How good your specs are | > 70% |
| Claude questions per feature | How complete your specs are | < 3 |
| Scenarios per feature | How well-validated you are | > 5 |
| Manual interventions per week | How autonomous the factory is | Decreasing to near-zero |
| Regressions caught by scenarios | How good your safety net is | Increasing, then stable |

---

*This architecture is a living document. Update it as your factory matures. The goal isn't perfection on day one — it's a system that gets better every week because every lesson becomes a spec, an ADR, or a CLAUDE.md rule that Claude reads forever.*
