import { test, expect, mock } from 'claude-code/testing'
import { lint } from './lint'

const D = '\u2014'
const SLOP = 'That is the ultimate moat, not just hype, and it compounds quietly.'
const CHROME = 'mcp__claude-in-chrome__'

const MUST_FLAG = [
  '100k installs to $2k revenue means the distribution engine is working, the monetization just needs to catch up. Turning your learnings into paid PDFs is a smart way to extract more value from the audience you already built.',
  "AI handles the execution speed, the founder handles the taste. That's what makes a solo product feel intentional instead of generated. The craft is in the decisions, not the code.",
  'Vibecoding Ahrefs is the ultimate moat test. If the core value can be replicated with a prompt, the moat was never the tech. It was always the data and the distribution.',
  '$200 MRR and 200 active subscribers as a side project is real traction. That\'s enough to validate the product works. Now the question is whether to double down or keep compounding on the side while the day job funds the growth.',
  'People overthink the UI. A medical app with a basic interface that solves a real problem will always beat a beautiful app nobody searches for. Utility wins over aesthetics in health niches.',
  '20% of the weekly limit in 1.5 hours is brutal for sustained coding sessions. The real edge of Opus 5.5 is not having a meter running while you think through a problem.',
  "This is why location-independent revenue matters. Your business shouldn't be tied to one country's economic cycle.",
  '50% watch time threshold means shorter videos win the math. A 15s video needs 7.5s of attention, a 60s one needs 30s.',
  'The daily floor moving up consistently matters more than any single spike. That curve says the product has real retention, not just launch hype.',
  'First sale in the first 24 hours is real validation. Most apps go weeks without one. Now figure out what made that buyer convert and double down on that channel.',
  'Permissions and rollback aging better than mascots is a sharp framing. The trust layer is the product.',
  'Screenshots are the highest-leverage asset in most App Store listings.',
  'Profitable from the first sale is the key differentiator. The boring model wins because it compounds quietly.',
  'the almost in parentheses is carrying the whole pricing page',
  'that parenthesis is doing all the sales work',
  'reusing a good post beats giving yourself a second content calendar',
  'Posting the same content is easy. Managing another platform is where the time goes.',
  'that kind of pride is hard to fake, and probably shows up in every little detail',
  'thats the right way to build pride in the work itself, not just the sales',
  'Pride in the product is what keeps a solo founder shipping through the weeks when nobody buys.',
  `great post ${D} so true`,
  'love it #buildinpublic',
  'so good \u{1F525}',
  'lol this is lol',
  'Lesson for anyone building a filter for agent output: it will also filter the docs about itself.',
  "The part I like: steps 1 to 3 don't care what I'm selling.",
  "That split is the part I'd copy for any agent tool.",
  'If you scrape Maps with Playwright, save yourself the evening',
]

const MUST_PASS = [
  'do you already have a following there?',
  'But did the number of subscriptions drop?',
  'whats the use case here, since you already have the blurred option?',
  'i got paid out like $100 less, it said 1.1k and i got like 990',
  'Check fiscal calendar. The pay period was August 22 to August 29',
  'That $34.59 from YouTube is doing its best',
  "My apps feel lifeless because they don't have any users",
  'way too much text no?',
  'But it could be skewed as today you have better distribution?',
  'holy max you are cooking',
  'problems i wish i had',
  'typefully is goated',
  'how much of the 100k came from tiktok? mine gets views but like 95% of them are in turkey',
  'haha working with others = opus and fable. same here, my whole team is sonnet and opus',
  "ok but where's the backlink data coming from",
  "congrats! what's the pricing? 200 subs and $200 MRR got me curious",
  'lol the apple juice column. what app is this?',
  'what were you running on it? i moved to sonnet writing the code and opus only reviewing',
  'another one? how many of the stores you bought from went bust now',
  "where'd you see the 50%? my yt shorts are all over the place, one got 613 views and one got 9 the same week",
  "what's driving it lately, seo or your X posts?",
  'congrats! where did the first buyer find it?',
  'Install it: `claude plugin install slopless@slopless` then see https://github.com/0xGondarxyz/slopless and ~/.claude/agents/coder.md',
  'A $10 one time unlock at $4 per install breaks even only if 40% of installs pay.',
]

test('lint flags every slop sample', () => {
  for (const s of MUST_FLAG) expect([s, lint(s).length > 0]).toEqual([s, true])
})

