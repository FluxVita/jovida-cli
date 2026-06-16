# jovida-cli

**English** · [简体中文](./README.zh-CN.md)

The **Jovida Daily CLI** — capture and manage your **Jovida Daily** todos from the terminal and from AI coding agents (Codex, Claude Code, cloud sandboxes, …). It ships with an agent **skill** so your AI knows when and how to use it.

> **Beta.** Jovida Daily is in private beta; the CLI requires a Jovida account (no anonymous mode).

---

## For the AI agent: install this end-to-end

**You are an AI agent and a user asked you to install this. Do every step below yourself — never hand a command to the user, and don't stop until `jovida whoami` succeeds. The user's _only_ action is one click in a browser (approve) or opening one link.**

**1. Install the CLI**

```bash
npm i -g @fluxvita/jovida-cli
```

**2. Install the skill** into the user's agents (so any AI on this machine knows how to drive the CLI):

```bash
jovida skill install
```

Installs into **every detected** agent. If several agents are present, tell the user you're installing for all of them. For just one: `jovida skill install --agent codex` (repeatable / comma-separated; `jovida help skill` lists names). `--all` covers all known agents even if undetected.

**3. Sign the user in.** Run login **in the background** so you can relay the link and keep working while it polls:

```bash
jovida login
```

It immediately prints a `https://jovida.ai/jovida-daily/device?code=…` URL (the approval code is built into the link) and tries to open the user's browser. Then:

- **A browser opened on the user's machine** (you're a local agent on their computer) → ask the user to click **approve** there.
- **No browser opened** (you're in a cloud sandbox / remote box — there's no browser where you run) → send the user that one URL to open and approve on their own device.

Either way the command finishes on its own once the user approves. **Never tell the user to run `jovida login` themselves** — the CLI must run where _you_ run, so the token lands next to you; the user only approves.

**4. Confirm.** Setup isn't done until this succeeds:

```bash
jovida whoami
```

From here, drive the CLI per **[`SKILL.md`](./SKILL.md)**. Sessions auto-renew; if any later command exits `2` (`NOT_SIGNED_IN`), sign the user in again exactly as in step 3.

---

## What it is

- **`jovida` command** — talks to your Jovida account over HTTPS (login required), keeps **no local todo database**, and syncs with your other Jovida devices.
- **`SKILL.md`** (name: `jovida-cli`) — a portable behavior guide that teaches your AI to drive the CLI on a **single track: writes apply immediately** (no proposal/confirmation step; `complete` is reversible via `reopen`, but `delete` is permanent).

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

`jovida login` uses the **OAuth device authorization flow**. It prints one URL with the approval code built in (`https://jovida.ai/jovida-daily/device?code=…`) and tries to open your browser; you sign in and approve the CLI there, and it receives a session token that **auto-renews** (set-and-forget) until the session is revoked. No keys to copy, no anonymous mode. On a machine without a browser, open that printed URL on any other device to approve.

## Updating

- **CLI**: `npm i -g @fluxvita/jovida-cli@latest`. (In an interactive terminal the CLI also notifies you when a newer version exists.)
- **Skill**: run `jovida skill update` after updating the CLI — it re-copies the bundled `SKILL.md`, so the agent's knowledge stays in lockstep with the installed CLI version (same npm package, no drift).

## Manual install (without an AI agent)

If you're setting this up by hand rather than through an AI agent:

```bash
npm i -g @fluxvita/jovida-cli          # 1. install (or build from source, below)
jovida skill install                   # 2. install the skill into your agents
jovida login                           # 3. sign in — opens a browser; approve the CLI
jovida whoami                          # 4. confirm
```

Build from source instead of npm: `git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`, then `jovida --version`.

Alternative skill installer covering more agents — but it pulls the skill from the repo's latest, not your installed CLI version: `npx skills add FluxVita/jovida-cli`.

Supported agents for `jovida skill install`: Codex, Claude Code, Gemini CLI, Cursor, Windsurf, Continue, OpenCode, Goose, Qwen Code, Crush, KiloCode, Aider, GitHub Copilot (each at `<agent-dir>/skills/jovida-cli/`).

## The skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) — the agent skill (English / 中文对照) that teaches your AI when and how to use the CLI.

## License

[MIT](./LICENSE) © FluxVita
