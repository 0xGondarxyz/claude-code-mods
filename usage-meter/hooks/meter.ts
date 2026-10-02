export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** Local clock reading as "HH:MM", or undefined. Injected so tests do not depend on the timezone. */
export type Clock = (date: Date) => string

export const THRESHOLDS = [80, 90] as const

export const localClock: Clock = (date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

const ORDER = ['five_hour', 'seven_day']

export function labelFor(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return 'week'
  if (kind === 'spend_limit') return 'spend'
  return kind
}

export function sortLimits(limits: RateLimit[]): RateLimit[] {
  const rank = (kind: string) => {
    const i = ORDER.indexOf(kind)
    return i === -1 ? ORDER.length : i
  }
  return limits
    .map((limit, index) => ({ limit, index }))
    .sort((a, b) => rank(a.limit.kind) - rank(b.limit.kind) || a.index - b.index)
    .map((x) => x.limit)
}

export function resetTime(resetsAt: string | undefined, clock: Clock): string | undefined {
  if (!resetsAt) return undefined
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return undefined
  return clock(date)
}

/** Status line text, or undefined to clear it. */
export function statusText(limits: RateLimit[], clock: Clock): string | undefined {
  if (limits.length === 0) return undefined
  const parts = sortLimits(limits).map((limit) => {
    let part = `${labelFor(limit.kind)} ${Math.round(limit.percentUsed)}%`
    if (limit.kind === 'five_hour') {
      const time = resetTime(limit.resetsAt, clock)
      if (time) part += ` (resets ${time})`
    }
    return part
  })
  return `Claude ${parts.join(' · ')}`
}

export function toastText(limit: RateLimit, clock: Clock): string {
  const time = resetTime(limit.resetsAt, clock)
  const resets = time ? `, resets ${time}` : ''
  return `Claude ${labelFor(limit.kind)} limit at ${Math.round(limit.percentUsed)}%${resets}. Good time to hand big tasks to Sonnet.`
}

/**
 * Toasts to send for these readings. `fired` holds, per kind, the highest threshold already
 * toasted. Dropping under the first threshold clears the entry so the window can warn again.
 * A reading past several thresholds sends only the highest one.
 */
export function dueToasts(limits: RateLimit[], fired: Map<string, number>, clock: Clock): string[] {
  const out: string[] = []
  for (const limit of sortLimits(limits)) {
    const crossed = THRESHOLDS.filter((t) => limit.percentUsed >= t)
    if (crossed.length === 0) {
      fired.delete(limit.kind)
      continue
    }
    const highest = crossed[crossed.length - 1] as number
    if (highest > (fired.get(limit.kind) ?? 0)) {
      fired.set(limit.kind, highest)
      out.push(toastText(limit, clock))
    }
  }
  return out
}
