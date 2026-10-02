import { test, expect, mock } from 'claude-code/testing'
import {
  addCard,
  ageText,
  listText,
  nightKey,
  parseCard,
  projectDir,
  saveReply,
  tailFromJsonl,
} from './save'
import type { Card } from '../types'

const REPO = '/w/proj'
const MIN = 60_000
const HOUR = 3_600_000
const START = { cwd: REPO, surface: null, isInteractive: true } as never
const GOOD = 'Doing: wiring the save card\nNext: write the tests\nOpen: none'
const T0 = new Date(2026, 9, 2, 14, 5).getTime()

const card = (n: number, over: Partial<Card> = {}): Card => ({
  doing: `doing ${n}`,
  next: `next ${n}`,
  open: 'none',
  savedAt: T0 - n * HOUR,
  sessionId: `sess${n}000000`,
  repo: REPO,
  ...over,
})

// Pure functions.

test('parseCard: good reply, blank lines, bullets, bold', () => {
  expect(parseCard(GOOD)).toEqual({ doing: 'wiring the save card', next: 'write the tests', open: 'none' })
  expect(parseCard('\n\nDoing:   a  \n\n\nNext: b\n\nOpen: c d\n\n')).toEqual({ doing: 'a', next: 'b', open: 'c d' })
  expect(parseCard('- **Doing:** a\n- **Next:** b\n- **Open:** c')).toEqual({ doing: 'a', next: 'b', open: 'c' })
})

test('parseCard: missing Open is none, garbage is no card', () => {
  expect(parseCard('Doing: a\nNext: b')).toEqual({ doing: 'a', next: 'b', open: 'none' })
  expect(parseCard('Doing: a\nNext: b\nOpen:   ')).toEqual({ doing: 'a', next: 'b', open: 'none' })
  expect(parseCard('I cannot do that.')).toBeNull()
  expect(parseCard('Doing: only this')).toBeNull()
  expect(parseCard('')).toBeNull()
})

test('addCard keeps 5 per repo, newest first, per repo, one card per session', () => {
  let all: Record<string, Card[]> = {}
  for (let n = 7; n >= 0; n--) all = addCard(all, card(n))
  expect(all[REPO]!.map(c => c.doing)).toEqual(['doing 0', 'doing 1', 'doing 2', 'doing 3', 'doing 4'])
  all = addCard(all, card(9, { repo: '/other' }))
  expect(all['/other']).toHaveLength(1)
  expect(all[REPO]).toHaveLength(5)
  all = addCard(all, card(0, { doing: 'newer', savedAt: T0 + 1 }))
  expect(all[REPO]!.map(c => c.doing)).toEqual(['newer', 'doing 1', 'doing 2', 'doing 3', 'doing 4'])
})

test('age, night key, project dir', () => {
  expect(ageText(10_000)).toBe('just now')
  expect(ageText(5 * MIN)).toBe('5m ago')
  expect(ageText(3 * HOUR)).toBe('3h ago')
  expect(ageText(72 * HOUR)).toBe('3d ago')
  expect(nightKey(new Date(2026, 9, 3, 0, 59).getTime())).toBeNull()
  expect(nightKey(new Date(2026, 9, 3, 1, 0).getTime())).toBe('2026-10-3')
  expect(nightKey(new Date(2026, 9, 3, 6, 0).getTime())).toBeNull()
  expect(projectDir('/home/u/my.proj/x')).toBe('-home-u-my-proj-x')
})

const lines = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n')

test('tailFromJsonl keeps prompts and assistant text only', () => {
  const jsonl = lines([
    { type: 'user', message: { role: 'user', content: 'fix the login bug' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'SECRET THOUGHT' },
          { type: 'text', text: 'Looking at auth.ts' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } },
        ],
      },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'TOOL OUTPUT' }] } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'META NOISE' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'now the tests' }] } },
  ])
  const tail = tailFromJsonl(jsonl)
  expect(tail).toBe('User: fix the login bug\n\nAssistant: Looking at auth.ts\n\nUser: now the tests')
  expect(tail).not.toContain('SECRET THOUGHT')
  expect(tail).not.toContain('TOOL OUTPUT')
  expect(tail).not.toContain('META NOISE')
})

