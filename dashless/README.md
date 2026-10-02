# dashless


Removes em dashes from what Claude writes, before it lands. About 80 lines of TypeScript.

| Where | What gets fixed |
| --- | --- |
| Write tool | the file content |
| Edit tool | `new_string` only (`old_string` must match the file, so it is never touched) |
| Bash | only `git commit` and `gh pr` / `gh issue` `create`, `edit`, `comment`; every other command runs as is |
| Replies | text blocks in Claude's responses, before they are stored |

Rewrite rules (<code>&mdash;</code> is the em dash, <code>&ndash;</code> the en dash):

<!-- Dashes in this file are HTML entities on purpose. With literal characters, dashless rewrites its own examples whenever Claude edits this file. -->

| Input | Output |
| --- | --- |
| <code>a &mdash; b</code>, <code>a&mdash;b</code> | `a, b` |
| <code>&mdash; item</code> at line start | `item` (indentation kept) |
| <code>done &mdash;</code> at line end | `done` |
| <code>note: &mdash; x</code> | `note: x` |
| <code>a &ndash; b</code> (spaced en dash) | `a, b` |
| <code>1990&ndash;2000</code> (range) | unchanged |
| `--force`, `-- file` | unchanged |

The status line shows a running count: `dashless: 3 em dashes fixed`.

Tested by running the same prompt twice in a throwaway git repo (write a file, commit it, reply with a sentence, each with an em dash). Without the mod 4 em dashes landed; with it, 0.

Run its tests: `claude plugin test dashless`
