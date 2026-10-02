import type { Register } from 'claude-code'

import { snapArgv, snapFile } from './snap'

const DRAG_TIMEOUT_MS = 120_000

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'snap',
        description: 'Drag a box on screen; the screenshot goes into your message',
      })
    } catch {}
    return next(e)
  })

  // A process.run in flight does not count against the hook's 10 s budget,
  // so the wait while the person drags is free.
  on('command.run', { command: 'snap' }, async $ => {
    const home = (await $.env.get('HOME')) ?? ''
    const startedAt = await $.clock.now()
    const file = snapFile(home, startedAt)
    const dir = file.slice(0, file.lastIndexOf('/'))
    try {
      await $.process.run(['mkdir', '-p', dir])
      const shot = await $.process.run(snapArgv(file), { timeoutMs: DRAG_TIMEOUT_MS })
      const check = shot.exitCode === 0 ? await $.process.run(['test', '-s', file]) : shot
      if (check.exitCode !== 0) {
        $.ui.toast('Snap cancelled')
        return { text: 'Snap cancelled.' }
      }
    } catch (error) {
      const message = await failureMessage($, error, startedAt)
      $.ui.toast(message)
      return { text: `${message}.` }
    }
    await $.prompt.fill({ text: `@${file} `, mode: 'insert' })
    return { text: 'Snap added to your message.' }
  })
}

// The engine rejects the same way for a missing binary, a timeout and a failed
// start, so the cause is told apart by asking the shell and by the clock.
async function failureMessage($: any, error: unknown, startedAt: number): Promise<string> {
  try {
    const lookup = await $.process.run(['sh', '-c', 'command -v spectacle'])
    if (lookup.exitCode !== 0) return 'Snap needs Spectacle (KDE)'
  } catch {}
  const elapsed = (await $.clock.now()) - startedAt
  if (elapsed >= DRAG_TIMEOUT_MS - 1000) return 'Snap timed out after 2 minutes'
  const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 80)
  return `Snap failed: ${reason}`
}
