export type Kind = 'you' | 'claude'
export type Span = { s: number; e: number }
export type Interval = Span & { k: Kind }
export type DayFile = { day: string; repo: string; intervals: Interval[] }
export type Totals = { total: number; you: number; claude: number }

export const YOU_GAP = 120_000
export const CLAUDE_GAP = 30_000
export const TOOL_CAP = 600_000

const pad2 = (n: number): string => String(n).padStart(2, '0')

// Sorts by start and joins spans whose gap is at most `gap` ms.
export function mergeGap(list: readonly Span[], gap: number): Span[] {
  const sorted = [...list].sort((a, b) => a.s - b.s)
  const out: Span[] = []
  for (const x of sorted) {
    const last = out[out.length - 1]
    if (last && x.s - last.e <= gap) last.e = Math.max(last.e, x.e)
    else out.push({ s: x.s, e: x.e })
  }
  return out
}

export const union = (...lists: Span[][]): Span[] => mergeGap(lists.flat(), 0)

export const sum = (list: readonly Span[]): number => list.reduce((n, x) => n + Math.max(0, x.e - x.s), 0)

const WORKDAY_SHIFT = 5 * 3_600_000

// The work day runs from 05:00 to 05:00 local. A day key is the calendar date of (ms - 5 h).
const keyOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const dayKey = (ms: number): string => keyOf(new Date(ms - WORKDAY_SHIFT))

// 05:00 local after the work day that holds `ms`.
export function startOfNextDay(ms: number): number {
  const d = new Date(ms - WORKDAY_SHIFT)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 5).getTime()
}

// Cuts an interval at every 05:00 it crosses.
export function splitAtWorkday(iv: Interval): Interval[] {
  const out: Interval[] = []
  let s = iv.s
  while (iv.e > s) {
    const next = startOfNextDay(s)
    if (iv.e <= next) {
      out.push({ s, e: iv.e, k: iv.k })
      break
    }
    out.push({ s, e: next, k: iv.k })
    s = next
  }
  return out
}

function dateOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

// Monday of the week (work day), local time.
export function weekStartKey(ms: number): string {
  const d = dateOf(dayKey(ms))
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
}

export const monthStartKey = (ms: number): string => `${dayKey(ms).slice(0, 8)}01`

// Work day keys of the last n days, today first.
export function lastDayKeys(ms: number, n: number): string[] {
  const d = dateOf(dayKey(ms))
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i)))
  return out
}

// One session's closed intervals, joined per kind so the file stays small.
export function compact(list: readonly Interval[]): Interval[] {
  const you = mergeGap(list.filter(x => x.k === 'you'), 0).map(x => ({ ...x, k: 'you' as const }))
  const claude = mergeGap(list.filter(x => x.k === 'claude'), CLAUDE_GAP).map(x => ({ ...x, k: 'claude' as const }))
  return [...you, ...claude]
}

// Folds one prompt edit into the open `you` interval. A gap over YOU_GAP closes it.
export function editStep(cur: Span | undefined, t: number): { cur: Span; closed?: Span } {
  if (cur && t - cur.e <= YOU_GAP) return { cur: { s: cur.s, e: Math.max(cur.e, t) } }
  return cur ? { cur: { s: t, e: t }, closed: cur } : { cur: { s: t, e: t } }
}

// A submit ends the open interval at the submit time, if the last edit was recent.
export function submitStep(cur: Span | undefined, t: number): Span | undefined {
  if (!cur) return undefined
  return t - cur.e <= YOU_GAP ? { s: cur.s, e: Math.max(cur.e, t) } : cur
}

// The `you` intervals a list of edit times makes, with an optional submit time.
export function youIntervals(edits: readonly number[], submitAt?: number): Span[] {
  const out: Span[] = []
  let cur: Span | undefined
  for (const t of edits) {
    const step = editStep(cur, t)
    if (step.closed) out.push(step.closed)
    cur = step.cur
  }
  if (cur) {
    const end = submitAt === undefined ? cur : submitStep(cur, submitAt)
    if (end) out.push(end)
  }
  return out
}

// A tool call counts at most TOOL_CAP.
export const capTool = (s: number, e: number): number => Math.min(e, s + TOOL_CAP)

export function measure(files: readonly DayFile[]): Totals {
  const all = files.flatMap(f => f.intervals)
  const you = mergeGap(all.filter(x => x.k === 'you'), 0)
  const claude = mergeGap(all.filter(x => x.k === 'claude'), CLAUDE_GAP)
  return { total: sum(mergeGap([...you, ...claude], 0)), you: sum(you), claude: sum(claude) }
}

export const inRange = (files: readonly DayFile[], from: string, to = '9999-99-99'): DayFile[] =>
  files.filter(f => f.day >= from && f.day <= to)

