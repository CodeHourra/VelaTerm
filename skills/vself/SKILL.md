---
name: vself
description: >-
  Read a VelaTerm session's saved properties and parent-child relationships. Use for ordinary or
  agent sessions when the user asks who spawned a session, which child sessions it has, or what
  configuration is saved on it. Can inspect the current session or another session by ID or name.
  Read-only: does not open, launch, message or interrupt any session.
---

# vself

```bash
vself
vself <session>
vself [session] --json
```

Omit the target to query the calling session. A target accepts a full ID, an ID prefix of at least eight
characters, an exact name or a unique name substring. Quote names containing spaces. An ambiguous
reference returns candidates; use an exact ID rather than guessing. To find a session ID by name,
`vrefer --list` lists the connected instance's sessions, including those with no readable transcript.

The text form lists identity, parent, ancestors and direct children. Use `--json` whenever saved
attributes are requested. This works for terminal, agent and browser sessions, including archived ones,
without requiring a plan-execute workflow or an active process.

JSON has `session`, `parent`, `ancestors` and `children`. `parent` is null for a top-level session;
`ancestors` starts with the immediate parent. `children` contains only direct children, ordered as in
the sidebar, including archived children whose parent link is still saved. Query a child to inspect
its children. Relationships come from `parentSessionId`, not similar names or `groupId`.

Each session object contains its saved fields: ID, project/group, name, agent kind, shell, directory,
launch configuration, permissions, collaboration mode, preset, executable, shortcut, engine, native
conversation ID, parent ID, collapse/fork state, worktree and baseline ref, archive time, browser URL,
mark, sort order and creation time. Additional properties are `modelSettings` (saved model/effort),
`launchModelSettings` (model/effort explicitly present in saved launch arguments),
`codexSettings` (service tier/personality), `claudeSettings` (Chrome), `autoContinue` (saved resumption
schedule), and `workflowIds` (direct memberships). Null denotes an unset saved value, not an inferred
effective default. Lookup does not run the agent or sample its native configuration files.

`redactedFields` identifies masked launch input, environment values and URL credentials/query/fragment;
environment variable names remain visible. Do not interpret masked values as missing configuration.
Use `vflow list <session>` for related plan-execute tasks and current workflow states, or
`vrefer <session>` for its conversation. A native `agentSessionId` is different from the VelaTerm ID:
use `id`/`sessionId` in VelaTerm commands.

Run inside a VelaTerm-hosted session so the injected `VLX_*` environment points at the right backend.
Queries read only that connected instance. If the command rejects a target argument, the running
backend predates this query form; report the version mismatch instead of guessing or modifying SQLite.
