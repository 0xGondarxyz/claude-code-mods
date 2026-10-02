import { test, expect } from 'claude-code/testing'
import { dueToasts, statusText, type Clock, type RateLimit } from './meter'

// Fixed clock: reports UTC so results do not depend on the machine timezone.
const clock: Clock = (d) =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

const R5 = '2026-10-02T18:40:00Z'
const five = (p: number, ...rest: [string | undefined] | []): RateLimit => ({
  kind: 'five_hour',
  percentUsed: p,
  resetsAt: rest.length ? rest[0] : R5,
})
const week = (p: number): RateLimit => ({ kind: 'seven_day', percentUsed: p, resetsAt: '2026-10-05T00:00:00Z' })

test('status text shapes', () => {
  expect(statusText([five(62), week(41)], clock)).toBe('Claude 5h 62% (resets 18:40) · week 41%')
  expect(statusText([week(41), five(62)], clock)).toBe('Claude 5h 62% (resets 18:40) · week 41%')
  expect(statusText([five(62)], clock)).toBe('Claude 5h 62% (resets 18:40)')
  expect(statusText([week(41)], clock)).toBe('Claude week 41%')
  expect(statusText([week(41), { kind: 'weird', percentUsed: 5 }, five(1)], clock)).toBe(
    'Claude 5h 1% (resets 18:40) · week 41% · weird 5%',
  )
  expect(statusText([{ kind: 'spend_limit', percentUsed: 120 }, five(10)], clock)).toBe(
    'Claude 5h 10% (resets 18:40) · spend 120%',
  )
})

test('missing or invalid resetsAt, rounding, empty', () => {
  expect(statusText([five(62, undefined)], clock)).toBe('Claude 5h 62%')
  expect(statusText([five(62, 'not a date')], clock)).toBe('Claude 5h 62%')
  expect(statusText([five(61.5)], clock)).toBe('Claude 5h 62% (resets 18:40)')
  expect(statusText([five(5, '2026-10-02T03:05:00Z')], clock)).toBe('Claude 5h 5% (resets 03:05)')
  expect(statusText([], clock)).toBeUndefined()
})

test('toast thresholds', () => {
  const fired = new Map<string, number>()
  const step = (p: number) => dueToasts([five(p)], fired, clock)
  expect(step(79)).toEqual([])
  expect(step(80)).toEqual(['Claude 5h limit at 80%, resets 18:40. Good time to hand big tasks to Sonnet.'])
  expect(step(85)).toEqual([])
  expect(step(90)).toEqual(['Claude 5h limit at 90%, resets 18:40. Good time to hand big tasks to Sonnet.'])
  expect(step(95)).toEqual([])
})

test('jump past 90 sends only the 90 toast, then nothing', () => {
  const fired = new Map<string, number>()
  expect(dueToasts([five(75)], fired, clock)).toEqual([])
  expect(dueToasts([five(95)], fired, clock)).toEqual([
    'Claude 5h limit at 95%, resets 18:40. Good time to hand big tasks to Sonnet.',
  ])
  expect(dueToasts([five(96)], fired, clock)).toEqual([])
  expect(dueToasts([five(82)], fired, clock)).toEqual([])
})

test('dropping under 80 then rising warns again', () => {
  const fired = new Map<string, number>()
  expect(dueToasts([five(90)], fired, clock)).toHaveLength(1)
  expect(dueToasts([five(10)], fired, clock)).toEqual([])
  expect(dueToasts([five(80)], fired, clock)).toEqual([
    'Claude 5h limit at 80%, resets 18:40. Good time to hand big tasks to Sonnet.',
  ])
})

test('a shifted resetsAt does not repeat the toast', () => {
  const fired = new Map<string, number>()
  expect(dueToasts([five(85, '2026-10-02T18:40:00Z')], fired, clock)).toHaveLength(1)
  expect(dueToasts([five(85, '2026-10-02T18:40:03Z')], fired, clock)).toEqual([])
  expect(dueToasts([five(86, '2026-10-02T18:39:58Z')], fired, clock)).toEqual([])
})

test('windows are independent; no time drops the clause', () => {
  const fired = new Map<string, number>()
  expect(dueToasts([five(82)], fired, clock)).toHaveLength(1)
  expect(dueToasts([five(82), week(85)], fired, clock)).toEqual([
    'Claude week limit at 85%, resets 00:00. Good time to hand big tasks to Sonnet.',
  ])
  expect(dueToasts([five(85, undefined), week(85)], new Map(), clock)).toEqual([
    'Claude 5h limit at 85%. Good time to hand big tasks to Sonnet.',
    'Claude week limit at 85%, resets 00:00. Good time to hand big tasks to Sonnet.',
  ])
})

test('a measure event sets the status line', async ($, on) => {
  const seen: Array<string | undefined> = []
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.status', (_$, e) => {
    seen.push(e.text)
    return {} as never
  })
  await $.session.measure({
    context: {} as never,
    rateLimits: [{ kind: 'seven_day', percentUsed: 41 }],
    changed: ['rateLimits'],
  })
  expect(seen).toEqual(['Claude week 41%'])
})
