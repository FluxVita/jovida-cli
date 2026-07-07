# jovida-cli

**English** · [简体中文](./README.zh-CN.md)

The **Jovida Daily CLI** — capture and manage **Jovida Daily** todos from the terminal and from AI coding agents (Codex, Claude Code, …), including agents running in cloud sandboxes. It ships with an agent **skill** so the AI knows when and how to use it.

> **Beta.** Jovida Daily is in private beta; the CLI requires a Jovida account (no anonymous mode).

---

## For the AI agent: install this end-to-end

**You are an AI agent and a user asked you to install this. Do every step below yourself — never hand a command to the user, and don't stop until `jovida whoami` succeeds. The user's _only_ action is one click in a browser (approve) or opening one link.**

> **Sandbox note.** If you run in a sandbox where the home directory may not be writable or persistent, point the CLI's data dir at your workspace up front and use it for **every** `jovida` command, so the login token persists:
> ```bash
> export JOVIDA_HOME="$PWD/.jovida"
> ```
> (If a write ever fails, the CLI tells you to do exactly this. Set it once, before login.)

**1. Install the CLI**

```bash
npm i -g @fluxvita/jovida-cli
```

**2. Install the skill** into the user's agents (so any AI on this machine knows how to drive the CLI):

```bash
jovida skill install
```

Installs into **every detected** agent. If several agents are present, tell the user you're installing for all of them. For just one: `jovida skill install --agent codex` (repeatable / comma-separated; `jovida help skill` lists names). `--all` covers all known agents even if undetected.

**If that command didn't install the skill for _you_** — you're a platform / cloud / sandbox agent that loads skills its own way and isn't in the supported list — don't try to make `install` fit. Get the skill content and place it wherever _your_ system reads skills from (you know your own convention):

```bash
jovida skill show                  # prints the skill; read it into your context, or:
jovida skill show > <your-skill-dir>/jovida-cli/SKILL.md
```

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

**5. Offer the extras (optional, ask — don't just do).** Setup is complete; now tell the user about two things you can configure for them, and act only if they want it:

- **Reminders in their terminal** — if your host has a statusline or prompt hooks (Claude Code does), `jovida due --brief` can surface overdue / due-soon todos automatically. Recipe: the [Reminders in your terminal](#reminders-in-your-terminal--tui-agent) section below (or `jovida help due`).
- **Import their Lark/Feishu tasks** — if they use Lark tasks, `jovida import lark` brings open tasks over (idempotent, re-runnable; see `jovida help import`). Run `--dry-run` first and show them what would come across.

From here, drive the CLI per **[`SKILL.md`](./SKILL.md)**. Sessions auto-renew; if any later command exits `2` (`NOT_SIGNED_IN`), sign the user in again exactly as in step 3.

---

## What it is

- **`jovida` command** — talks to the user's Jovida account over HTTPS (login required), keeps **no local todo database**, and syncs with their other Jovida devices.
- **`SKILL.md`** (name: `jovida-cli`) — a portable behavior guide that teaches the AI to drive the CLI on a **single track: writes apply immediately** (no proposal/confirmation step; `complete` is reversible via `reopen`, but `delete` is permanent).

## Quickstart

```bash
jovida create "submit the report by Friday 6pm" --when 2026-06-12T18:00:00+08:00
jovida list
jovida view <entry_id>
jovida complete <entry_id>
```

- **JSON output is automatic when piped** (for scripts/agents); `--json` / `--no-json` force it on/off.
- **Exit codes**: `0` ok · `1` usage · `2` not signed in · `3` backend/network · `4` not found.

## Commands

`create` · `list` · `due` · `view` · `update` · `complete` · `reopen` · `subtask` · `delete` · `import` · `login` · `logout` · `whoami`.
`jovida help` lists usage; [`SKILL.md`](./SKILL.md) documents flags & field conventions.

`jovida import lark` pulls your incomplete Lark/Feishu tasks into Jovida (one-way, idempotent — safe to re-run or schedule; tasks completed in Lark later get completed in Jovida on the next run). It reads via the official `lark-cli` (`npm i -g @larksuite/cli && lark-cli auth login --domain task`); see `jovida help import`.

## Reminders in your terminal / TUI agent

`jovida due` is a read-only "what needs attention" radar: overdue todos plus anything whose deadline **or reminder** falls within a window (default 24h). It serves from a short-lived local snapshot cache (60s; any write through the CLI invalidates it), and an expired cache is revalidated with a cheap version probe before any full re-pull — so it's cheap enough to run on every prompt or statusline refresh. `--brief` prints a single line — and prints **nothing** when nothing is due, and stays **silent on errors** (exit 0), so it can't dirty a statusline.

Wire it into Claude Code (same idea works for any TUI agent with hooks/statusline):

```jsonc
// ~/.claude/settings.json
{
  // statusline: show due todos at a glance (append to your existing statusline command)
  // --ansi = layered colors (overdue red, time yellow, title dimmed)
  // --link = OSC 8 hyperlink: the segment becomes Cmd+clickable (opens jovida.ai) in
  //          terminals that support it — Claude Code's statusline passes it through
  "statusLine": { "type": "command", "command": "... ; JOVIDA_TIMEOUT_MS=5000 jovida due --brief --ansi --link" },
  // hook: when something is due, its one-liner is injected as context on your next message,
  // so the agent brings it up in conversation
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "JOVIDA_TIMEOUT_MS=5000 jovida due --brief", "timeout": 10 } ] }
    ]
  }
}
```

Set `JOVIDA_TIMEOUT_MS` (ms) in these commands so a bad network can never stall your TUI. For system-level notifications when no agent is open, run `jovida due --json` from cron/launchd and pipe into your notifier of choice.

## Auth

`jovida login` uses the **OAuth device authorization flow**: it prints one URL with the approval code built in (`https://jovida.ai/jovida-daily/device?code=…`), the user approves it in a browser, and the CLI receives a session token that **auto-renews** until the session is revoked. No keys to copy, no anonymous mode. (Step 3 above is how an agent drives this end-to-end, including the no-local-browser case.)

## Updating

- **CLI**: `npm i -g @fluxvita/jovida-cli@latest`. (In an interactive terminal the CLI also prints a notice when a newer version exists.)
- **Skill**: `jovida skill update` after updating the CLI — it re-copies the bundled `SKILL.md`, keeping the agent's knowledge in lockstep with the installed CLI version (same npm package, no drift).

## Manual install (without an AI agent)

If you're setting this up by hand rather than through an AI agent:

```bash
npm i -g @fluxvita/jovida-cli          # 1. install (or build from source, below)
jovida skill install                   # 2. install the skill into your agents
jovida login                           # 3. sign in — opens a browser; approve the CLI
jovida whoami                          # 4. confirm
```

- **Build from source** instead of npm: `git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`, then `jovida --version`.
- **Supported agents** for `jovida skill install`: Codex, Claude Code, Gemini CLI, Cursor, Windsurf, Continue, OpenCode, Goose, Qwen Code, Crush, KiloCode, Aider, GitHub Copilot (each at `<agent-dir>/skills/jovida-cli/`). An agent not on this list can use `jovida skill show` (see step 2).
- **Alternative installer** covering more agents — but it pulls the skill from the repo's latest, not the installed CLI version: `npx skills add FluxVita/jovida-cli`.

## The skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) — the agent skill (English / 中文对照) that teaches the AI when and how to use the CLI.

## License

[MIT](./LICENSE) © FluxVita
