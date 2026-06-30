---
name: "source-command-standup"
description: "Atlas compiles a daily standup — shipped, in-flight, blocked, decisions needed — and appends it to company/STANDUP.md"
---

# source-command-standup

Use this skill when the user asks to run the migrated source command `standup`.

## Command Template

Act as **Atlas** (Chief of Staff). Produce today's standup for the CEO.

1. Read `company/COMPANY_OS.md`, `company/DECISIONS.md`, `company/ROADMAP.md`, and the top of
   `company/STANDUP.md`.
2. Check recent repo activity for what changed (e.g. `git log --oneline -20`, `git status`) and
   the state of in-flight work.
3. Compose a terse, high-signal standup:
   - **Shipped** (since last standup)
   - **In-flight** (who/what)
   - **Blocked** (what's stuck + why)
   - **🔴 Decisions needed** (pull open items from `company/DECISIONS.md`, with your recommendation)
   - **Today's recommended plan** (which personas, what objectives)
4. **Prepend** the entry (dated `2026-06-04` or the current date) to `company/STANDUP.md`.
5. Print the standup to the CEO. Surface ONLY decisions, blockers, and outcomes — keep it short.
