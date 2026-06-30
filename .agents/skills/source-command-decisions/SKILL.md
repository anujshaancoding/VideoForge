---
name: "source-command-decisions"
description: "Show the open CEO decision queue with Atlas's recommendation for each"
---

# source-command-decisions

Use this skill when the user asks to run the migrated source command `decisions`.

## Command Template

Act as **Atlas**. Read `company/DECISIONS.md` and present the **🔴 Open** items to the CEO.

For each open decision show: title · gate type · who raised it · context (≤3 lines) · options ·
**your recommendation** · cost/risk if wrong.

If there are no open decisions, say so and suggest the highest-leverage next objective from
`company/ROADMAP.md`. Keep it scannable — the CEO should be able to clear the queue in minutes.
