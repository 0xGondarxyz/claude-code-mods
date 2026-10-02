# active-time

A Claude Code mod that counts the time you really spend with Claude Code. An open terminal does not count. A dev server running in the background does not count.

The mod lives in a folder named `active-time` because Claude Code reserves plugin names that start with `claude-`. The command is still `/claude-time`.

## Install

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install active-time@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/active-time
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

## What counts

Two kinds of active time:

- `you`: you write in the prompt box. Edits with a gap of 120 s or less form one interval. A longer pause starts a new one. Submitting a prompt closes the interval.
- `claude`: Claude works. This is each model request and each tool call of any agent of any agent (one tool call counts at most 10 minutes). Background subagents count while they work. Gaps of 30 s or less between these join. The wait of a turn (for example on a question) does not count, only the model requests and tool calls inside it.

The total is the union of both kinds. Overlaps count once. Two sessions that work at the same time count once.

## Status line

```
CC today 2h14m · week 11h05m
```

A day is a work day from 05:00 to 05:00 local time, so work after midnight counts for the day before. The week starts on Monday 05:00. It updates after each turn and every 60 s.

## Command

`/claude-time` shows:

- today, this week and this month, each split into `you` and `claude`
- the last 7 days, one line each
- this week per repo (top 5, by folder name)

## Where the data lives

Each session writes its own file, so sessions never overwrite each other:

```
~/.claude/active-time/<YYYY-MM-DD>_<sessionId>.json
```

Content: `{ "repo": "...", "intervals": [{ "s": ms, "e": ms, "k": "you" | "claude" }] }`. A session that crosses 05:00 writes one file per work day, and `<YYYY-MM-DD>` is the work day. The repo is the git top level of the session folder, or the folder itself.

To reset, delete the folder:

```fish
rm -r ~/.claude/active-time
```

## Backfill from transcripts

Sessions that started before the mod loaded are rebuilt from the transcripts in `~/.claude/projects`, for the last 40 days. This gives Claude time only. Typing time of old sessions cannot be recovered.

- Each transcript entry has a timestamp. For two entries in a row, the time between them counts as `claude` time when the second one is not a real user prompt and the gap is 10 minutes or less. A prompt starts a wait. A longer gap is a wait too. Gaps of 30 s or less join.
- Headless transcripts (`claude -p`, the SDK) are skipped.
- Results go to `~/.claude/active-time/<YYYY-MM-DD>_<sessionId>.bf.json` (same shape plus `"source": "transcript"`). Live files are never touched. Totals take the union of all files, so a session with both kinds counts once.
- It runs in the background at the start of an interactive session, then every 10 minutes. Only transcripts changed since the last run are read again. The first run can take a while.
- It needs `python3` (`/usr/bin/python3`) and `find`.

## Headless runs

Sessions without a person at the prompt (`claude -p`, the SDK) record nothing, write no file and show no status line.

## Limits

- Intervals still open when Claude Code crashes are lost.
- A tool call that waits for your permission answer counts as Claude time (up to the 10 minute cap).
- Typing is seen only in the main prompt box.
- Totals are wall clock, not billed time.