test('lint passes every clean sample', () => {
  for (const s of MUST_PASS) expect([s, lint(s)]).toEqual([s, []])
})

test('lint reports rule names and trims matches', () => {
  const hits = lint(SLOP)
  const rules = hits.map((h) => h.rule)
  expect(rules.includes('contrast')).toBe(true)
  expect(rules.includes('word')).toBe(true)
  expect(hits.every((h) => h.match.length <= 60)).toBe(true)
  expect(lint('gh pr create --head 0xGondarxyz:add-slopless --base=main-line', { shell: true })).toEqual([])
  expect(lint('a well-known fix').some((h) => h.rule === 'hyphen')).toBe(true)
})

async function run($: any, input: Record<string, unknown>) {
  const r = await $.tool.call(input)
  return { denied: typeof r.deny === 'string', text: String(r.deny ?? '') }
}

async function prime($: any) {
  await run($, { tool: 'Write', file_path: '/x/social-media-posts/X/00.txt', content: 'do you already have a following there?' })
}

function stub(on: any) {
  mock.store(on)
  on('fs.read', () => ({ value: '# slopless writing rules\nsome line' }) as never)
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
}

test('first clean social write shows the rules, the second passes', async ($, on) => {
  stub(on)
  const p = { tool: 'Write', file_path: '/x/social-media-posts/X/01.txt', content: 'do you already have a following there?' }
  const first = await run($, p)
  expect(first.denied).toBe(true)
  expect(first.text.includes('read these rules')).toBe(true)
  expect(first.text.includes('slopless writing rules')).toBe(true)
  expect((await run($, p)).denied).toBe(false)
})

test('Write to a social file is checked', async ($, on) => {
  stub(on)
  await prime($)
  const bad = await run($, { tool: 'Write', file_path: '/x/social-media-posts/X/01.txt', content: SLOP })
  expect(bad.denied).toBe(true)
  expect(bad.text.includes('contrast')).toBe(true)
  expect(bad.text.includes('word')).toBe(true)
  expect((await run($, { tool: 'Write', file_path: '/x/social-media-posts/X/01.txt', content: 'do you already have a following there?' })).denied).toBe(false)
  expect((await run($, { tool: 'Write', file_path: '/x/src/app.ts', content: SLOP })).denied).toBe(false)
  expect((await run($, { tool: 'Write', file_path: '/x/social-media-posts/PLAN.md', content: SLOP })).denied).toBe(false)
})

test('Edit new_string to a linkedin path is denied', async ($, on) => {
  stub(on)
  await prime($)
  const r = await run($, { tool: 'Edit', file_path: '/x/linkedin/post.md', old_string: 'a', new_string: SLOP })
  expect(r.denied).toBe(true)
})

test('browser typing is checked', async ($, on) => {
  stub(on)
  await prime($)
  expect((await run($, { tool: `${CHROME}computer`, action: 'type', text: SLOP })).denied).toBe(true)
  expect((await run($, { tool: `${CHROME}computer`, action: 'type', text: 'hello' })).denied).toBe(false)
  expect((await run($, { tool: `${CHROME}computer`, action: 'left_click' })).denied).toBe(false)
  expect((await run($, { tool: `${CHROME}form_input`, value: SLOP })).denied).toBe(true)
  const batch = { tool: `${CHROME}browser_batch`, actions: [{ name: 'computer', input: { action: 'type', text: SLOP } }] }
  expect((await run($, batch)).denied).toBe(true)
  expect((await run($, { tool: `${CHROME}javascript_tool`, text: `el.value = "${SLOP}"` })).denied).toBe(true)
  expect((await run($, { tool: `${CHROME}javascript_tool`, text: `document.querySelector('a').click(); x = "hi"` })).denied).toBe(false)
  expect((await run($, { tool: `${CHROME}javascript_tool`, text: `document.execCommand('insertText', false, '${SLOP}')` })).denied).toBe(true)
  const readOnly = "[...document.querySelectorAll('article')].map(a => `${a.innerText} | data-testid things here`).join('\\n')"
  expect((await run($, { tool: `${CHROME}javascript_tool`, text: readOnly })).denied).toBe(false)
  const jsBatch = { tool: `${CHROME}browser_batch`, actions: [{ name: 'javascript_tool', input: { text: `document.execCommand('insertText', false, '${SLOP}')` } }] }
  expect((await run($, jsBatch)).denied).toBe(true)
  expect((await run($, { tool: 'mcp__playwright__browser_type', text: SLOP })).denied).toBe(true)
})

