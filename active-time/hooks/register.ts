import type { EngineInterface, Register } from 'claude-code'
import {
  PY_SCAN,
  backfillDays,
  capTool,
  changedTranscripts,
  commandText,
  compact,
  dayKey,
  editStep,
  lastDayKeys,
  monthStartKey,
  parseScan,
  splitAtWorkday,
  statusText,
  submitStep,
  transcriptId,
  weekStartKey,
  type DayFile,
  type Interval,
  type Kind,
  type Span,
  type Transcript,
} from './time'

const TICK = 60_000
const BACKFILL_EVERY = 600_000
const BACKFILL_DAYS = 40

// Closed intervals of this session by local day. Lost on a reload except what
// is already in the session's files, which session.start reads back.
let byDay = new Map<string, Interval[]>()
let dirty = new Set<string>()
let cur: Span | undefined
// False for headless runs (-p, SDK): those are not the person's time.
let active = false
let repo = ''
let dir = ''
let timer: { cancel: () => void } | undefined
let bfTimer: { cancel: () => void } | undefined
let bfRunning = false

async function now($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

function add(s: number, e: number, k: Kind): void {
  if (!active) return
  for (const piece of splitAtWorkday({ s, e, k })) {
    const day = dayKey(piece.s)
    byDay.set(day, [...(byDay.get(day) ?? []), piece])
    dirty.add(day)
  }
}

async function ensureDir($: EngineInterface): Promise<string> {
  if (!dir) {
    const home = await $.env.get('HOME')
    if (!home) throw new Error('no HOME')
    dir = `${home}/.claude/active-time`
  }
  return dir
}

async function ensureRepo($: EngineInterface): Promise<string> {
  if (repo) return repo
  const cwd = await $.session.cwd()
  repo = cwd
  try {
    const ran = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])
    const top = ran.stdout.trim()
    if (ran.exitCode === 0 && top) repo = top
  } catch {}
  return repo
}

// Closes the open `you` interval when the last edit is older than the gap.
function closeStaleYou(t: number): void {
  if (cur && editStep(cur, t).closed) {
    add(cur.s, cur.e, 'you')
    cur = undefined
  }
}

async function flush($: EngineInterface): Promise<void> {
  if (dirty.size === 0) return
  const id = await $.session.id()
  const where = await ensureDir($)
  const top = await ensureRepo($)
  for (const day of [...dirty]) {
    const intervals = compact(byDay.get(day) ?? [])
    byDay.set(day, intervals)
    await $.fs.write(`${where}/${day}_${id}.json`, JSON.stringify({ repo: top, intervals }))
    dirty.delete(day)
  }
}

async function loadFiles($: EngineInterface, fromDay: string): Promise<DayFile[]> {
  const where = await ensureDir($)
  let names: string[] = []
  try {
    names = (await $.fs.list(where)).map(x => x.name)
  } catch {}
  const files: DayFile[] = []
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})_.+\.(?:bf\.)?json$/.exec(name)
    if (!m || (m[1] as string) < fromDay) continue
    try {
      const body = JSON.parse(await $.fs.read(`${where}/${name}`) as string)
      files.push({ day: m[1] as string, repo: String(body.repo ?? ''), intervals: body.intervals ?? [] })
    } catch {}
  }
  return files
}

// Lists the transcripts of the last BACKFILL_DAYS days: sessions and their subagents.
async function listTranscripts($: EngineInterface): Promise<Transcript[]> {
  const home = await $.env.get('HOME')
  if (!home) return []
  const root = `${home}/.claude/projects`
  const ran = await $.process.run(
    ['find', root, '-type', 'f', '-name', '*.jsonl', '-mtime', `-${BACKFILL_DAYS}`, '-printf', '%T@\t%p\n'],
    { timeoutMs: 60_000 },
  )
  const out: Transcript[] = []
  for (const line of ran.stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const path = line.slice(tab + 1)
    const rel = path.slice(root.length + 1).split('/')
    if (rel.length === 2 || (rel.length === 4 && rel[2] === 'subagents')) {
      out.push({ path, mtimeMs: Math.floor(Number(line.slice(0, tab)) * 1000) })
    }
  }
  return out
}

