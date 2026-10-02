import { test, expect, mock } from 'claude-code/testing'
import {
  commandText,
  compact,
  fmt,
  lastDayKeys,
  measure,
  mergeGap,
  splitAtWorkday,
  statusText,
  sum,
  weekStartKey,
  youIntervals,
  dayKey,
  parseScan,
  transcriptSpans,
  backfillDays,
  transcriptId,
  changedTranscripts,
  type DayFile,
  type Interval,
} from './time'

const MIN = 60_000
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()
const claude = (s: number, e: number): Interval => ({ s, e, k: 'claude' })
const you = (s: number, e: number): Interval => ({ s, e, k: 'you' })
const file = (day: string, repo: string, intervals: Interval[]): DayFile => ({ day, repo, intervals })

test('edits 30 s apart for 5 minutes are one 5 minute interval', () => {
  const edits = Array.from({ length: 11 }, (_, i) => i * 30_000)
  const out = youIntervals(edits)
  expect(out).toEqual([{ s: 0, e: 5 * MIN }])
  expect(sum(out)).toBe(5 * MIN)
})

test('a 3 minute pause splits the interval and the pause does not count', () => {
  const edits = [0, 30_000, 60_000, 60_000 + 3 * MIN, 60_000 + 3 * MIN + 30_000]
  const out = youIntervals(edits)
  expect(out).toEqual([
    { s: 0, e: 60_000 },
    { s: 60_000 + 3 * MIN, e: 60_000 + 3 * MIN + 30_000 },
  ])
  expect(sum(out)).toBe(90_000)
})

test('a gap of exactly 120 s still joins', () => {
  expect(youIntervals([0, 120_000])).toEqual([{ s: 0, e: 120_000 }])
  expect(youIntervals([0, 120_001])).toHaveLength(2)
})

test('submit closes the interval at submit time', () => {
  expect(youIntervals([0, 30_000], 50_000)).toEqual([{ s: 0, e: 50_000 }])
  // submit long after the last edit does not count the wait
  expect(youIntervals([0, 30_000], 30_000 + 10 * MIN)).toEqual([{ s: 0, e: 30_000 }])
})

test('claude gaps of 30 s or less merge, longer do not', () => {
  const out = mergeGap([claude(0, 10_000), claude(40_000, 50_000), claude(100_000, 110_000)], 30_000)
  expect(out).toEqual([
    { s: 0, e: 50_000 },
    { s: 100_000, e: 110_000 },
  ])
})

test('a turn with a tool call inside counts the turn once', () => {
  const t = [claude(0, 4 * MIN), claude(MIN, 2 * MIN), claude(10_000, 3 * MIN)]
  expect(measure([file('2026-10-02', '/r', t)]).total).toBe(4 * MIN)
})

test('two sessions with overlapping turns count the overlap once', () => {
  const a = file('2026-10-02', '/r/a', [claude(0, 10 * MIN)])
  const b = file('2026-10-02', '/r/b', [claude(5 * MIN, 15 * MIN)])
  const t = measure([a, b])
  expect(t.total).toBe(15 * MIN)
  expect(t.claude).toBe(15 * MIN)
  expect(t.you).toBe(0)
})

test('you and claude overlapping count once in the total, each alone in its own', () => {
  const t = measure([file('2026-10-02', '/r', [you(0, 6 * MIN), claude(4 * MIN, 10 * MIN)])])
  expect(t).toEqual({ total: 10 * MIN, you: 6 * MIN, claude: 6 * MIN })
})

test('an interval across 05:00 splits into two work days, midnight does not split', () => {
  const s = at(2026, 10, 2, 4, 50)
  const e = at(2026, 10, 2, 5, 20)
  const parts = splitAtWorkday(claude(s, e))
  expect(parts).toEqual([claude(s, at(2026, 10, 2, 5)), claude(at(2026, 10, 2, 5), e)])
  expect(sum(parts)).toBe(30 * MIN)
  const night = splitAtWorkday(claude(at(2026, 10, 1, 23, 50), at(2026, 10, 2, 0, 20)))
  expect(night).toHaveLength(1)
  expect(splitAtWorkday(claude(5, 5))).toEqual([])
})

