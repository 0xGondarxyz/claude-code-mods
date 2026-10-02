import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band } from '../types'
import {
  TOAST,
  bandText,
  errorInstruction,
  newTracker,
  noteFailure,
  noteFix,
  noteSuccess,
  notePrompt,
  promptInstruction,
  reset,
  statusText,
} from './spiral'

const band = atom({ plugin: 'spiral-stop', key: 'band' } as const, null as Band | null)

const FIX_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

async function toast($: EngineInterface): Promise<void> {
  try {
    await $.ui.toast(TOAST)
  } catch {}
}

export const register: Register = on => {
  const tracker = newTracker()

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'spiral', description: 'Show tracked error loops. "/spiral reset" clears them.' })
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'spiral' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      reset(tracker)
      await update($, band, () => null)
      return { text: 'spiral-stop: cleared.' }
    }
    return { text: statusText(tracker, (await read($, band)) !== null) }
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      if (!notePrompt(tracker, e.text)) return next(e)
      await update($, band, () => ({ kind: 'prompt' as const, signature: '' }))
      await toast($)
      return next({ ...e, context: [...(e.context ?? []), promptInstruction] })
    } catch {
      return next(e)
    }
  })

  on('tool.call', async ($, e, next) => {
    if (FIX_TOOLS.has(e.tool)) {
      noteFix(tracker)
      return next(e)
    }
    if (e.tool !== 'Bash') return next(e)
    const ran = await next(e)
    try {
      if (ran.deny !== undefined) return ran
      if (ran.isError !== true) {
        const dropped = noteSuccess(tracker, e.command)
        const current = await read($, band)
        if (current !== null && dropped.includes(current.signature)) await update($, band, () => null)
        return ran
      }
      const f = noteFailure(tracker, e.command, typeof ran.result === 'string' ? ran.result : (ran.text ?? ''))
      if (!f.trigger) return ran
      const text = errorInstruction(f.signature)
      await update($, band, () => ({ kind: 'error' as const, signature: f.signature }))
      await toast($)
      return { ...ran, context: [...(ran.context ?? []), text] }
    } catch {
      return ran
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    try {
      if (e.props.hasSurvey) return inner
      const b = await read($, band)
      if (b === null) return inner

      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">{bandText(b.kind, b.signature, e.props.bodyColumns)} </Text>
            <Button key="spiral-dismiss" label="Dismiss" onPress={() => update($, band, () => null)} />
          </Box>
          {inner.type !== 'engine' ? inner : null}
        </Box>
      )
    } catch {
      return inner
    }
  })
}