test('tailFromJsonl cuts to the last chars and skips a half line', () => {
  const rows = [1, 2, 3].map(n => ({ type: 'user', message: { content: `${String(n).repeat(100)}` } }))
  const tail = tailFromJsonl(`{"type":"user","mess\n${lines(rows)}`, 150)
  expect(tail).toHaveLength(150)
  expect(tail.endsWith('3'.repeat(100))).toBe(true)
})

// Wiring.

type World = {
  kv: Map<string, unknown>
  forks: string[]
  completes: Array<{ model: string; prompt: string }>
  toasts: string[]
  submitted: string[]
  files: Map<string, string>
}

function setup(
  on: any,
  opts: { forks?: Array<string | null>; completes?: string[]; completeGate?: Promise<void>; stored?: Record<string, unknown>; now?: number } = {},
) {
  const clock = mock.clock(on, { now: opts.now ?? T0 })
  const w: World = { kv: new Map(Object.entries(opts.stored ?? {})), forks: [], completes: [], toasts: [], submitted: [], files: new Map() }
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  let f = 0
  let c = 0
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.kv.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    w.kv.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/u' })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.id', () => ({ value: 'live1234567' }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }) as never)
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    w.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: w.files.has(e.path) }))
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (a[0] === 'git') return out(`${REPO}\n`)
    if (a[0] === 'tail') return w.files.has(a[3]!) ? out(w.files.get(a[3]!)!) : out('', 1)
    return out('', 127)
  })
  on('model.fork', (_$: unknown, e: { prompt: string }) => {
    w.forks.push(e.prompt)
    const r = (opts.forks ?? [GOOD])[f++] ?? GOOD
    return { value: r === null ? { isAnswered: false, reason: 'nothing-to-fork' } : { isAnswered: true, text: r, usage } }
  })
  on('model.complete', async (_$: unknown, e: { model: string; prompt: string }) => {
    w.completes.push({ model: e.model, prompt: e.prompt })
    if (opts.completeGate) await opts.completeGate
    return { value: { isAnswered: true, text: (opts.completes ?? [GOOD])[c++] ?? GOOD, usage } }
  })
  return { w, clock }
}

let n = 0
const turn = ($: any) => $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: `t${++n}`, reason: 'answer' })
const submit = ($: any, text = 'hi') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const cardsOf = (w: World) => (w.kv.get('cards') as Record<string, Card[]> | undefined)?.[REPO] ?? []

test('idle: a finished turn then 4 min makes one fork and stores the card', async ($, on) => {
  const { w, clock } = setup(on)
  await $.session.start(START)
  await turn($)
  await clock.advance(239_000)
  expect(w.forks).toHaveLength(0)
  await clock.advance(1_000)
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('exactly this 3 line format')
  expect(cardsOf(w)).toHaveLength(1)
  expect(cardsOf(w)[0]).toMatchObject({ doing: 'wiring the save card', next: 'write the tests', open: 'none', sessionId: 'live1234567', repo: REPO })
  await clock.advance(10 * MIN)
  expect(w.forks).toHaveLength(1)
})

test('idle: a prompt at 3 min cancels the timer', async ($, on) => {
  const { w, clock } = setup(on)
  await $.session.start(START)
  await turn($)
  await clock.advance(3 * MIN)
  await submit($)
  await clock.advance(5 * MIN)
  expect(w.forks).toHaveLength(0)
})

test('idle: a turn start cancels the timer', async ($, on) => {
  const { w, clock } = setup(on)
  await $.session.start(START)
  await turn($)
  await clock.advance(3 * MIN)
  await $.turn.start({ turnId: 'x' } as never)
  await clock.advance(5 * MIN)
  expect(w.forks).toHaveLength(0)
})