// Rebuilds Claude time from transcripts into <day>_<id>.bf.json files. Live files stay untouched.
async function backfill($: EngineInterface): Promise<void> {
  if (!active || bfRunning) return
  bfRunning = true
  try {
    const where = await ensureDir($)
    const seen = ((await $.store.get('backfill')) ?? {}) as Record<string, number>
    for (const tr of changedTranscripts(await listTranscripts($), seen)) {
      if (!active) break
      try {
        const ran = await $.process.run(['/usr/bin/python3', '-c', PY_SCAN, tr.path], { timeoutMs: 120_000 })
        const scan = parseScan(ran.stdout)
        if (ran.exitCode === 0 && !scan.headless) {
          const id = transcriptId(tr.path)
          for (const [day, intervals] of backfillDays(scan.events)) {
            await $.fs.write(
              `${where}/${day}_${id}.bf.json`,
              JSON.stringify({ repo: scan.cwd, intervals, source: 'transcript' }),
            )
          }
        }
        if (ran.exitCode === 0) {
          seen[tr.path] = tr.mtimeMs
          await $.store.set('backfill', seen)
        }
      } catch {}
    }
    await refreshStatus($)
  } catch {
  } finally {
    bfRunning = false
  }
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const t = await now($)
  $.ui.status(statusText(await loadFiles($, weekStartKey(t)), t))
}

async function tick($: EngineInterface): Promise<void> {
  if (!active) return
  try {
    closeStaleYou(await now($))
    await flush($)
    await refreshStatus($)
  } catch {}
}

// Reads this session's own earlier files back so a reload does not drop them.
async function restore($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  const where = await ensureDir($)
  for (const x of await $.fs.list(where)) {
    const m = /^(\d{4}-\d{2}-\d{2})_(.+)\.json$/.exec(x.name)
    if (!m || m[2] !== id) continue
    try {
      const body = JSON.parse(await $.fs.read(`${where}/${x.name}`) as string)
      const day = m[1] as string
      byDay.set(day, [...(body.intervals ?? []), ...(byDay.get(day) ?? [])])
      if (body.repo && !repo) repo = body.repo
    } catch {}
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'claude-time', description: 'Active time with Claude Code: today, week, month' })
      active = e.isInteractive
      if (!active) return next(e)
      await ensureRepo($)
      await restore($)
      timer?.cancel()
      timer = $.clock.every(TICK, () => void tick($))
      await refreshStatus($)
      bfTimer?.cancel()
      $.clock.after(0, () => void backfill($))
      bfTimer = $.clock.every(BACKFILL_EVERY, () => void backfill($))
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'claude-time' }, async $ => {
    try {
      const t = await now($)
      closeStaleYou(t)
      await flush($)
      const from = [weekStartKey(t), monthStartKey(t), lastDayKeys(t, 7)[6] as string].sort()[0] as string
      return { text: commandText(await loadFiles($, from), t) }
    } catch {
      return { text: 'claude-time could not read its files.' }
    }
  })

  on('prompt.edit', ($, e, next) => {
    if (active) $.clock.now().then(t => {
      const step = editStep(cur, t)
      if (step.closed) add(step.closed.s, step.closed.e, 'you')
      cur = step.cur
    }, () => {})
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const closed = submitStep(cur, await now($))
      if (closed) add(closed.s, closed.e, 'you')
      cur = undefined
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await tick($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const s = await now($)
    try {
      return await next(e)
    } finally {
      add(s, capTool(s, await now($)), 'claude')
    }
  })

  on('turn.step', async function* ($, e, next) {
    const s = await now($)
    try {
      return yield* next(e)
    } finally {
      add(s, await now($), 'claude')
    }
  })

  on('session.end', async ($, e, next) => {
    try {
      if (cur) add(cur.s, cur.e, 'you')
      cur = undefined
      if (next.budget.remainingMs > 200) await flush($)
    } catch {}
    // /clear keeps the process, and session.start does not fire again.
    if (e.reason !== 'clear') {
      timer?.cancel()
      timer = undefined
      bfTimer?.cancel()
      bfTimer = undefined
    }
    byDay = new Map()
    dirty = new Set()
    return next(e)
  })
}
