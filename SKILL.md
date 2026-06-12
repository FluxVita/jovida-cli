---
name: jovida-cli
description: Capture and manage the user's Jovida Daily todos from the command line via the `jovida` CLI — create, list, update, complete, or delete tasks (changes apply immediately, no confirmation step). Use when the conversation surfaces action items, follow-ups, or commitments, or when the user asks to track / remember / organize a task.
allowed-tools: Bash(jovida:*)
---

# Jovida Daily Todo (CLI)

Help the user capture and manage their **Jovida Daily** todos by shelling out to the `jovida` command-line tool. Run `jovida` commands through your shell — the CLI is the interface to the user's account, and changes sync to their other Jovida devices.

> **If the `jovida` command isn't found**, the Jovida Daily CLI isn't installed here — tell the user to install it (see the jovida-cli README); don't pretend you tracked anything.
> **Sign-in is required — and it is the user's step.** No anonymous mode; nothing works until the user runs `jovida login` (interactive browser sign-in — you **cannot** do it for them, and **must not** skip it). Be proactive: if you're not sure they're signed in, run `jovida whoami` first. If `whoami` or any command exits `2` (`NOT_SIGNED_IN`), **stop, tell the user to run `jovida login`, and wait until they confirm before retrying** — don't silently drop the task or claim you can't help.

## Core mental model — read this first

Writes apply **immediately**. There is **no proposal or confirmation step**: when you run `jovida create / update / complete / delete`, it takes effect on the user's account at once and syncs to their devices. So:

- Say "I've **created / completed / deleted** …" — never "I've proposed …".
- Because it's immediate, only run a write when the user **clearly wants that change**. When unsure, ask first (see *Clarify*).
- **There is no undo** from the CLI — be especially careful with `delete` and `complete`.

## When to use

Act when the context holds a real, actionable item:
- an explicit action item, follow-up, or commitment ("I need to…", "remember to…", "before launch, check…");
- the user asks to track / remember / add / organize a task, or to mark one done / remove it.

Do **not** over-capture:
- ignore hypotheticals, brainstorming, and things already done;
- when unsure whether something is a real task, ask rather than writing noise.

## Clarify before writing

A write changes the user's data immediately — and `delete` / `complete` can't be undone here — so a vague or wrong call is costly. Before writing, make sure the essentials are concrete: *what* the task is, and — when time is implied — *which day / deadline / reminder time*. If the user's message leaves these genuinely ambiguous, **ask one brief question first**; don't fill the gaps with guesses.

- "remind me about the thing tomorrow" → ask *what* the thing is, and roughly *when*, before writing.
- "set a reminder" with no time → ask for the time.
- Don't over-correct: when details are clear ("submit the report by Friday 6pm"), just act.

## Commands

You invoke these through your shell. When run non-interactively (as you do), output is **JSON on stdout** — parse it. Errors go to **stderr** as `{"error":{"code","message"}}` with a **non-zero exit code** (`2` = not signed in, `3` = backend/network, `4` = entry not found, `1` = usage). You can pass `--json` to force JSON.

Run `jovida help` to confirm it's available and see the current usage before relying on a flag.

**Read** (understand state, and get the real `entry_id` before any update/complete/delete):
- `jovida list [--scope today|upcoming|recent|range|all] [--status pending|completed|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N]`
  → `{ "todos": [ { "entry_id", "title", "when", "priority", "status", "category" } ] }`. A scoped view (defaults: `scope=today`, `status=pending`, `limit=20`), **not** a search.
- `jovida show <entry_id>` → the full todo (description, subtasks, remind_at, hint, …).

**Write** (immediate):
- `jovida create "<title>" [--when <ISO>] [--priority none|low|medium|high] [--remind <ISO> …] [--category <s>] [--desc <s>] [--subtask "<title>" …] [--hint <s>]`
  → `{ "entry_id", "status": "created" }`. **One todo per call** — run it again for more.
- `jovida update <entry_id> [--title <s>] [--when <ISO>] [--priority …] [--remind <ISO> …] [--category <s>] [--desc <s>] [--subtask "<title>" …] [--hint <s>]`
  → `{ "entry_id", "status": "updated" }`.
- `jovida complete <entry_id> [<entry_id> ...]` → `{ "entry_ids", "status": "completed" }`.
- `jovida delete <entry_id> [<entry_id> …]` → `{ "entry_ids": […], "status": "deleted" }`. Pass several ids in one call.

Quote the title and any value containing spaces. **Keep `--title` / `--desc` to single-line plain text** — passing newlines or shell metacharacters as arguments is fragile (they get mangled). For a long note, keep it short and single-line rather than embedding markdown/newlines.

**Never put a token in a command** (it lands in shell history / process listings). Signing in is the user's step (interactive browser) — see the not-signed-in note above.

## Field conventions

- **`--when`** — the todo's time, **one flag, two granularities** (ISO 8601):
  - a **date** (`2026-06-05`) → belongs to *that day*, no hard deadline;
  - a **datetime** (`2026-06-05T18:00:00+08:00`) → a precise **deadline**.
  - Give whichever you actually know. Don't split "do it Wed but due Fri" — if it's due Friday, it's a Friday todo.
- **`--priority`**: `none` | `low` | `medium` | `high`.
- **`--category`**: a grouping label. **`--desc`**: a free-text note.
- **`--subtask "<title>"`** (repeatable): break a task into steps.
- **`--remind <ISO>`** (repeatable) — when to alert the user; **separate from `--when`**:
  - each must be **at or before** the todo's time (before the deadline, or any time on a date-only todo's day);
  - **reminding ≠ deadline**: "remind me about X tomorrow" → `--when "<tomorrow>" --remind "<tomorrow>T09:00:00+08:00"` (it does *not* make X due);
  - if you give only `--remind` and no `--when`, the todo lands on the **latest** reminder's day.
- **`--hint <s>`** — an *optional* one-line nudge shown under the todo. Off by default; add only when it genuinely helps (≤ ~20 chars, never restate the title).
- Recurring tasks are **not supported in the CLI yet** — don't try to express them; create individual todos or tell the user.

## Read before you write

`update` / `complete` / `delete` need a **real `entry_id`** — get it from `jovida list` or `jovida show` (parse the JSON) first. Never guess an id.

## Grouping

- Several independent todos → run `jovida create` once per todo.
- Deleting several related todos at once → **one** `jovida delete` with all the ids.

## Do / Don't

- DO `list` / `show` before `update` / `complete` / `delete` (you need the real `entry_id`).
- DO write clear, action-oriented titles (verb-first, concrete).
- DO say "created / updated / completed / deleted" — writes are immediate.
- DON'T over-capture; DON'T run an immediate write the user didn't clearly ask for (there's no undo); DON'T claim success if a command exited non-zero — read the error and tell the user (e.g. exit `2` → ask them to `jovida login`).