test('idle: no new turn since the last card, no fork', async ($, on) => {
  const { w, clock } = setup(on)
  await $.session.start(START)
  await turn($)
  await clock.advance(4 * MIN)
  expect(w.forks).toHaveLength(1)
  const r: any = await $.command.run({ command: 'save', args: '' } as any)
  expect(w.forks).toHaveLength(1)
  expect(r.text).toContain('Doing: wiring the save card')
})

test('a subagent turn does not count as a main turn', async ($, on) => {
  const { w, clock } = setup(on)
  await $.session.start(START)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'a', agentId: 'sub1', reason: 'answer' } as never)
  await clock.advance(5 * MIN)
  expect(w.forks).toHaveLength(0)
})

test('two triggers at once make one fork', async ($, on) => {
  const { w, clock } = setup(on)
  await $.session.start(START)
  await turn($)
  const a = $.command.run({ command: 'save', args: '' } as any)
  const b = $.command.run({ command: 'save', args: '' } as any)
  await Promise.all([a, b])
  await clock.advance(5 * MIN)
  expect(w.forks).toHaveLength(1)
  expect(cardsOf(w)).toHaveLength(1)
})

test('an unparseable fork reply keeps no card and toasts the reason', async ($, on) => {
  const { w, clock } = setup(on, { forks: ['Sorry, I cannot.'] })
  await $.session.start(START)
  await turn($)
  await clock.advance(4 * MIN)
  expect(cardsOf(w)).toHaveLength(0)
  expect(w.toasts).toEqual(['save-game: no card saved: the reply was not a 3 line card'])
})

test('01:00 makes a card for new turns, toasts once per night', async ($, on) => {
  const { w, clock } = setup(on, { now: new Date(2026, 9, 3, 0, 50).getTime() })
  await $.session.start(START)
  await turn($)
  await clock.advance(9 * MIN)
  await turn($)
  expect(w.forks).toHaveLength(1)
  await clock.advance(1 * MIN)
  expect(w.forks).toHaveLength(2)
  expect(w.toasts).toEqual(['save-game: saved. It is past 1am, a good point to stop.'])
  await clock.advance(20 * MIN)
  expect(w.toasts).toHaveLength(1)
})

test('01:00 toasts even with nothing new, but not for an idle session', async ($, on) => {
  const quiet = setup(on, { now: new Date(2026, 9, 3, 0, 40).getTime() })
  await $.session.start(START)
  await turn($)
  await quiet.clock.advance(4 * MIN)
  expect(quiet.w.forks).toHaveLength(1)
  await quiet.clock.advance(19 * MIN)
  expect(quiet.w.forks).toHaveLength(1)
  expect(quiet.w.toasts).toEqual(['save-game: saved. It is past 1am, a good point to stop.'])
})

test('01:00 stays silent when the session had no turn in the last 30 min', async ($, on) => {
  const { w, clock } = setup(on, { now: new Date(2026, 9, 3, 0, 0).getTime() })
  await $.session.start(START)
  await turn($)
  await clock.advance(2 * HOUR)
  expect(w.toasts).toEqual([])
})

const T_PATH = '/home/u/.claude/projects/-w-proj/live1234567.jsonl'
const JSONL = lines([
  { type: 'user', message: { role: 'user', content: 'fix the login bug' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'HIDDEN' }, { type: 'text', text: 'on it' }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'RESULT BODY' }] } },
])

