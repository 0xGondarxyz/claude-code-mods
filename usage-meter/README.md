# usage-meter

A Claude Code mod that shows your Claude 5 hour and weekly rate limits in the status line and sends a toast at 80% and 90%.

## Install

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install usage-meter@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/usage-meter
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

## What it shows

Status line:

```
Claude 5h 62% (resets 18:40) · week 41%
```

Toast, once when a window first reaches 80% and once more at 90%:

```
Claude 5h limit at 82%, resets 18:40. Good time to hand big tasks to Sonnet.
```

If a reading jumps from below 80% straight past 90%, only the 90% toast is sent. It warns again after usage falls back under 80%, which happens when the window resets.

| Window | Label |
| --- | --- |
| 5 hour | `5h` |
| 7 day | `week` |
| Spend limit (Claude gateway) | `spend` |
| Anything else | the window's own name |

The reset time is local, 24 hour, and shown on the 5h part only. It is left out when the reset time is missing.

## Notes

- Needs a Claude subscription. With an API key there are no rate-limit windows, so it shows nothing.
- Figures update after each turn (and when a window moves a whole point), so they can lag right after a window resets.

## Tests

```
claude plugin test .
```

MIT
