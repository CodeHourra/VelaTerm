---
name: vflow
description: >-
  Query VelaTerm plan-execute workflows by session: find planner and executor IDs, tasks, states,
  rounds, delivery receipts and saved session properties. Use when a workflow ID is unknown or the
  user asks which execute sessions belong to a plan session. Lookup is read-only; it does not dispatch,
  message, stop or accept work.
---

# vflow

Use saved backend associations rather than guessing from session names or reading SQLite directly.

```bash
vflow list
vflow list <plan-session>
```

The first form queries the calling session. The second accepts a full session ID, an ID prefix of at
least eight characters, an exact name, or a unique name substring. Quote names containing spaces. An
ambiguous reference returns candidates; choose an exact ID. Lookup can inspect another session,
including an archived session, in the same connected VelaTerm instance.

Read the JSON result:

- `session`, `parent`, `ancestors`, `children`: the resolved session, its parent, ancestor chain and
  actual direct children, with saved properties and per-session settings.
- `workflows`: associated overall workflows, including saved configuration, state, round, latest
  handoff summary, planner, executor, recent delivery receipts, and split `tasks`.
- `workflows[].tasks`: each task's name, prompt, independent workflow ID, state, round, and executor.
- `workflowIds` on a session: its direct workflow memberships; `parentSessionId` records its tree parent.

An empty `workflows` array does not mean there are no children. Inspect `children` separately and do not
call every child a workflow executor. An executor may be absent before its first dispatch. Activity and
delivery receipts do not prove task completion; check the saved state and execution evidence.

Session objects include project/group placement, agent and native conversation IDs, engine, directory,
worktree and baseline ref, permissions, collaboration mode, preset, executable, shell, shortcut, mark,
sort order, creation/archive timestamps, collapse/fork state, and saved model/effort, Codex, Claude and
auto-continue settings. `launchModelSettings` separately reports model/effort explicitly saved in launch
arguments. Null means the value was not saved; do not invent an effective default.
`redactedFields` identifies masked launch input, environment values and URL credentials/query/fragment.
Environment variable names remain visible. These masked values are not evidence that a setting is empty.

For complete reports or tool history, use `vrefer <executor-session-id>`; summaries can be truncated.
For ordinary session hierarchy or properties without workflow details, use `vself [session] --json`.

Inside a workflow member session, `vflow status <workflow-id>` reads that workflow's detailed status.
Unlike `list`, `status` requires the caller to be its owner, planner or executor. Existing dispatch,
stop, block and accept commands retain their role and round checks. Read-only lookup does not authorize
those actions. For an already authorized planning/execution handoff, read
`../vspawn/references/plan-execute.md` and follow that protocol.

The commands require a VelaTerm-hosted session and its injected `VLX_*` environment. If `vflow list`
reports an unknown action, the running backend predates lookup support; report the version mismatch
instead of treating it as an empty workflow or editing the database.
