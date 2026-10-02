# agent-watch

A Claude Code mod. While subagents run, the band above the prompt shows one line per agent:

```
Sonnet · Build snap screenshot mod · 6 min · now: Bash claude plugin test
```

- Label: the agent's model (Sonnet, Opus, Haiku, Fable), else its subagent type.
- Minutes update every 15 s.
- `now:` is the agent's latest tool call (file name, first 40 characters of a Bash command, or pattern), cut to the band width.
- When an agent ends, its line shows `done` (green) for 30 s, or `stopped` (yellow) if it failed or was stopped, with one toast `Agent finished: <description>`.
- With no agents the mod draws nothing. Other mods' rows stay below ours.

## Engine data used

- Start: `agent.spawn`. `next(e)` answers `{ model, agentId }`; the input holds `description` and `subagentType`.
- Progress: `tool.call` with `agentId` (set only inside a subagent loop). Hooks always pass through.
- Finish: `turn.complete` with `agentId` (`reason` `answer` is done, anything else stopped), and every 15 s `$.agent.list()` status (`completed`, `failed`, `killed`) as a fallback.
- State: `agent-watch.agents` in `$.state`, so a hot reload keeps the rows.

## Limits

- The engine does not tell a background agent's end apart from a foreground one; both end through `turn.complete` or `$.agent.list()`.
- Teammates (`type: teammate`) never pass `agent.spawn`, so they are not shown.

## Develop

```fish
claude plugin validate .
claude plugin test .
npx tsc -p .
```
