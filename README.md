# claude-code-mods

Free mods for Claude Code, all in one repo. MIT licensed.

## Install

Inside Claude Code:

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install <mod>@claude-code-mods
```

Or try one without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/<mod>
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including these.

## Mods

| Mod | What it does | Needs |
| --- | --- | --- |
| [dashless](dashless) | Rewrites em dashes out of Claude's replies, file writes, edits and commit messages before they land. | |
| [slopless](slopless) | Blocks AI sounding text in social media writing (X replies, X posts, LinkedIn posts) and attaches the writing rules. | Your own voice file (optional) |
| [usage-meter](usage-meter) | Shows your 5 hour and weekly rate limits in the status line, warns at 80% and 90%. | |
| [output-ladder](output-ladder) | Re-explains the last answer as plain STE text, a diagram, an HTML page or an explainer video, and scores answers for STE style. | |
| [secret-guard](secret-guard) | Masks API keys and tokens in tool results before Claude reads them, and blocks a git push that would leak secrets or home paths to a public repo. | |
| [spiral-stop](spiral-stop) | When the same error comes back after 3 fix attempts, tells you and Claude to stop and rethink. | |
| [active-time](active-time) | Counts the time you really spend with Claude Code (typing and Claude working, not an idle terminal). `/claude-time` shows the totals. | |
| [save-game](save-game) | Saves a 3 line card when you stop (doing, next step, open question) and shows it above the prompt next time you open that repo. | |
| [agent-watch](agent-watch) | One line per running subagent above the prompt: model, task, minutes and its latest tool call. | |
| [quote-buttons](quote-buttons) | Quote and edit buttons on chat messages, hand-off buttons that open a new tab with Claude on that message, and a 5 second undo for prompts sent while Claude works. | Fullscreen mode for the buttons; Konsole for hand-off |
| [snap](snap) | `/snap`: drag a box on screen and the screenshot goes into your next message. | KDE (Spectacle) |

Each folder has its own README with the details.

agent-watch, quote-buttons, save-game, active-time and snap are new. Bug reports are welcome in the issues.

## Develop

```
claude plugin validate <mod>
claude plugin test <mod>
```
