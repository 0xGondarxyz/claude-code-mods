# session-title

A Claude Code mod that shows a short title of what the session is about at the right end of the footer line under the prompt, so you can tell many open terminals apart at a glance.

## Install

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install session-title@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/session-title
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

## What it shows

Footer line under the prompt, at the right end:

```
Checkout page bug
```

The title has 2 to 5 words. It is made by Haiku from your first prompt, your last 8 prompts and the last assistant reply. It updates after each turn that has a new prompt, and once when the session starts, so resumed sessions get a title at once. If the current title still fits, it stays.

## Notes

- Each refresh makes one small Haiku call (30 output tokens at most).
- If the call fails or times out, the previous title stays.
- Turns from subagents do not trigger a refresh.

## Tests

```
claude plugin test .
```

MIT