test('an idle hour adds nothing', () => {
  expect(measure([file('2026-10-02', '/r', [])]).total).toBe(0)
  // no intervals between a turn that ended and one that starts an hour later
  const t = measure([file('2026-10-02', '/r', [claude(0, MIN), claude(61 * MIN, 62 * MIN)])])
  expect(t.total).toBe(2 * MIN)
})

test('week starts on Monday, local time', () => {
  expect(weekStartKey(at(2026, 10, 2, 12))).toBe('2026-09-28') // Friday
  expect(weekStartKey(at(2026, 9, 28, 5, 0))).toBe('2026-09-28') // Monday 05:00
  expect(weekStartKey(at(2026, 9, 28, 4, 59))).toBe('2026-09-21') // Monday 04:59 is still last week
  expect(weekStartKey(at(2026, 10, 5, 4, 59))).toBe('2026-09-28') // Monday 04:59 after Sunday
  expect(weekStartKey(at(2026, 10, 4, 23, 59))).toBe('2026-09-28') // Sunday
  expect(lastDayKeys(at(2026, 10, 2, 12), 3)).toEqual(['2026-10-02', '2026-10-01', '2026-09-30'])
})

test('duration format', () => {
  expect(fmt(0)).toBe('0m')
  expect(fmt(45 * MIN)).toBe('45m')
  expect(fmt(134 * MIN)).toBe('2h14m')
  expect(fmt(11 * 60 * MIN + 5 * MIN)).toBe('11h05m')
  expect(fmt(59_999)).toBe('0m')
})

test('compact keeps the union and the kinds', () => {
  const out = compact([claude(0, 10_000), claude(20_000, 30_000), you(0, 5_000), you(5_000, 9_000)])
  expect(out).toEqual([you(0, 9_000), claude(0, 30_000)])
})

const NOW = at(2026, 10, 2, 15)
const sample: DayFile[] = [
  file('2026-10-02', '/home/u/alpha', [you(at(2026, 10, 2, 10), at(2026, 10, 2, 10, 40)), claude(at(2026, 10, 2, 10, 10), at(2026, 10, 2, 12))]),
  file('2026-10-01', '/home/u/beta', [claude(at(2026, 10, 1, 9), at(2026, 10, 1, 10))]),
  file('2026-09-15', '/home/u/alpha', [claude(at(2026, 9, 15, 9), at(2026, 9, 15, 11))]),
]

test('status text has today and week', () => {
  expect(statusText(sample, NOW)).toBe('CC today 2h00m · week 3h00m')
})

test('command text has today, week, month and per repo lines', () => {
  const text = commandText(sample, NOW)
  expect(text).toContain('today')
  expect(text).toContain('week')
  expect(text).toContain('month')
  expect(text).toMatch(/today\s+2h00m\s+you 40m, claude 1h50m/)
  expect(text).toMatch(/week\s+3h00m/)
  expect(text).toContain('2026-10-02 Fri  2h00m')
  expect(text).toContain('2026-10-01 Thu  1h00m')
  expect(text).toContain('alpha  2h00m')
  expect(text).toContain('beta  1h00m')
  expect(text).not.toContain('2026-09-15')
})

// Engine level: the hooks fill a fake file store and /claude-time reads it back.
function world(on: any, files: Record<string, string> = {}, ownRun = false) {
  const w = { files: new Map(Object.entries(files)), statuses: [] as string[] }
  on('fs.write', (_$: any, e: any) => {
    w.files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('fs.list', () => ({
    value: [...w.files.keys()].map(p => ({ name: p.split('/').pop(), kind: 'file', size: 0, mtimeMs: 0, isLink: false })),
  }) as never)
  on('fs.read', (_$: any, e: any) => ({ value: w.files.get(e.path) ?? '' }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('session.id', () => ({ value: 'sess1' }) as never)
  on('session.cwd', () => ({ value: '/home/u/alpha/src' }) as never)
  if (!ownRun) on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/u/alpha\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('session.start', () => ({ cwd: '/home/u/alpha' }) as never)
  on('session.end', () => ({ sessionId: 'sess1' }) as never)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: 'x' }) as never)
  on('prompt.edit', (_$: any, e: any) => ({ text: e.text, cursor: e.cursor }) as never)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', (_$: any, e: any) => {
    w.statuses.push(e.text)
    return { value: undefined } as never
  })
  return w
}

