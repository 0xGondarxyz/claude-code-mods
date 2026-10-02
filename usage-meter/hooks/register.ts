import type { Register } from 'claude-code'
import { dueToasts, localClock, statusText } from './meter'

const fired = new Map<string, number>()

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      const { rateLimits } = await $.session.usage()
      if (rateLimits.length > 0) $.ui.status(statusText(rateLimits, localClock))
    } catch {}
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    try {
      $.ui.status(statusText(e.rateLimits, localClock))
      for (const text of dueToasts(e.rateLimits, fired, localClock)) $.ui.toast(text)
    } catch {}
    return next(e)
  })
}
