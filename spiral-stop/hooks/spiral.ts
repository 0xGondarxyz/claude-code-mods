export const TRIGGER_AT = 3

export type Entry = { count: number; seq: number; cmd: string; triggered: boolean }

export type Tracker = {
  sigs: Map<string, Entry>
  /** Bumped by every fix attempt (an edit tool call or a new user prompt). */
  seq: number
  promptStreak: number
}

export const newTracker = (): Tracker => ({ sigs: new Map(), seq: 0, promptStreak: 0 })

const ERROR_LINE = /error|fail|exception|traceback|panic|assert|expected/i

const WRAPPER_LINE = /^(error:\s*)?exit code:?\s*\d*$/i

const STILL_BROKEN: RegExp[] = [
  /\b(still|again)\b[^.!?\n]{0,40}\b(broken|failing|fails|failed|errors?|not working|doesn'?t work|same)\b/i,
  /\b(broken|failing|fails|failed|errors?|not working|doesn'?t work)\b[^.!?\n]{0,30}\b(still|again)\b/i,
  /\bsame error\b/i,
  /\bdidn'?t fix\b/i,
  /\bnot fixed\b/i,
]

export const normalizeCommand = (cmd: string): string => cmd.trim().replace(/\s+/g, ' ')

export function normalizeLine(line: string): string {
  return line
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(\.\d+)?/g, '')
    .replace(/\b\d+(\.\d+)?\s?(ms|us|µs|ns|sec|secs|seconds?|s|min|mins|minutes?)\b/gi, '')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi, '')
    .replace(/:\d+(:\d+)?/g, '')
    .replace(/(?:\/[\w.@+~-]+)*\/(?=[\w.@+~-])/g, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first 2 error-looking lines (or the last non-empty line), normalized, max 200 chars. */
export function signature(output: string): string {
  const lines = output.split('\n').map(l => l.trim()).filter(l => l !== '' && !WRAPPER_LINE.test(l))
  const errors = lines.filter(l => ERROR_LINE.test(l)).map(normalizeLine).filter(l => l !== '')
  const picked = errors.length > 0 ? errors.slice(0, 2) : [normalizeLine(lines[lines.length - 1] ?? '')]
  return picked.join(' | ').slice(0, 200)
}

export function isStillBroken(prompt: string): boolean {
  return STILL_BROKEN.some(re => re.test(prompt))
}

export function noteFix(t: Tracker): void {
  t.seq += 1
}

export type Failure = { signature: string; count: number; trigger: boolean }

export function noteFailure(t: Tracker, command: string, output: string): Failure {
  const cmd = normalizeCommand(command)
  const code = /exit code:?\s*(\d+)/i.exec(output)?.[1] ?? '?'
  const sig = signature(output) || `${cmd} exit ${code}`.slice(0, 200)
  const entry = t.sigs.get(sig)
  if (entry === undefined) {
    t.sigs.set(sig, { count: 1, seq: t.seq, cmd, triggered: false })
    return { signature: sig, count: 1, trigger: false }
  }
  if (t.seq > entry.seq) entry.count += 1
  entry.seq = t.seq
  entry.cmd = cmd
  const trigger = entry.count >= TRIGGER_AT && !entry.triggered
  if (trigger) entry.triggered = true
  return { signature: sig, count: entry.count, trigger }
}

/** A success of the command that produced a signature drops that signature. Returns the dropped ones. */
export function noteSuccess(t: Tracker, command: string): string[] {
  const cmd = normalizeCommand(command)
  const dropped: string[] = []
  for (const [sig, entry] of t.sigs) {
    if (entry.cmd === cmd) {
      t.sigs.delete(sig)
      dropped.push(sig)
    }
  }
  return dropped
}

/** A prompt is a fix attempt. Returns true when it is the 3rd "still broken" prompt in a row. */
export function notePrompt(t: Tracker, text: string): boolean {
  noteFix(t)
  if (!isStillBroken(text)) {
    t.promptStreak = 0
    return false
  }
  t.promptStreak += 1
  if (t.promptStreak < TRIGGER_AT) return false
  t.promptStreak = 0
  return true
}

export function reset(t: Tracker): void {
  t.sigs.clear()
  t.promptStreak = 0
}

export function top(t: Tracker, n: number): { signature: string; count: number }[] {
  return [...t.sigs]
    .map(([signature, e]) => ({ signature, count: e.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

const INSTRUCTION =
  'Stop changing code. In 1 or 2 sentences, name the assumption that might be wrong, then ask the user one diagnostic question.'

export const errorInstruction = (sig: string): string =>
  `spiral-stop: the same error came back after ${TRIGGER_AT} fix attempts: "${sig}". ${INSTRUCTION}`

export const promptInstruction = `spiral-stop: the user said it is still broken ${TRIGGER_AT} times in a row. ${INSTRUCTION}`

export const TOAST = 'spiral-stop: same error 3 times. Claude was told to stop and rethink.'

export function bandText(kind: 'error' | 'prompt', sig: string, columns: number): string {
  if (kind === 'prompt') return 'Spiral: still broken 3 times in a row'
  const prefix = 'Spiral: same error after 3 fixes: '
  const room = Math.max(8, columns - prefix.length - ' [Dismiss]'.length - 1)
  return prefix + (sig.length > room ? `${sig.slice(0, room - 1)}…` : sig)
}

export function statusText(t: Tracker, isBandUp: boolean): string {
  const rows = top(t, 5)
  const lines = rows.length === 0 ? ['No failing signatures tracked.'] : rows.map(r => `${r.count}x ${r.signature}`)
  return [...lines, `Band: ${isBandUp ? 'up' : 'down'}`].join('\n')
}