export function fmt(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h${pad2(m % 60)}m` : `${m}m`
}

const repoName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

// Union time per repo, biggest first. Repos sharing a folder name join.
export function perRepo(files: readonly DayFile[], top: number): { repo: string; ms: number }[] {
  const byName = new Map<string, DayFile[]>()
  for (const f of files) {
    const name = repoName(f.repo)
    byName.set(name, [...(byName.get(name) ?? []), f])
  }
  return [...byName.entries()]
    .map(([repo, fs]) => ({ repo, ms: measure(fs).total }))
    .filter(r => r.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, top)
}

export function statusText(files: readonly DayFile[], now: number): string {
  const today = measure(inRange(files, dayKey(now), dayKey(now))).total
  const week = measure(inRange(files, weekStartKey(now))).total
  return `CC today ${fmt(today)} · week ${fmt(week)}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function commandText(files: readonly DayFile[], now: number): string {
  const row = (label: string, t: Totals): string =>
    `${label.padEnd(6)} ${fmt(t.total).padStart(7)}   you ${fmt(t.you)}, claude ${fmt(t.claude)}`
  const today = dayKey(now)
  const week = weekStartKey(now)
  const lines = [
    'Claude Code time',
    row('today', measure(inRange(files, today, today))),
    row('week', measure(inRange(files, week))),
    row('month', measure(inRange(files, monthStartKey(now)))),
    '',
    'Last 7 days',
  ]
  for (const day of lastDayKeys(now, 7)) {
    lines.push(`${day} ${DAYS[dateOf(day).getDay()]}  ${fmt(measure(inRange(files, day, day)).total)}`)
  }
  lines.push('', 'This week by repo')
  const repos = perRepo(inRange(files, week), 5)
  if (repos.length === 0) lines.push('(nothing yet)')
  for (const r of repos) lines.push(`${r.repo}  ${fmt(r.ms)}`)
  return lines.join('\n')
}

// Backfill from session transcripts. A python step prints `HEADLESS`, or `C <cwd>`
// and one `<epoch_ms> <P|E>` line per entry (P a real user prompt, E anything else).
export const PY_SCAN = `
import sys, json
from datetime import datetime
cwd = ''
out = []
for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
    if '"sdk-cli"' in line:
        try:
            if json.loads(line).get('entrypoint') == 'sdk-cli':
                print('HEADLESS')
                sys.exit(0)
        except Exception:
            pass
    if '"timestamp"' not in line:
        continue
    try:
        d = json.loads(line)
        ts = d.get('timestamp')
        if not isinstance(ts, str):
            continue
        ms = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        continue
    if not cwd and isinstance(d.get('cwd'), str):
        cwd = d['cwd']
    p = False
    if d.get('type') == 'user' and not d.get('isMeta'):
        c = (d.get('message') or {}).get('content')
        if isinstance(c, str):
            p = True
        elif isinstance(c, list):
            p = not any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c)
    out.append('%d %s' % (ms, 'P' if p else 'E'))
print('C ' + cwd)
print('\\n'.join(out))
`

export type BfEvent = { t: number; prompt: boolean }
export type BfScan = { headless: boolean; cwd: string; events: BfEvent[] }

export function parseScan(stdout: string): BfScan {
  const scan: BfScan = { headless: false, cwd: '', events: [] }
  for (const line of stdout.split('\n')) {
    if (line === 'HEADLESS') return { headless: true, cwd: '', events: [] }
    if (line.startsWith('C ')) {
      scan.cwd = line.slice(2).trim()
      continue
    }
    const m = /^(\d+) ([PE])$/.exec(line)
    if (m) scan.events.push({ t: Number(m[1]), prompt: m[2] === 'P' })
  }
  return scan
}

// Claude working time from entry timestamps: a step into a non-prompt entry no longer than
// TOOL_CAP counts. A prompt starts a wait, a longer gap is a wait.
export function transcriptSpans(events: readonly BfEvent[]): Span[] {
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const out: Span[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as BfEvent
    const b = sorted[i] as BfEvent
    if (!b.prompt && b.t - a.t <= TOOL_CAP && b.t > a.t) out.push({ s: a.t, e: b.t })
  }
  return mergeGap(out, CLAUDE_GAP)
}

// The intervals of a transcript grouped by work day.
export function backfillDays(events: readonly BfEvent[]): Map<string, Interval[]> {
  const days = new Map<string, Interval[]>()
  for (const span of transcriptSpans(events)) {
    for (const piece of splitAtWorkday({ ...span, k: 'claude' })) {
      const day = dayKey(piece.s)
      days.set(day, [...(days.get(day) ?? []), piece])
    }
  }
  for (const [day, list] of days) days.set(day, compact(list))
  return days
}

// Session id of a transcript path: the file name, or `<parent session>-<agent file>` for a subagent.
export function transcriptId(path: string): string {
  const parts = path.split('/')
  const file = (parts.pop() ?? '').replace(/\.jsonl$/, '')
  return parts[parts.length - 1] === 'subagents' ? `${parts[parts.length - 2]}-${file}` : file
}

export type Transcript = { path: string; mtimeMs: number }

// Transcripts changed since the last pass.
export const changedTranscripts = (all: readonly Transcript[], seen: Readonly<Record<string, number>>): Transcript[] =>
  all.filter(x => x.mtimeMs > (seen[x.path] ?? 0))
