---
name: jovida-cli
description: Capture and manage the user's Jovida Daily todos via the `jovida` CLI — create, list, update, complete, delete (changes apply immediately, no confirmation, no undo). Use when the conversation surfaces action items, follow-ups, or commitments, or when the user asks to track / remember / organize a task.
allowed-tools: Bash(jovida:*)
---

# Jovida Daily Todo (CLI)

Help the user capture and manage their **Jovida Daily** todos by shelling out to the `jovida` command. The CLI is the interface to the user's account; changes sync to their other Jovida devices.

This skill teaches the *semantics* — when to act, which command, how to compose them. For the **exact flags** of any command, run `jovida <command> --help` (e.g. `jovida create --help`); that is the source of truth and stays in lockstep with the installed version. Don't rely on a flag this skill doesn't name without checking `--help` first.

> **If `jovida` isn't found**, the CLI isn't installed here — tell the user to install it (see the jovida-cli README); don't pretend you tracked anything.
> **Sign-in is required (no anonymous mode).** If unsure whether they're signed in, run `jovida whoami` first (exit `2` = not signed in). If they aren't (or any command exits `2`, `NOT_SIGNED_IN`): **you** sign them in — run `jovida login` in the background, then confirm with `jovida whoami`. It prints a `https://jovida.ai/jovida-daily/device?code=…` URL (approval code built in), **auto-polls**, and finishes on its own once the user approves. If a browser opened on the user's machine, ask them to approve there; if none did (you're in a cloud sandbox / remote box), send the user that one URL to open and approve on their own device. **Never tell the user to run `jovida login` themselves** — the CLI must run where you run, so the token lands next to you; the user only approves. Don't silently drop the task. In a sandbox where the home dir may not be writable/persistent, set `JOVIDA_HOME` to a writable path first (`export JOVIDA_HOME="$PWD/.jovida"`) and use it for every command, so the login persists (if a write fails, the CLI tells you exactly this). **Never pass a token on the command line.**

## Core mental model — read this first

- **Writes apply immediately.** There is no proposal/confirmation step: `create / update / complete / delete` take effect on the user's account at once and sync to their devices. Say "I've created / completed / deleted …", never "I've proposed …". `complete` is reversible (`reopen`), but **`delete` is permanent — no undo** — so be especially careful with it.
- **Only write when the user clearly wants the change.** When the intent or the essentials (what the task is; which day / deadline / reminder time) are genuinely vague, **ask one short question first** — don't fill gaps with guesses. ("Remind me about the thing tomorrow" → ask *what* and roughly *when* before writing.) But don't over-correct: when it's clear ("submit the report by Friday 6pm"), just act.
- **Read before you change.** `update / complete / delete` need a **real `entry_id`** — get it from `jovida list` or `jovida view` and parse the JSON. **Never guess an id.**
- **Output is machine-readable.** Run non-interactively, the CLI prints **JSON on stdout** (parse it); errors go to **stderr** as `{"error":{"code","message"}}` with a non-zero exit code (`2` not signed in · `3` backend/network · `4` not found · `1` usage). `--json` forces JSON.

## When to use — and when not

Act when the context holds a **real, actionable** item: an explicit action item, follow-up, or commitment ("I need to…", "remember to…", "before launch, check…"), or when the user asks to track / remember / organize something, or to mark one done / remove it.

Don't over-capture: ignore hypotheticals, brainstorming, and things already done. When unsure whether something is a genuine task, ask rather than writing noise.

## Concepts

These shape *what you put in a command* — internalize them; flag spelling lives in `--help`.

- **A todo's time has two granularities (one `--when`).** A bare **date** (`2026-06-05`) means it *belongs to that day*, no hard deadline; a **datetime** (`2026-06-05T18:00:00+08:00`) is a precise **deadline**. Give whichever you actually know. Don't split "do it Wed, due Fri" — if it's due Friday, it's a Friday todo.
- **Reminders are separate from the time, and a reminder ≠ a deadline.** A reminder is *when to nudge*; each must be at or before the todo's time. "Remind me about X tomorrow" = a todo tomorrow with a reminder tomorrow morning — it does **not** make X *due* at that moment. A todo can carry several reminders.
- **A todo can repeat.** Give a todo a repeat rule and it becomes a **repeating todo**: `create` returns a `recurring_id` (not an `entry_id`). View/change its rule with `jovida view <recurring_id>` / `jovida update <recurring_id>`. In `list`, a repeating todo shows up as its **occurrences** — the individual dates it falls on within the window you query, each flagged with `recurring_id`. Completing one occurrence (`jovida complete <its id>`) ticks off just that date and leaves the routine running; the rule keeps generating future occurrences. Use a repeat rule for a real routine ("standup every weekday"); for a few separate dates, make individual todos.
- **The rest:** **subtasks** break one task into steps; **category** is a grouping label; **priority** is none/low/medium/high; **hint** is an optional one-line nudge — add it only when it genuinely helps.