test('Bash writes to social paths are checked', async ($, on) => {
  stub(on)
  await prime($)
  expect((await run($, { tool: 'Bash', command: `echo "${SLOP}" > social-media-posts/X/a.txt` })).denied).toBe(true)
  expect((await run($, { tool: 'Bash', command: 'ls social-media-posts' })).denied).toBe(false)
  expect((await run($, { tool: 'Bash', command: `cd social-media-posts && echo "${SLOP}" > a.txt` })).denied).toBe(true)
  expect((await run($, { tool: 'Bash', command: `python3 - <<'EOF'\nopen('social-media-posts/X/a.txt', 'w').write("${SLOP}")\nEOF` })).denied).toBe(true)
  expect((await run($, { tool: 'Bash', command: `echo 'x' > social-media-posts/X/a.txt && echo '${SLOP}'` })).denied).toBe(true)
  expect((await run($, { tool: 'Bash', command: 'echo "add robust LinkedIn login" >> CHANGELOG.md'})).denied).toBe(false)
  expect((await run($, { tool: 'Bash', command: "cat > notes/pr.md <<'EOF'\nIt checks LinkedIn posts and it is robust.\nEOF" })).denied).toBe(false)
  expect((await run($, { tool: 'Bash', command: 'mkdir -p social-media-posts/X' })).denied).toBe(false)
})

test('self protection', async ($, on) => {
  stub(on)
  await prime($)
  const off = await run($, { tool: 'Bash', command: 'claude plugin disable slopless@slopless' })
  expect(off.denied).toBe(true)
  expect(off.text.includes('cannot be turned off')).toBe(true)
  const root = String((import.meta as { dir?: string; dirname?: string }).dirname ?? (import.meta as { dir?: string }).dir ?? '').replace(/\/hooks$/, '')
  expect(root.length > 0).toBe(true)
  expect((await run($, { tool: 'Write', file_path: `${root}/rules.md`, content: 'x' })).denied).toBe(true)
  expect((await run($, { tool: 'Write', file_path: '/home/u/.claude/settings.json', content: '{"slopless@slopless": false}' })).denied).toBe(true)
  expect((await run($, { tool: 'Write', file_path: '/home/u/.claude/settings.json', content: '{"a": false}' })).denied).toBe(false)
})

test('lol rolling limit', async ($, on) => {
  stub(on)
  await prime($)
  const type = (text: string) => run($, { tool: `${CHROME}computer`, action: 'type', text })
  expect((await type('lol ok sure thing')).denied).toBe(false)
  const second = await type('lol that one was good')
  expect(second.denied).toBe(true)
  expect(second.text.includes('lol')).toBe(true)
  expect((await type('no laughing in this one')).denied).toBe(false)
})

test('prompt.submit attaches the rules for social prompts only', async ($, on) => {
  let ctx = undefined as readonly string[] | undefined
  on('fs.read', () => ({ value: '# slopless writing rules\nsome line' }) as never)
  on('prompt.submit', (_$, e) => {
    ctx = e.context
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'write a tweet about my app' } as never)
  expect((ctx ?? []).join('\n').includes('slopless writing rules')).toBe(true)
  ctx = undefined
  await $.prompt.submit({ text: 'fix the login bug' } as never)
  expect(String(ctx ?? '')).toBe('')
})

test('X reply prompt attaches rules, then a clean social write passes at once', async ($, on) => {
  stub(on)
  let ctx = undefined as readonly string[] | undefined
  on('prompt.submit', (_$, e) => {
    ctx = e.context
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'Someone on X posted: hi. Write my reply' } as never)
  expect((ctx ?? []).join('\n').includes('slopless writing rules')).toBe(true)
  const r = await run($, { tool: 'Write', file_path: '/x/social-media-posts/X/03.txt', content: 'do you already have a following there?' })
  expect(r.denied).toBe(false)
})

test('prompt.compose appends the notice', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const res = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  const s = res.sections.find((x) => x.id === 'slopless:notice')
  expect(s !== undefined).toBe(true)
  expect(s?.scope).toBe('session')
  expect((s?.text.length ?? 999) < 500).toBe(true)
  expect((s?.text ?? '/').includes('/')).toBe(false)
})
