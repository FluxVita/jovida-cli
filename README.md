# jovida-cli

**English** · [简体中文](./README.zh-CN.md)

The **Jovida Daily CLI** — capture and manage your **Jovida Daily** todos from the terminal and from AI coding agents (Codex, Claude Code, …). It ships with an agent **skill** so your AI knows when and how to use it.

> **Beta.** Jovida Daily is in private beta; the CLI requires a Jovida account (no anonymous mode). A public npm release is coming soon.

## Two parts

- **`jovida` command** — talks to your Jovida account over HTTPS (login required), keeps **no local todo database**, and syncs with your other Jovida devices.
- **`SKILL.md`** (name: `jovida-cli`) — a portable behavior guide that teaches your AI agent to drive the CLI on a **single track: writes apply immediately** (no proposal/confirmation step, no undo yet).

## Install

### 1. The skill (so your AI knows how to use the CLI)

```bash
npx skills add FluxVita/jovida-cli
```

Installs `SKILL.md` into your detected agents (`~/.codex/skills/jovida-cli/`, `~/.claude/skills/jovida-cli/`, …). Or paste this repo's URL to your agent and ask it to add the skill.

### 2. The `jovida` CLI

Pre-release — build from source for now:

```bash
git clone <repo> jovida-cli && cd jovida-cli
npm install && npm run build && npm link   # provides the `jovida` command
```

(When published: `npm i -g @jovida/cli`.)

## Quickstart

```bash
jovida login                      # required — sign in via your browser (device authorization)
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

`jovida login` uses the **OAuth device authorization flow**: it shows a URL and a short code (and tries to open your browser); you sign in and approve the CLI there, and the CLI receives a session token. The token **auto-renews** (set-and-forget) until the session is revoked. No keys to copy, no anonymous mode.

## The skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) — the agent skill (English / 中文对照) that teaches your AI when and how to use the CLI.

## License

[MIT](./LICENSE) © FluxVita