## Commands at a glance

Semantics below; exact flags via `jovida <cmd> --help`.

- **`jovida list`** — list todos (defaults to today's pending). **An empty result is not "the user has no todos"** — it's only today's open items; before telling them there's nothing, widen with `--scope all --status all` (or a date range). Widen with scope/status/range, or **search/filter** with `--query <text>` (title+description), `--category`, `--priority` (any of these defaults scope+status to *all*). The JSON carries **`total` + `has_more`** — if `has_more` is true the result was cut by `--limit`, so raise `--limit` or narrow the query rather than concluding a todo doesn't exist. Add `--full` for every field in one call (no follow-up `view`). Repeating todos appear as dated **occurrences** flagged with `recurring_id`: an explicit `--scope range --from/--to` lists *every* occurrence in that window; `today`/`upcoming` show each routine's next occurrence.
- **`jovida view <entry_id>`** — full detail of one todo (description, subtasks, reminders, …). Pass a repeating todo's `recurring_id` instead to see its repeat rule.
- **`jovida create "<title>"`** — add one todo (**one per call**; run again for more). Give it a repeat rule to make it a repeating todo instead (returns a `recurring_id`).
- **`jovida update <entry_id>`** — change fields of a todo; **only the fields you pass change**. `--remind` / `--subtask` replace the whole list (subtasks keep the completion of same-titled ones; for individual subtasks use `subtask` below). Pass a `recurring_id` to edit a repeating todo (including its repeat rule), or an **occurrence id** (from `list`) to tweak just that one occurrence (it materializes that date; the routine and other occurrences are untouched). To stop a routine's future occurrences, set the recurring todo's `--until`. Passing a value only sets/replaces it; to **remove** a field (clear the time, drop all reminders, empty the category…) use the matching `--clear-*` flag (see `--help`).
- **`jovida complete <id> [<id> …]`** — mark done (pass several ids in one call). Pass a repeating todo's occurrence id (from `list`) to tick off just that date — it materializes that occurrence, the routine keeps running.
- **`jovida reopen <id> [<id> …]`** — reopen completed todos (the inverse of `complete`).
- **`jovida subtask check|uncheck|add|rm <entry_id> …`** — check / uncheck / add / remove an individual subtask (address it by its id or its 1-based number from `view`).
- **`jovida delete <id> [<id> …]`** — permanently remove (several ids in one call; **no undo**). To stop a routine, delete its `recurring_id` — you can't delete a single occurrence.
- **`jovida whoami` / `login` / `logout`** — session. **You** run `jovida login` (in the background); it prints a one-click `…/device?code=…` URL and auto-polls until the user approves. Browser opened on their machine → they approve there; no browser (cloud sandbox / remote) → relay that URL for them to approve elsewhere. Never have the user run `jovida login` — it must run where you run.

## Workflows — composing the commands

Map the user's intent to a sequence; read before any change.

- **Capture several items from one message** (meeting notes, a brain-dump): pick out the *real* commitments, then run `jovida create` once per item. Don't cram several tasks into one todo, and don't capture the surrounding discussion.
- **A deliverable with steps:** one `jovida create` for the outcome, with `--subtask` per step — not many separate todos, when the steps belong to a single result.
- **Change or reschedule:** `jovida list` (or `view`) to get the `entry_id`, then `jovida update`. To move a deadline, update `--when`. Remember `--remind` / `--subtask` replace the list.
- **Tick off a step:** `jovida view <id>` to see the numbered subtasks, then `jovida subtask check <id> <n>` (n is the number, or the subtask's id).
- **Finish or clean up:** `jovida list` to see what's open, then `jovida complete` (done) or `jovida delete` (remove) — pass all related ids in one call. Prefer `complete` over `delete` unless the item was never real; if you marked one done by mistake, `jovida reopen` undoes it (a `delete` cannot be undone).
- **A recurring routine:** create one todo with a repeat rule. It then shows in `list` as occurrences on each due date (flagged `recurring_id`); `complete` an occurrence to tick off that day. For a few irregular dates, create individual todos instead.
- **"What's on my plate?"** `jovida list` (today, or widen the scope) and summarize from the JSON. Read-only — don't write anything.

## Discipline

- Quote the title and any value containing spaces. Keep titles/descriptions **single-line plain text** — newlines and shell metacharacters passed as arguments get mangled.
- **Never put a token in a command** (it lands in shell history / process listings) — `jovida login` uses an interactive browser flow, there's no token to paste.
- `delete` is idempotent: it reports success even for an id that doesn't exist (it won't fail like `complete`/`reopen` do on a missing id). So don't infer a todo existed just because `delete` "succeeded".
- Don't claim success if a command exited non-zero — read the error and tell the user (exit `2` → you run `jovida login` and relay the approval URL; never hand that command to the user).
