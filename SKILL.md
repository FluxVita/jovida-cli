---
name: jovida-cli
description: Capture and manage the user's Jovida Daily todos via the `jovida` CLI — create, list, update, complete, delete (changes apply immediately, no confirmation, no undo). Use when the conversation surfaces action items, follow-ups, or commitments, or when the user asks to track / remember / organize a task.
allowed-tools: Bash(jovida:*)
---

# Jovida Daily Todo (CLI)

Help the user capture and manage their **Jovida Daily** todos by shelling out to the `jovida` command. The CLI is the interface to the user's account; changes sync to their other Jovida devices.

This skill teaches the *semantics* — when to act, which command, how to compose them. For the **exact flags** of any command, run `jovida <command> --help` (e.g. `jovida create --help`); that is the source of truth and stays in lockstep with the installed version. Don't rely on a flag this skill doesn't name without checking `--help` first.

> **If `jovida` isn't found**, the CLI isn't installed here — tell the user to install it (see the jovida-cli README); don't pretend you tracked anything.
> **Sign-in is required, and it's the user's step.** No anonymous mode. You **cannot** sign in for them (interactive browser) and **must not** skip it. If unsure they're signed in, run `jovida whoami` first. If `whoami` or any command exits `2` (`NOT_SIGNED_IN`), **stop, ask the user to run `jovida login`, and wait for their confirmation before retrying** — don't silently drop the task or claim you can't help.

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
- **Recurring = a series, not a todo.** Creating with a repeat rule makes a recurring **series** (you get a `recurring_id`); its individual occurrences then appear in `list` like normal todos, each with its own `entry_id` (and a `recurring_id` linking back). Use a series for a genuinely repeating commitment ("standup every weekday"), not for a handful of distinct dates — make those individual todos.
- **The rest:** **subtasks** break one task into steps; **category** is a grouping label; **priority** is none/low/medium/high; **hint** is an optional one-line nudge — add it only when it genuinely helps.

## Commands at a glance

Semantics below; exact flags via `jovida <cmd> --help`.

- **`jovida list`** — a scoped *view* of todos (defaults to today's pending), **not a search**; widen with scope/status/range. Your go-to for finding the `entry_id` you need. Add `--full` to get every field (description, subtasks, reminders) in the same call — one round-trip instead of `list` then `view`.
- **`jovida view <entry_id>`** — full detail of one todo (description, subtasks, reminders, …).
- **`jovida create "<title>"`** — add one todo (**one per call**; run again for more). Add a repeat rule to create a recurring series instead.
- **`jovida update <entry_id>`** — change fields of an existing todo; **only the fields you pass change**. `--remind` / `--subtask` **replace** the whole list (not append).
- **`jovida complete <id> [<id> …]`** — mark done (pass several ids in one call).
- **`jovida reopen <id> [<id> …]`** — reopen completed todos (the inverse of `complete`).
- **`jovida delete <id> [<id> …]`** — permanently remove (several ids in one call; **no undo**).
- **`jovida whoami` / `login` / `logout`** — session. `login` is the user's interactive step.

## Workflows — composing the commands

Map the user's intent to a sequence; read before any change.

- **Capture several items from one message** (meeting notes, a brain-dump): pick out the *real* commitments, then run `jovida create` once per item. Don't cram several tasks into one todo, and don't capture the surrounding discussion.
- **A deliverable with steps:** one `jovida create` for the outcome, with `--subtask` per step — not many separate todos, when the steps belong to a single result.
- **Change or reschedule:** `jovida list` (or `view`) to get the `entry_id`, then `jovida update`. To move a deadline, update `--when`. Remember `--remind` / `--subtask` replace the list.
- **Finish or clean up:** `jovida list` to see what's open, then `jovida complete` (done) or `jovida delete` (remove) — pass all related ids in one call. Prefer `complete` over `delete` unless the item was never real; if you marked one done by mistake, `jovida reopen` undoes it (a `delete` cannot be undone).
- **A repeating commitment:** create once with a repeat rule (a series). For a few irregular dates, create individual todos instead.
- **"What's on my plate?"** `jovida list` (today, or widen the scope) and summarize from the JSON. Read-only — don't write anything.

## Discipline

- Quote the title and any value containing spaces. Keep titles/descriptions **single-line plain text** — newlines and shell metacharacters passed as arguments get mangled.
- **Never put a token in a command** (it lands in shell history / process listings). Signing in is the user's interactive step.
- Don't claim success if a command exited non-zero — read the error and tell the user (exit `2` → ask them to `jovida login`).
