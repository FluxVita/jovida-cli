# jovida-cli

**English** · [简体中文](./README.zh-CN.md)

The **Jovida Daily CLI** — capture and manage your **Jovida Daily** todos from the terminal and from AI coding agents (Codex, Claude Code, …). It ships with an agent **skill** so your AI knows when and how to use it.

> **AI agent: if a user asks you to install this, run every step below YOURSELF — don't hand the commands to the user, and don't stop after installing. The user's only action is clicking _approve_ in their browser.**
>
> 1. `npm i -g @fluxvita/jovida-cli`
> 2. `jovida skill install` — installs into every detected agent (`--agent <name>` for just one). If several agents are present, tell the user you're installing for all of them.
> 3. **Sign the user in — run these yourself, do NOT tell the user to run `jovida login`:**
>    a. `jovida login --no-wait` — opens the user's browser and returns immediately (it does not block).
>    b. Tell the user to sign in and approve in that browser.
>    c. Poll `jovida login --check` every few seconds until it prints `signed_in` — stop on a non-zero exit (`denied` / `expired`); the request expires after ~10 min.
> 4. `jovida whoami` — confirm. Setup isn't done until this succeeds.
>
> Only if no browser can open (a remote/headless session) ask the user to run `jovida login` themselves. Then drive the CLI per **[`SKILL.md`](./SKILL.md)**; on a later exit `2` (`NOT_SIGNED_IN`), sign them in again the same way.

> **Beta.** Jovida Daily is in private beta; the CLI requires a Jovida account (no anonymous mode).

## Two parts

- **`jovida` command** — talks to your Jovida account over HTTPS (login required), keeps **no local todo database**, and syncs with your other Jovida devices.
- **`SKILL.md`** (name: `jovida-cli`) — a portable behavior guide that teaches your AI to drive the CLI on a **single track: writes apply immediately** (no proposal/confirmation step; `complete` is reversible via `reopen`, but `delete` is permanent).

## Setup

**1. Install the `jovida` command** so it is on your `PATH`:

```bash
npm i -g @fluxvita/jovida-cli
```

(Or build from source: `git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`.) Verify with `jovida --version`.

**2. Install the skill** so your AI knows when/how to use the CLI:

```bash
jovida skill install
```

Copies the bundled `SKILL.md` (kept in lockstep with the CLI version) into **all detected** agents. Supported: Codex, Claude Code, Gemini CLI, Cursor, Windsurf, Continue, OpenCode, Goose, Qwen Code, Crush, KiloCode, Aider, GitHub Copilot (each at `<agent-dir>/skills/jovida-cli/`). To install for just one, use `jovida skill install --agent codex` (repeatable / comma-separated; run `jovida help skill` for the full name list). Add `--all` to install for all known agents even if not detected. (Alternative — covers more agents but pulls the skill from the repo's latest, not your installed version: `npx skills add FluxVita/jovida-cli`.)

**3. Sign in** — opens a browser to approve:

```bash
jovida login          # opens a browser; sign in and approve the CLI
```

Verify with `jovida whoami`. From here the CLI stays signed in (auto-renews) until the session is revoked.

> *AI agents: don't make the user run this — drive it yourself with the non-blocking two-step `jovida login --no-wait`, then poll `jovida login --check` until signed in (see the note at the top).*

## Updating

- **CLI**: `npm i -g @fluxvita/jovida-cli@latest`. (In an interactive terminal the CLI also notifies you when a newer version exists.)
- **Skill**: run `jovida skill update` after updating the CLI — it re-copies the bundled `SKILL.md`, so the agent's knowledge stays in lockstep with the installed CLI version (same npm package, no drift).
- **From source**: in the cloned repo run `git pull && npm install && npm run build` (the `npm link` symlink persists), then `jovida skill update`.

## Quickstart

```bash
jovida create "submit the report by Friday 6pm" --when 2026-06-12T18:00:00+08:00
jovida list
jovida view <entry_id>
jovida complete <entry_id>
```

- **JSON output is automatic when piped** (for scripts/agents); use `--json` / `--no-json` to force.
- **Exit codes**: `0` ok · `1` usage · `2` not signed in · `3` backend/network · `4` not found.

## Commands

`create` · `list` · `view` · `update` · `complete` · `reopen` · `subtask` · `delete` · `login` · `logout` · `whoami`.
Run `jovida help` for usage, or see [`SKILL.md`](./SKILL.md) for flags & field conventions.

## Auth

`jovida login` uses the **OAuth device authorization flow**: it shows a URL and a short code (and tries to open your browser); you sign in and approve the CLI there, and the CLI receives a session token that **auto-renews** (set-and-forget) until the session is revoked. No keys to copy, no anonymous mode.

## The skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) — the agent skill (English / 中文对照) that teaches your AI when and how to use the CLI.

## License

[MIT](./LICENSE) © FluxVita