test('session end with new turns queues pending, no model call; next start drains it with sonnet', async ($, on) => {
  let release = () => {}
  const completeGate = new Promise<void>(r => {
    release = r
  })
  const { w, clock } = setup(on, { completes: ['Doing: login bug\nNext: add test\nOpen: which provider?'], completeGate })
  w.files.set(T_PATH, JSONL)
  await $.session.start(START)
  await turn($)
  // Session ends before the idle timer: no card yet.
  await $.session.end({ reason: 'other', sessionId: 'live1234567', resume: { id: 'live1234567' } } as never)
  expect(w.forks, 'forks after end').toHaveLength(0)
  expect(w.completes, 'completes after end').toHaveLength(0)
  expect(w.kv.get('pending')).toEqual([{ repo: REPO, sessionId: 'live1234567', transcriptPath: T_PATH, endedAt: T0 }])
  await clock.advance(5 * MIN)
  expect(w.forks, 'forks after 5 min').toHaveLength(0)

  await clock.advance(2 * HOUR)
  // The model call is held shut: if the hook waited for it, start would never return.
  await $.session.start(START)
  expect(cardsOf(w), 'cards after start').toHaveLength(0)
  await clock.settle()
  expect(w.completes).toHaveLength(1)
  release()
  await clock.settle()
  expect(w.completes[0]!.model).toBe('sonnet')
  expect(w.completes[0]!.prompt).toContain('User: fix the login bug')
  expect(w.completes[0]!.prompt).toContain('Assistant: on it')
  expect(w.completes[0]!.prompt).not.toContain('HIDDEN')
  expect(w.completes[0]!.prompt).not.toContain('RESULT BODY')
  expect(w.completes[0]!.prompt).toContain('exactly this 3 line format')
  expect(w.kv.get('pending')).toEqual([])
  expect(cardsOf(w)[0]).toMatchObject({ doing: 'login bug', next: 'add test', open: 'which provider?', sessionId: 'live1234567', savedAt: T0 })
})

test('session end after a card exists queues nothing', async ($, on) => {
  const { w, clock } = setup(on)
  w.files.set(T_PATH, JSONL)
  await $.session.start(START)
  await turn($)
  await clock.advance(4 * MIN)
  await $.session.end({ reason: 'other', sessionId: 'live1234567', resume: { id: 'live1234567' } } as never)
  expect(w.kv.get('pending')).toBeUndefined()
})

test('session end with no transcript file queues nothing', async ($, on) => {
  const { w } = setup(on)
  await $.session.start(START)
  await turn($)
  await $.session.end({ reason: 'other', sessionId: 'live1234567', resume: { id: 'live1234567' } } as never)
  expect(w.kv.get('pending')).toBeUndefined()
})

test('a missing transcript file is skipped silently', async ($, on) => {
  const { w, clock } = setup(on, {
    stored: { pending: [{ repo: REPO, sessionId: 'gone', transcriptPath: '/nope.jsonl', endedAt: T0 }] },
  })
  await $.session.start(START)
  await clock.settle()
  expect(w.completes).toHaveLength(0)
  expect(w.toasts).toEqual([])
  expect(w.kv.get('pending')).toEqual([])
})

const mountBand = ($: any) =>
  $.ui.mount({
    plugin: 'save-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 },
  } as any)

test('band: shows the newest card of this repo; Continue submits it and hides the band', async ($, on) => {
  const mine = card(3)
  const { w, clock } = setup(on, {
    stored: { cards: { [REPO]: [mine, card(5)], '/other': [card(1, { repo: '/other', doing: 'other repo' })] } },
  })
  await $.session.start(START)
  await clock.settle()
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: 'Saved 3h ago (session sess300)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Doing: doing 3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other repo' })).toBeUndefined()
  await ui.press({ key: 'save-continue' })
  expect(w.submitted).toEqual(['Continue where I stopped. Save card:\nDoing: doing 3\nNext: next 3\nOpen: none'])
  expect(await ui.find({ type: 'Text', text: /Saved/ })).toBeUndefined()
})

test('band: wraps what another plugin drew, ours above', { plugins: [{
  name: 'other-band',
  tier: 'builtin' as const,
  register: (on: any) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
      await next(e)
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'OTHER-BAND')
    })
  },
}] }, async ($, on) => {
  setup(on, { stored: { cards: { [REPO]: [card(3)] } } })
  await $.session.start(START)
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /Saved 3h ago/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /OTHER-BAND/ })).toBeDefined()
  const [first] = await ui.findAll({ type: 'Text' })
  expect(first.text).toContain('Saved')
})

test('band: Dismiss hides it', async ($, on) => {
  setup(on, { stored: { cards: { [REPO]: [card(3)] } } })
  await $.session.start(START)
  const ui: any = await mountBand($)
  await ui.press({ key: 'save-dismiss' })
  expect(await ui.find({ type: 'Text', text: /Saved/ })).toBeUndefined()
})

