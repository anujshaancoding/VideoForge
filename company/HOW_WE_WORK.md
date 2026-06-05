# How Zentrix Works — CEO Playbook

Your one-page guide to running the company. Read this when you forget how things flow.
(Full detail lives in [`COMPANY_OS.md`](COMPANY_OS.md).)

---

## The mental model

You are **CEO**. You don't manage 14 people — you talk to **one**: **Atlas**, the Chief of Staff
(that's the main Claude Code session). You hand Atlas an objective; Atlas pulls in the right
specialists, gets the work done, and brings back **only what needs you**.

```
YOU ──objective──► ATLAS ──dispatches──► the 13 specialists ──results──► ATLAS ──decisions only──► YOU
```

> These 14 personas are **company-wide staff**, not VideoForge-only. Every new Zentrix product
> reuses the same team — that's why we built all 14 properly. VideoForge is just the first project.

---

## How you run it day-to-day

- **Talk to Atlas only.** Say *"Atlas, …"* or just hand over an objective.
- **`/standup`** → Atlas reports *shipped · in-flight · blocked · decisions-needed*.
- **`/ship <thing>`** → e.g. `/ship add snap-to-grid on the timeline`. Atlas auto-routes
  Vera → Iris → Pixel/Core/Reel → Sentinel → Forge.
- **`/decisions`** → Atlas shows only what needs *you*, each with a recommendation.

### Command quick-reference
| Command | What happens |
|---|---|
| `/standup` | Daily status, appended to `company/STANDUP.md` |
| `/ship <feature>` | Run the full build loop on one feature |
| `/decisions` | Show the open CEO decision queue |
| *"Atlas, ask Scout to …"* | Direct a specific persona through Atlas |

---

## The only 5 things that reach you (decision gates)

Everything else, the team just does. Atlas escalates ONLY:

1. 💰 **Money** — any spend or pricing change
2. 🧭 **Scope** — anything beyond `docs/MVP_Scope.md`
3. 🚀 **Release / publish** — production deploys, marketing, anything externally visible
4. ⚠️ **Irreversible infra** — data deletion, schema migrations, DNS
5. ⚖️ **Legal / brand-risk** judgment calls

They land in [`DECISIONS.md`](DECISIONS.md) with Atlas's recommendation. Clear them in minutes.

---

## Who does what (the roster)

| Persona | Role | Model |
|---|---|---|
| **Atlas** | Chief of Staff / orchestrator (you talk to this one) | Sonnet |
| **Vera** | Head of Product / PM — roadmap, specs, scope guardian | Sonnet |
| **Scout** | Market & competitive research | **Opus** |
| **Iris** | Head of Design (UX + UI), brand | Sonnet |
| **Forge** | Principal Engineer / Architect, code review, the invariant | **Opus** |
| **Pixel** | Frontend / editor engineer (`apps/web`) | **Opus** |
| **Core** | Backend / platform engineer (`apps/api`) | **Opus** |
| **Reel** | Media / render engineer — export parity (highest risk) | **Opus** |
| **Anchor** | DevOps / SRE — CI, deploy, infra | Sonnet |
| **Sentinel** | QA — tests, golden, perf, a11y (the release gate) | Sonnet |
| **Echo** | Growth / marketing | Sonnet |
| **Pulse** | Customer success / feedback (closes the loop) | Sonnet |
| **Ward** | Security (advisory) | **Opus** |
| **Ledger** | Finance / BizOps (advisory — never decides) | Sonnet |

---

## Why the model split (your context/cost strategy)

- **Opus** = complex coding, deep research, and high-stakes reasoning (architecture, render
  parity, security). Worth the extra cost where mistakes are expensive.
- **Sonnet** = structured, well-bounded work (specs, design briefs, CI config, running tests,
  copy, triage). Reliable and lighter.
- Each persona runs in its **own context window** and returns only a summary to Atlas — so heavy
  Opus work doesn't bloat your main thread.
- **To change any persona's model:** edit the `model:` line at the top of its file in
  `.claude/agents/<persona>.md` (`opus` / `sonnet` / `haiku`). One line, takes effect next run.

---

## The loop the company runs on

Research → Analyse → Prepare → Design → Develop → Test → Refactor → Deploy → Listen → (repeat)

Pulse feeds real feedback back to Scout/Vera, so it's a cycle, not a one-shot. See `COMPANY_OS.md`
§4 for who leads each stage.

---

## Your job as CEO (and only your job)

1. Set direction / pick the next objective.
2. Clear the decision queue (`/decisions`).
3. Make the money/scope/release/legal calls.

That's it. The rest runs itself.
