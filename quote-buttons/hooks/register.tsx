import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Held } from '../types'
import { HOLD_SECONDS, handOffArgv, preview, quoteInto, shellLine } from './quote'

const held = atom({ plugin: 'quote-buttons', key: 'held' } as const, [] as Held[])

type Box = { text: string; cursor: number }

async function quote($: EngineInterface, message: string): Promise<void> {
  const draft: Box = await $.prompt.read()
  await $.prompt.fill({ text: quoteInto(message, draft.text), mode: 'replace' })
}

async function edit($: EngineInterface, message: string): Promise<void> {
  const draft: Box = await $.prompt.read()
  if (draft.text !== '') {
    $.ui.toast('Clear the box first')
    return
  }
  await $.prompt.fill({ text: message, mode: 'replace' })
}

// Opens a new Konsole tab running Claude on the message: a fork of this session
// (withContext) or a fresh one. On any failure the command goes to the clipboard.
async function handOff($: EngineInterface, message: string, withContext: boolean): Promise<void> {
  const label = withContext ? 'with context' : 'fresh'
  let argv: string[] = []
  try {
    const root = await $.session.root()
    let id: string | undefined
    if (withContext) {
      id = await $.session.id()
      if (!id) {
        argv = handOffArgv(root, message)
        throw new Error('No session id yet')
      }
    }
    argv = handOffArgv(root, message, id)
    // Konsole hands the tab to its running window and exits. A short timeout keeps a
    // Konsole that stays attached from holding the call; a timeout is not a failure.
    const res = await $.process.run(argv, { cwd: root, timeoutMs: 3000 }).catch((err: unknown) => {
      if (/still running|timed? ?out/i.test(String(err))) return { exitCode: 0, stderr: '' }
      throw err
    })
    if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `konsole exited with ${res.exitCode}`)
    $.ui.toast(`Opened a new tab (${label})`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (argv.length > 0) await $.ui.copy({ text: shellLine(argv) }).catch(() => {})
    $.ui.toast(`Could not open a tab: ${reason}. Command copied.`)
  }
}

// Puts an unsent prompt back: replaces an empty box, goes below a draft otherwise.
async function putBack($: EngineInterface, text: string): Promise<void> {
  const draft: Box = await $.prompt.read()
  if (draft.text === '') await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: `\n${text}`, mode: 'append' })
}

// Wraps the engine's drawing of a message, never changing it. The buttons sit
// dim at the right of the first row and show on hover only.
async function buttons($: EngineInterface, e: any, next: any, canEdit: boolean) {
  const tree = await next(e)
  const text: unknown = e.props.text
  if (typeof text !== 'string' || text.trim() === '') return tree
  if (e.props.task !== undefined || e.props.from !== undefined) return tree
  try {
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box key={`qb-${e.requestId}`} flexDirection="column">
        {tree}
        <Box position="absolute" top={0} right={0} display="none" hover={{ display: 'flex' }}>
          <Button key="qb-quote" label="↩ quote" dimColor onPress={() => quote($, text)} />
          {canEdit ? <Button key="qb-edit" label="✎ edit" dimColor onPress={() => edit($, text)} /> : null}
          <Button key="qb-ctx" label="⇢ with context" dimColor onPress={() => handOff($, text, true)} />
          <Button key="qb-fresh" label="⇢ fresh" dimColor onPress={() => handOff($, text, false)} />
        </Box>
      </Box>
    )
  } catch {
    return tree
  }
}

export const register: Register = on => {
  // One abort handle per held prompt. Lost on a hot reload, which only ends the hold early.
  const undoers = new Map<string, () => void>()
  let seq = 0

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => buttons($, e, next, true))
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => buttons($, e, next, false))

  on('prompt.submit', async ($, e, next) => {
    const isTypedMidTurn = e.turnId !== undefined && (e.origin === undefined || e.origin.kind === 'composer')
    if (!isTypedMidTurn) return next(e)

    const id = `h${++seq}`
    const ctrl = new AbortController()
    let isUndone = false
    undoers.set(id, () => {
      isUndone = true
      ctrl.abort()
    })
    const onAbort = () => ctrl.abort()
    next.signal.addEventListener('abort', onAbort)
    try {
      for (let s = HOLD_SECONDS; s > 0; s--) {
        const left = s
        await update($, held, hs => [...hs.filter(x => x.id !== id), { id, text: e.text, seconds: left }])
        await $.clock.sleep(1000, { signal: ctrl.signal })
      }
    } catch {
      // Aborted by the undo button or by the dispatch ending.
    } finally {
      next.signal.removeEventListener('abort', onAbort)
      undoers.delete(id)
      await update($, held, hs => hs.filter(x => x.id !== id)).catch(() => {})
    }
    if (isUndone) {
      await putBack($, e.text)
      return { drop: 'Unsent. Your text is back in the box.' }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    try {
      const hs = await read($, held)
      if (hs.length === 0) return below
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {hs.map(row => (
            <Box key={`qb-held-${row.id}`}>
              <Text>{`Sending in ${row.seconds}s: ${preview(row.text)} `}</Text>
              <Button key={`qb-undo-${row.id}`} label="undo" onPress={() => undoers.get(row.id)?.()} />
            </Box>
          ))}
          {below.type !== 'engine' ? below : null}
        </Box>
      )
    } catch {
      return below
    }
  })
}
