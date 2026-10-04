import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { SYSTEM, buildPrompt, cleanTitle, lastAssistantText, userPrompts } from './title'

let running = false
let lastKey: string | undefined
let interactive = false

const titleAtom = atom({ plugin: 'session-title', key: 'title' } as const, null)

async function refresh($: EngineInterface): Promise<void> {
  if (running) return
  running = true
  try {
    const rows = await $.session.messages()
    const prompts = userPrompts(rows)
    const lastPrompt = prompts[prompts.length - 1]
    if (lastPrompt === undefined) return
    const key = `${prompts.length}:${lastPrompt}`
    if (key === lastKey) return
    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: buildPrompt(prompts, lastAssistantText(rows), (await read($, titleAtom)) ?? undefined),
      maxTokens: 30,
      effort: 'low',
      timeoutMs: 15000,
    })
    if (!r.isAnswered) return
    const newTitle = cleanTitle(r.text)
    if (newTitle === undefined) return
    await update($, titleAtom, () => newTitle)
    lastKey = key
  } catch {
  } finally {
    running = false
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    if (interactive) void refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (interactive && e.agentId === undefined) void refresh($)
    } catch {}
    return r
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      const t = await read($, titleAtom)
      if (!t) return next(e)
      return next({ ...e, props: { ...e.props, modes: [...e.props.modes, t] } })
    } catch {
      return next(e)
    }
  })
}
