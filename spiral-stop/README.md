# spiral-stop

A Claude Code mod that stops fix loops. Claude runs a test, edits code, runs it again, gets the same error, and repeats. This mod notices. After 3 fix attempts with the same error, it tells you and tells Claude to stop and name the assumption that might be wrong.

## Install

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install spiral-stop@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/spiral-stop
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

## What it does

1. Every failed Bash call gets an error signature. The mod keeps the first 2 error-looking lines and removes numbers, hex ids, durations, timestamps, `:line:col` and path prefixes. If no line looks like an error, it uses the last output line.
2. A fix attempt is a Write, Edit, MultiEdit or NotebookEdit call, or a new prompt from you. The same signature counts again only when a fix attempt came in between. Running the same failing command twice with no edit counts once.
3. At count 3 the mod:
   - adds a note for Claude: stop changing code, name the wrong assumption in 1 or 2 sentences, ask you one diagnostic question.
   - shows a band above the prompt: `Spiral: same error after 3 fixes: <signature> [Dismiss]`.
   - shows one toast.
4. A second trigger: 3 prompts in a row from you that say it is still broken ("still not working", "same error", "didn't fix it"). Any other prompt resets this counter.
5. When the same command later succeeds, its signature is dropped (and the band, if it was for that signature).

The note reaches Claude as context after the failing tool result (or after your prompt for the prompt trigger). It never adds a conversation row.

## Commands

- `/spiral` prints the top 5 tracked signatures with counts, and whether the band is up.
- `/spiral reset` clears all signatures and the band.

The band has a Dismiss button.

## Limits

- The counters live in memory. A hot reload or a new session starts them at zero.
- Failure means the Bash tool reported an error (non-zero exit). A command that prints errors and exits 0 is not tracked.
- The signature is a heuristic. Two different errors with the same first lines look the same.
- Fixed values: threshold 3, top 5, 200 characters. No options.

## License

MIT