test('band: the first prompt of the session hides it', async ($, on) => {
  setup(on, { stored: { cards: { [REPO]: [card(3)] } } })
  await $.session.start(START)
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /Saved/ })).toBeDefined()
  await submit($)
  expect(await ui.find({ type: 'Text', text: /Saved/ })).toBeUndefined()
})

test('band: a card older than 14 days is not shown', async ($, on) => {
  setup(on, { stored: { cards: { [REPO]: [card(15 * 24)] } } })
  await $.session.start(START)
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /Saved/ })).toBeUndefined()
})

test('band: a pending job that finishes at startup updates the band', async ($, on) => {
  const { w, clock } = setup(on, {
    stored: {
      cards: { [REPO]: [card(5)] },
      pending: [{ repo: REPO, sessionId: 'newer00000', transcriptPath: T_PATH, endedAt: T0 - 60_000 }],
    },
    completes: ['Doing: fresh work\nNext: ship\nOpen: none'],
  })
  w.files.set(T_PATH, JSONL)
  await $.session.start(START)
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: 'Doing: doing 5' })).toBeDefined()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Doing: fresh work' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Saved 1m ago (session newer00)' })).toBeDefined()
})

test('/save answers with the card and the resume line', async ($, on) => {
  const { w } = setup(on)
  await $.session.start(START)
  await turn($)
  const r: any = await $.command.run({ command: 'save', args: '' } as any)
  expect(r.text).toBe('Doing: wiring the save card\nNext: write the tests\nOpen: none\nfull context: claude --resume live1234567')
  expect(w.forks).toHaveLength(1)
})

test('/save with no turns and no card says so', async ($, on) => {
  const { w } = setup(on)
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'save', args: '' } as any)
  expect(r.text).toBe('save-game: no card saved: nothing to save yet')
  expect(w.forks).toHaveLength(0)
})

test('/save list shows the last cards of this repo with age and resume line', async ($, on) => {
  setup(on, { stored: { cards: { [REPO]: [card(1), card(2)], '/other': [card(0, { repo: '/other' })] } } })
  await $.session.start(START)
  const r: any = await $.command.run({ command: 'save', args: 'list' } as any)
  expect(r.text).toBe(
    [
      'Saved 1h ago (session sess100)',
      'Doing: doing 1',
      'Next: next 1',
      'Open: none',
      'full context: claude --resume sess1000000',
      '',
      'Saved 2h ago (session sess200)',
      'Doing: doing 2',
      'Next: next 2',
      'Open: none',
      'full context: claude --resume sess2000000',
    ].join('\n'),
  )
})

test('pure list and reply texts', () => {
  expect(listText([], T0)).toBe('save-game: no saved cards for this repo yet.')
  expect(saveReply(card(1))).toBe('Doing: doing 1\nNext: next 1\nOpen: none\nfull context: claude --resume sess1000000')
})

test('a non-interactive session does nothing: no timers, no pending, no model call', async ($, on) => {
  const { w, clock } = setup(on, {
    stored: { cards: { [REPO]: [card(3)] }, pending: [{ repo: REPO, sessionId: 'x', transcriptPath: T_PATH, endedAt: T0 }] },
  })
  w.files.set(T_PATH, JSONL)
  w.files.set('/home/u/.claude/projects/-w-proj/live1234567.jsonl', JSONL)
  await $.session.start({ cwd: REPO, surface: null, isInteractive: false } as never)
  await turn($)
  await clock.advance(10 * MIN)
  await $.session.end({ reason: 'other', sessionId: 'live1234567', resume: { id: 'live1234567' } } as never)
  expect(w.forks).toHaveLength(0)
  expect(w.completes).toHaveLength(0)
  expect(w.toasts).toEqual([])
  expect((w.kv.get('pending') as unknown[]).length).toBe(1)
  expect(cardsOf(w)).toHaveLength(1)
})
