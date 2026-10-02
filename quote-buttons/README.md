# quote-buttons

A Claude Code mod. It adds four things.

1. **Quote button.** Every user message and every assistant text block shows `[ ↩ quote ]` on hover (top right of the message). A click puts the message in the prompt box as a quote (`> ` per line, at most 6 lines and 400 characters, `…` when cut) above your draft.
2. **Edit button.** Your own messages also show `[ ✎ edit ]`. It puts the original text in the box. If the box has text, it shows `Clear the box first` and changes nothing. Real rewind stays Esc Esc.
3. **Undo send.** A prompt you submit while a turn runs is held for 5 seconds. The band above the prompt shows `Sending in 5s: <text>` and `[ undo ]`. Undo drops the prompt and puts the text back in the box (below any draft). Prompts sent while idle are untouched.
4. **Hand-off buttons.** Every message also shows `[ ⇢ with context ]` and `[ ⇢ fresh ]` in the same hover box. Each opens a new Konsole tab in the session's project root.
   - `⇢ with context` runs `claude --resume <session id> --fork-session "Take this over and do it now:\n\n<message>"`, a fork of the whole conversation.
   - `⇢ fresh` runs `claude "<message>"`, a new session.
   - The tab is opened with `konsole --new-tab --workdir <root> -e claude ...`, by argv (no shell, so quotes and newlines are safe). Toast: `Opened a new tab (with context)` or `(fresh)`.
   - If Konsole is missing, the launch fails or there is no session id yet, the toast gives the reason and the full command goes to the clipboard to paste into any terminal.

The band above the prompt is shared: the mod wraps what other mods draw there.

## Limits

- The hand-off buttons need Konsole, and `--new-tab` needs "Run all Konsole windows in a single process" (the default); otherwise Konsole opens a new window.
- Buttons need the fullscreen terminal layout (mouse clicks). On the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default) the transcript is printed into scrollback and there is no pointer, so the message buttons cannot be clicked. The undo band button is a normal Button (click, or Tab focus and Enter where the band holds the keys); not tested on the main screen.
- The 5 second hold costs 5 s of the hook's 10 s budget.

## Develop

    claude plugin validate .
    claude plugin test .