test('a tool call inside a turn ends up in the day file', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  on('tool.call', async () => {
    await clock.advance(2 * MIN)
    return { result: { stdout: 'ok' }, text: 'ok' } as never
  })
  await $.session.start({ cwd: '/home/u/alpha/src', surface: null, isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(MIN)
  await $.tool.call({ tool: 'Bash', command: 'sleep 1' } as never)
  await clock.advance(MIN)
  await $.turn.complete({ answer: 'x', durationMs: 4 * MIN, isAborted: false, turnId: 't1', reason: 'answer' })
  const path = '/home/u/.claude/active-time/2026-10-02_sess1.json'
  const body = JSON.parse(w.files.get(path) as string)
  expect(body.repo).toBe('/home/u/alpha')
  expect(measure([file('2026-10-02', body.repo, body.intervals)]).total).toBe(2 * MIN)
  expect(w.statuses[w.statuses.length - 1]).toBe('CC today 2m · week 2m')
})

test('a tool call over 10 minutes counts 10', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  on('tool.call', async () => {
    await clock.advance(15 * MIN)
    return { result: { stdout: 'ok' }, text: 'ok' } as never
  })
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'sleep 900' } as never)
  await $.session.end({ reason: 'other', sessionId: 'sess1', resume: { id: 'sess1' } } as never)
  const body = JSON.parse(w.files.get('/home/u/.claude/active-time/2026-10-02_sess1.json') as string)
  expect(measure([file('2026-10-02', body.repo, body.intervals)]).total).toBe(10 * MIN)
})

test('an idle hour with no events writes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  await clock.advance(60 * MIN)
  expect(w.files.size).toBe(0)
})

test('/claude-time answers from the files', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on, {
    '/home/u/.claude/active-time/2026-10-02_other.json': JSON.stringify({
      repo: '/home/u/alpha',
      intervals: [claude(at(2026, 10, 2, 10), at(2026, 10, 2, 11))],
    }),
    '/home/u/.claude/active-time/2026-10-01_other.json': JSON.stringify({
      repo: '/home/u/beta',
      intervals: [claude(at(2026, 10, 1, 9), at(2026, 10, 1, 10, 30))],
    }),
  })
  const out = await $.command.run({ command: 'claude-time', args: '' } as never)
  expect(out.text).toContain('today')
  expect(out.text).toContain('week')
  expect(out.text).toContain('month')
  expect(out.text).toContain('alpha  1h00m')
  expect(out.text).toContain('beta  1h30m')
  expect(w.files.size).toBe(2)
})

test('prompt edits 30 s apart for 5 minutes then submit make one you interval closed at submit', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  for (let i = 0; i <= 10; i++) {
    await ($ as any).prompt.edit({ origin: 'user', text: '', cursor: 0, start: 0, end: 0, inputText: 'a' } as never)
    await clock.advance(30_000)
  }
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as never)
  await $.session.end({ reason: 'other', sessionId: 'sess1', resume: { id: 'sess1' } } as never)
  const body = JSON.parse(w.files.get('/home/u/.claude/active-time/2026-10-02_sess1.json') as string)
  expect(body.intervals).toEqual([{ s: at(2026, 10, 2, 10), e: at(2026, 10, 2, 10, 5) + 30_000, k: 'you' }])
})

