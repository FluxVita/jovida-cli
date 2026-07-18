# Changelog

## 0.5.0

Realtime push and a scriptable automation engine on top of the todo CLI.

### Added

- **`jovida watch`** — live SSE push stream of todo changes (notify-then-pull; JSONL for scripts/agents).
- **`jovida daemon`** — resident background process that keeps the push connection open, fills the statusline with zero startup cost, and pops desktop notifications on todo changes and due/overdue reminders (reminder timers run locally, no server round-trip). macOS notifications ship under Jovida Daily's identity via a bundled `terminal-notifier`.
- **Automation engine — rules `when / where / do`.** Every event is a unified envelope `{source, type, title, id, at, data}`; a matching rule runs actions: `exec`, `notify`, `create`, `complete`, or `dispatch`. Agent-authorable via `jovida rules spec`, `rules add --spec`, and `--dry-run`.
- **Four event sources** feeding one engine: built-in `todo`, `jovida emit` (push, at-least-once atomic spool), `jovida poll` (scheduled check, rising-edge trigger), `jovida stream` (long-lived JSONL command, supervised).
- **`jovida pack`** — export/import/save/install a bundle of sources + rules as a shareable "shortcut," safely re-instantiated on install.
- **Local agent worker** — `jovida worker` / `jovida task`: `dispatch` queues a task, a resident serial worker runs a configured coding agent against it and emits `task.done`/`task.failed` back into the engine to close the loop.
- **`jovida automations`** (alias `auto`) — one-screen overview of every source, rule, pack, and the daemon's state.

### Security

- `exec` and worker commands receive event data only via `$JOVIDA_*` env + stdin — never string-interpolated into a shell. `notify`/`create`/`complete`/`dispatch` are templated but never touch a shell (`create`/`complete`/`dispatch` invoke the CLI via an argv array), so titles and commit messages can't inject.

### Reliability

- `emit` is at-least-once (spool entry deleted only after dispatch); stale backlog beyond `JOVIDA_EMIT_TTL_SEC` (default 3600s) is dropped rather than replayed.
- `poll` edge state is persisted, so a daemon restart mid-condition doesn't replay the trigger.
- `stream` restarts on exit with capped backoff; actions retry only transient spawn failures (never non-zero exits/timeouts, which may have run).
