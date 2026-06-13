# jovida-cli

**English** · [简体中文](./README.zh-CN.md)

The **Jovida Daily CLI** — capture and manage your **Jovida Daily** todos from the terminal and from AI coding agents (Codex, Claude Code, …). It ships with an agent **skill** so your AI knows when and how to use it.

> **If you are the AI agent setting this up:** do **[Setup](#setup)** in order. Steps 1–2 you do yourself. **Step 3 (`jovida login`) you cannot do — but you must not skip it:** after installing, explicitly tell the user to run `jovida login` (a browser opens; they sign in and approve) and wait until they confirm. Verify with `jovida whoami`. Don't consider setup finished — or try to manage todos — until sign-in succeeds. After that, drive the CLI per **[`SKILL.md`](./SKILL.md)**; if any command later exits `2` (`NOT_SIGNED_IN`), stop and ask the user to run `jovida login` again.

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

Copies the bundled `SKILL.md` (kept in lockstep with the CLI version) into your detected agents (`~/.codex/skills/jovida-cli/`, `~/.claude/skills/jovida-cli/`). Add `--all` to install for all known agents even if not detected. (Alternative: `npx skills add FluxVita/jovida-cli`.)

**3. Sign in — this is the user's step (interactive; the agent cannot do it):**

```bash
jovida login          # opens a browser; sign in and approve the CLI
```

Verify with `jovida whoami`. From here the CLI stays signed in (auto-renews) until the session is revoked.

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

`create` · `list` · `view` · `update` · `complete` · `reopen` · `delete` · `login` · `logout` · `whoami`.
Run `jovida help` for usage, or see [`SKILL.md`](./SKILL.md) for flags & field conventions.

## Auth

`jovida login` uses the **OAuth device authorization flow**: it shows a URL and a short code (and tries to open your browser); you sign in and approve the CLI there, and the CLI receives a session token that **auto-renews** (set-and-forget) until the session is revoked. No keys to copy, no anonymous mode.

## The skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) — the agent skill (English / 中文对照) that teaches your AI when and how to use the CLI.

## License

[MIT](./LICENSE) © FluxVita