test('a turn waiting 3 hours on a question counts only its steps and the capped tool call', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  on('turn.step', async function* (_$: any, e: any) {
    await clock.advance(5_000)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('tool.call', async () => {
    await clock.advance(3 * 60 * MIN)
    return { result: 'answered', text: 'answered' } as never
  })
  const step = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1 } as never)) void _
  }
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  await $.turn.start({ text: 'ask', turnId: 't1' })
  await step(0)
  await $.tool.call({ tool: 'AskUserQuestion' } as never)
  await step(1)
  await $.turn.complete({ answer: '', durationMs: 3 * 60 * MIN, isAborted: false, turnId: 't1', reason: 'answer' })
  const body = JSON.parse(w.files.get('/home/u/.claude/active-time/2026-10-02_sess1.json') as string)
  expect(measure([file('2026-10-02', body.repo, body.intervals)]).total).toBe(10 * MIN + 10_000)
})

test('the status ticker survives /clear', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  const before = w.statuses.length
  await $.session.end({ reason: 'clear', sessionId: 'sess1', resume: { id: 'sess1' } } as never)
  await clock.advance(61_000)
  expect(w.statuses.length).toBeGreaterThan(before)
})

test('/claude-time loads far enough back for the 7 day list', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, {
    '/home/u/.claude/active-time/2026-09-26_other.json': JSON.stringify({
      repo: '/home/u/alpha',
      intervals: [claude(at(2026, 9, 26, 9), at(2026, 9, 26, 10))],
    }),
  })
  const out = await $.command.run({ command: 'claude-time', args: '' } as never)
  expect(out.text).toContain('2026-09-26 Sat  1h00m')
})

test('a headless session records nothing, writes no file and sets no status', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 10) })
  const w = world(on)
  on('tool.call', async () => {
    await clock.advance(MIN)
    return { result: 'ok', text: 'ok' } as never
  })
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: false })
  await $.tool.call({ tool: 'Bash', command: 'sleep 60' } as never)
  await $.turn.complete({ answer: '', durationMs: MIN, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.end({ reason: 'other', sessionId: 'sess1', resume: { id: 'sess1' } } as never)
  expect(w.files.size).toBe(0)
  expect(w.statuses).toEqual([])
})

test('work day keys: 04:59 belongs to the day before, 05:00 starts the day', () => {
  expect(dayKey(at(2026, 10, 2, 4, 59))).toBe('2026-10-01')
  expect(dayKey(at(2026, 10, 2, 5, 0))).toBe('2026-10-02')
  expect(dayKey(at(2026, 10, 2, 0, 30))).toBe('2026-10-01')
  expect(lastDayKeys(at(2026, 10, 2, 2), 2)).toEqual(['2026-10-01', '2026-09-30'])
})

test('work at 01:00 counts for the previous work day in the status', () => {
  const f = file('2026-10-01', '/r', [claude(at(2026, 10, 2, 0, 50), at(2026, 10, 2, 1, 10))])
  expect(statusText([f], at(2026, 10, 2, 1, 30))).toBe('CC today 20m · week 20m')
})

test('transcript rule: prompt boundary not counted, 11 minute gap cut, 10 minute gap counted', () => {
  const ev = [
    { t: 0, prompt: true },
    { t: 5_000, prompt: false },
    { t: 5_000 + 10 * MIN, prompt: false },
    { t: 5_000 + 10 * MIN + 11 * MIN, prompt: false },
    { t: 5_000 + 10 * MIN + 11 * MIN + 2_000, prompt: false },
    { t: 40 * MIN, prompt: true },
    { t: 40 * MIN + 3_000, prompt: false },
  ]
  expect(transcriptSpans(ev)).toEqual([
    { s: 0, e: 5_000 + 10 * MIN },
    { s: 21 * MIN + 5_000, e: 21 * MIN + 7_000 },
    { s: 40 * MIN, e: 40 * MIN + 3_000 },
  ])
})

test('transcript rule: spans 30 s apart merge across a prompt', () => {
  const ev = [
    { t: 0, prompt: false },
    { t: 10_000, prompt: false },
    { t: 30_000, prompt: true },
    { t: 40_000, prompt: false },
  ]
  expect(transcriptSpans(ev)).toEqual([{ s: 0, e: 40_000 }])
})

