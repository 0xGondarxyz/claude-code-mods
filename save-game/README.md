# save-game

A Claude Code mod that makes stopping painless. It writes a 3 line save card when you stop. The next time a session opens in that repo, the card shows above the prompt with a Continue button.

## Install

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install save-game@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/save-game
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

## The card

```
Doing: <what you and Claude were working on: files, feature, bug>
Next: <the single next step>
Open: <the open question or blocker, or "none">
```

Cards are kept per repo (the git toplevel of the session folder, else the folder). The store holds the 5 newest per repo. A newer card of the same session replaces the older one.

## When a card is made

1. Idle: 4 minutes after a main thread turn ends. A new prompt or turn cancels the timer. No new turn since the last card means no card.
2. Past 01:00 local time: once per night, if the session had a turn in the last 30 minutes. A toast says it is a good point to stop.
3. `/save`: makes a card now.
4. Session end: if there were turns since the last card, the mod does not call a model (exit time is short). It queues the session. The next session that starts, in any repo, turns the queue into cards in the background with Sonnet, from the tail of the transcript file (your prompts and Claude's text only).

Cards from 1 to 3 use a fork of the live session. It reuses the prompt cache, so it is cheap. The fork only works while the cache is warm (the shortest cache lifetime is 5 minutes, hence 4).

## Commands

- `/save`: make a card now and print it with `full context: claude --resume <session id>`. With no new turns it prints the newest card again.
- `/save list`: the last 5 cards of this repo, each with its age, its 3 lines and its resume line.

## The band

At session start, if this repo has a card younger than 14 days, a band shows above the prompt:

```
Saved 3h ago (session ab12cd3)
Doing: ...
Next: ...
Open: ...
[ Continue ] [ Dismiss ]
```

Continue sends `Continue where I stopped. Save card:` and the 3 lines as your first prompt. Dismiss hides the band. The band also hides after the first prompt you send. If a queued card for this repo finishes during startup, the band updates to it.

## Headless runs

In `claude -p` and SDK runs the mod does nothing: no timers, no queue, no band, no `/save`.

## Options

None.

## Limits

- Module state (turn counts, timers) resets when the mod reloads. Cards and the queue live in the plugin store and stay.
- The queue is read and cleared at session start. Two sessions that start in the same instant can both process the same entry.
- The transcript path is derived from the session folder and id. If the file is missing, the queued session is skipped without a message.
- Only the last 3 MB of the transcript file is read, then cut to the last 30,000 characters of text.
- Needs `tail` on the machine for the queue step (Linux and macOS have it).

## License

MIT
