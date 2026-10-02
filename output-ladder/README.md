# output-ladder

A Claude Code mod that asks the model to re-explain its last answer as ASD-STE100 text, a diagram, an HTML page or an explainer video, and scores each answer for STE style in the status line.

Based on a post by Andrej Karpathy about making LLM output easier to understand (ASD-STE100 text, diagrams, HTML pages, explainer videos). Not affiliated with him.

## Install

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install output-ladder@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/output-ladder
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

## Commands

Each command sends a prompt about your last answer. Text you type after the command is added as `Extra instruction: <text>`.

| Command | What it asks for |
| --- | --- |
| `/ste` | The last answer rewritten about 80% of the way to ASD-STE100. `/ste full` asks for strict ASD-STE100. |
| `/diagram` | An ASCII diagram with boxes and arrows, 100 columns wide, plus at most 3 lines of notes. |
| `/page` | One self-contained HTML page with inline SVG. It is published if an Artifact or publish tool exists, otherwise saved to a file. |
| `/video` | A short explainer video in the style of 3Blue1Brown: a scene plan first, free or local tools, an MP4 at the end. |

## Buttons

When an answer has 120 or more words of prose, four buttons appear above the prompt: `STE`, `Diagram`, `Page`, `Video`. Pressing one sends the same prompt as the command (without extra instruction) and hides the buttons. The buttons also hide when you send a new prompt.

## STE score

After each answer the status line shows `STE 82%`. The score is 100 times a weighted mix of three shares:

- 60%: the share of sentences with 20 words or fewer.
- 25%: the share of sentences with no passive voice (a form of "to be" followed by a word ending in -ed or -en).
- 15%: the share of words that are 12 characters or shorter.

Code blocks, inline code, table rows, headings and URLs are left out. List items count as sentences. An answer with fewer than 40 prose words gets no score, and the status line keeps the previous one.

The score measures style only. The official ASD-STE100 dictionary and rules are not bundled, so it cannot tell whether a word is approved. The passive check is a simple pattern and has false positives and misses.

## Tests

```
claude plugin test .
```

MIT