test('parseScan reads cwd and events, and HEADLESS wins', () => {
  expect(parseScan('C /home/u/a\n100 P\n200 E\n')).toEqual({
    headless: false,
    cwd: '/home/u/a',
    events: [{ t: 100, prompt: true }, { t: 200, prompt: false }],
  })
  expect(parseScan('HEADLESS\n').headless).toBe(true)
})

test('backfill days split at 05:00 and ids follow the file name', () => {
  const ev = [at(2026, 10, 2, 4, 55), at(2026, 10, 2, 5, 5)].map(t => ({ t, prompt: false }))
  const days = backfillDays(ev)
  expect([...days.keys()].sort()).toEqual(['2026-10-01', '2026-10-02'])
  expect(transcriptId('/h/.claude/projects/-p/abc.jsonl')).toBe('abc')
  expect(transcriptId('/h/.claude/projects/-p/abc/subagents/agent-1.jsonl')).toBe('abc-agent-1')
})

test('only changed transcripts are processed again', () => {
  const all = [{ path: '/a', mtimeMs: 10 }, { path: '/b', mtimeMs: 20 }, { path: '/c', mtimeMs: 5 }]
  expect(changedTranscripts(all, { '/a': 10, '/b': 15 })).toEqual([{ path: '/b', mtimeMs: 20 }, { path: '/c', mtimeMs: 5 }])
})

// Engine level: python and find output are mocked.
function bfWorld(on: any, scans: Record<string, string>, files: Record<string, string> = {}) {
  const w = world(on, files, true)
  const runs: string[] = []
  let mtime = 1_000
  const list = Object.keys(scans)
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'find') {
      const out = list.map(p => `${mtime / 1000}\t${p}`).join('\n')
      return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    }
    if (argv[0] === '/usr/bin/python3') {
      runs.push(argv[3] as string)
      return { value: { exitCode: 0, stdout: scans[argv[3] as string], stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    }
    return { value: { exitCode: 0, stdout: '/home/u/alpha\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  return { w, runs, touch: (m: number) => { mtime = m } }
}

test('backfill writes .bf.json, skips headless, reads back, and does not double count live data', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 15) })
  const root = '/home/u/.claude/projects/-p'
  const a = at(2026, 10, 2, 10)
  const scan = `C /home/u/alpha\n${a} P\n${a + 60_000} E\n${a + 120_000} E\n`
  const { w } = bfWorld(on, { [`${root}/sess9.jsonl`]: scan, [`${root}/hl.jsonl`]: 'HEADLESS\n' }, {
    '/home/u/.claude/active-time/2026-10-02_sess9.json': JSON.stringify({
      repo: '/home/u/alpha',
      intervals: [claude(a + 30_000, a + 4 * MIN)],
    }),
  })
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  await clock.advance(1_000)
  const bf = JSON.parse(w.files.get('/home/u/.claude/active-time/2026-10-02_sess9.bf.json') as string)
  expect(bf.source).toBe('transcript')
  expect(bf.repo).toBe('/home/u/alpha')
  expect([...w.files.keys()].some(k => k.includes('hl.bf.json'))).toBe(false)
  const out = await $.command.run({ command: 'claude-time', args: '' } as never)
  // live 0:30-4:00 and backfill 0:00-2:00 overlap, union is 4 minutes
  expect(out.text).toMatch(/today\s+4m/)
})

test('the second backfill pass skips unchanged transcripts', async ($, on) => {
  const clock = mock.clock(on, { now: at(2026, 10, 2, 15) })
  const a = at(2026, 10, 2, 10)
  const p = '/home/u/.claude/projects/-p/s1.jsonl'
  const { runs, touch } = bfWorld(on, { [p]: `C /r\n${a} P\n${a + 1000} E\n` })
  let stored: unknown
  on('store.get', () => ({ value: stored }) as never)
  on('store.set', (_$: any, e: any) => {
    stored = e.value
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/home/u/alpha', surface: null, isInteractive: true })
  await clock.advance(1_000)
  expect(runs).toEqual([p])
  await clock.advance(10 * MIN + 1_000)
  expect(runs).toEqual([p])
  touch(5_000)
  await clock.advance(10 * MIN)
  expect(runs).toEqual([p, p])
})
