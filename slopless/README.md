# slopless

A Claude Code mod that stops Claude from writing AI sounding posts and replies for X, LinkedIn and other social media. MIT licensed.

I let Claude write 48 replies on X for me. They read like this:

> $200 MRR and 200 active subscribers as a side project is real traction. That's enough to validate the product works. Now the question is whether to double down or keep compounding on the side.

They got 2 to 7 views each. So I read 421 replies under 8 indie hacker posts and compared the ones people liked with the ones nobody touched. The liked ones asked a real question, shared the replier's own number, gave the fix, joked about one detail or pushed back in a few words. The ignored ones sounded like the reply above. [rules.md](rules.md) is what came out of that.

## What it does

| Where | What happens |
| --- | --- |
| System prompt | a short notice that social text follows rules.md |
| Your prompt | if it mentions tweets, X posts or replies, LinkedIn, TikTok, Reddit, captions and so on, rules.md and your voice file are attached |
| Write and Edit | `.txt` and `.md` files under a folder whose name contains social, linkedin, tweet or twitter are checked. ALL CAPS file names (README.md, PLAN.md) count as notes and are skipped |
| Bash | commands that write into those folders are checked |
| Browser | text Claude types through Claude in Chrome (type, form_input, browser_batch, scripts that insert text) is checked. Hashtags are allowed when the tab is on youtube.com (titles and descriptions there need them); all other rules still apply |

When the text breaks a rule, the tool call is blocked and Claude gets the hits:

```
slopless blocked this text. Rewrite it from scratch, do not reword around the rule.
- verdict: "real traction"
- advice: "double down"
- word: "compounding"
```

What `hooks/lint.ts` blocks:

| Rule | Examples |
| --- | --- |
| contrast | not just, rather than, instead of, matters more than, wins over |
| template | is the product, doing all the work, the hard part, where the time goes, this is why |
| verdict | real traction, real validation, smart way to, sharp framing |
| advice | double down, now figure out, the question is whether |
| word | leverage, moat, compounding, seamless, robust, crucial, ROI and about 20 more |
| format | em dashes, hyphens between words, hashtags, emoji, profanity |
| lol | more than once in a text, or in more than 1 of the last 10 texts |

The hyphen, emoji and profanity bans are my own taste. Delete those lines in `hooks/lint.ts` if you want them back.

Regexes only catch the obvious stuff. A moral one liner at the end of a post, or a reply that explains the post back to its author, gets through the linter. rules.md covers those, and Claude reads it before it writes.

## Tested

Same prompt, run headless with Sonnet 5.5, with and without the mod: write my reply to "Huge milestone for my side project: $200 MRR and over 200 active subscribers", make it sound insightful, say this is real traction and the question is whether to double down.

Without slopless:

> This is real traction. 200 people paying is a different signal from 200 people signing up. It validates the product: strangers value it enough to hand over money every month. Now the interesting question is whether to double down.

With slopless:

> $200 across 200 subs is about $1 each, is that a cheap plan or mostly discounts?

And when I told it to save "This is real traction. The moat was never the code, it is the distribution. Now double down." word for word into a posts folder, the write was blocked and nothing was saved.

## Voice file

Optional. A markdown file with facts about you: what you built, your real numbers, what you never talk about. Claude may only claim experience from it. Point the mod at it:

```
echo '{"voiceFile": "/absolute/path/VOICE.md"}' | claude plugin configure slopless@claude-code-mods --values-stdin
```

## Claude can't turn it off

The mod blocks `claude plugin disable` and `uninstall` for itself, edits to its own files, and settings edits that switch it off. You can still turn it off yourself with `/plugin`.

## Install

Inside Claude Code:

```
/plugin marketplace add 0xGondarxyz/claude-code-mods
/plugin install slopless@claude-code-mods
```

Or try it without installing:

```
git clone https://github.com/0xGondarxyz/claude-code-mods
claude --plugin-dir claude-code-mods/slopless
```

Mods are not sandboxed. They run with the same access as Claude Code. Read the source before you install any mod, including this one.

Run its tests: `claude plugin test slopless`

Sister mod: [dashless](https://github.com/0xGondarxyz/claudeMods), which rewrites em dashes out of everything Claude writes.
