# jovida-cli

**English** · [简体中文](./README.zh-CN.md)

The **Jovida Daily CLI** — capture and manage your **Jovida Daily** todos from the terminal and from AI coding agents (Codex, Claude Code, …). It ships with an agent **skill** so your AI knows when and how to use it.

> **If you are the AI agent setting this up:** do **[Setup](#setup)** in order. Steps 1–2 you do yourself. **Step 3 (`jovida login`) you cannot do — but you must not skip it:** after installing, explicitly tell the user to run `jovida login` (a browser opens; they sign in and approve) and wait until they confirm. Verify with `jovida whoami`. Don't consider setup finished — or try to manage todos — until sign-in succeeds. After that, drive the CLI per **[`SKILL.md`](./SKILL.md)**; if any command later exits `2` (`NOT_SIGNED_IN`), stop and ask the user to run `jovida login` again.

> **Beta.** Jovida Daily is in private beta; the CLI requires a Jovida account (no anonymous mode).

## Two parts

- **`jovida` command** — talks to your Jovida account over HTTPS (login required), keeps **no local todo database**, and syncs with your other Jovida devices.
- **`SKILL.md`** (name: `jovida-cli`) — a portable behavior guide that teaches your AI to drive the CLI on a **single track: writes apply immediately** (no proposal/confirmation step, no undo yet).

## Setup

**1. Install the `jovida` command** so it is on your `PATH`:

```bash
npm i -g @fluxvita/jovida-cli
```

(Or build from source: `git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`.) Verify with `jovida --version`.

**2. Install the skill** so your AI knows when/how to use the CLI:

```bash
npx skills add FluxVita/jovida-cli
```

Installs `SKILL.md` into detected agents (`~/.codex/skills/jovida-cli/`, `~/.claude/skills/jovida-cli/`, …). Or paste this repo's URL to your agent and ask it to add the skill.

**3. Sign in — this is the user's step (interactive; the agent cannot do it):**

```bash
jovida login          # opens a browser; sign in and approve the CLI
```

Verify with `jovida whoami`. From here the CLI stays signed in (auto-renews) until the session is revoked.

## Updating

- **Installed from npm** (`@fluxvita/jovida-cli`): `npm i -g @fluxvita/jovida-cli@latest`.
- **Installed from source** (current pre-release): in the cloned repo run `git pull && npm install && npm run build`. The `npm link` symlink persists, so the rebuilt CLI takes effect immediately — no need to re-link.
- **The skill updates separately:** re-run `npx skills add FluxVita/jovida-cli` to refresh `SKILL.md` in your agents. Do this whenever the CLI's commands change, so the agent's knowledge stays in sync.

## Quickstart

```bash
jovida create "submit the report by Friday 6pm" --when 2026-06-12T18:00:00+08:00
jovida list
jovida show <entry_id>
jovida complete <entry_id>
```

- **JSON output is automatic when piped** (for scripts/agents); use `--json` / `--no-json` to force.
- **Exit codes**: `0` ok · `1` usage · `2` not signed in · `3` backend/network · `4` not found.

## Commands

`create` · `list` · `show` · `update` · `complete` · `delete` · `login` · `logout` · `whoami`.
Run `jovida help` for usage, or see [`SKILL.md`](./SKILL.md) for flags & field conventions.

## Auth

`jovida login` uses the **OAuth device authorization flow**: it shows a URL and a short code (and tries to open your browser); you sign in and approve the CLI there, and the CLI receives a session token that **auto-renews** (set-and-forget) until the session is revoked. No keys to copy, no anonymous mode.

## The skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) — the agent skill (English / 中文对照) that teaches your AI when and how to use the CLI.

## License

[MIT](./LICENSE) © FluxVita
