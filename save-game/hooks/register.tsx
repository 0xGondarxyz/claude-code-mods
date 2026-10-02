import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Band, Card } from '../types'
import {
  CARD_PROMPT,
  IDLE_MS,
  RECENT_MS,
  addCard,
  cardLines,
  continuePrompt,
  isFresh,
  listText,
  nightKey,
  parseCard,
  projectDir,
  saveReply,
  savedHeader,
  tailFromJsonl,
  transcriptPrompt,
} from './save'

type Pending = { repo: string; sessionId: string; transcriptPath: string; endedAt: number }
type Made = { kind: 'none' } | { kind: 'old' | 'new'; card: Card } | { kind: 'fail'; reason: string }

const MAX_PENDING = 20
const TAIL_BYTES = '3000000'

const band = atom({ plugin: 'save-game', key: 'band' } as const, { card: null, isShown: false } as Band)

// Module state resets on reload; a session start fills it again.
let turns = 0
let cardAt = 0
let lastTurnAt = 0
let lastNight = ''
let isDone = false
// False for -p and SDK runs: the mod does nothing there.
let isLive = false
let startCwd = ''
let repoCache = ''
let idle: Timer | undefined
let night: Timer | undefined
let chain: Promise<unknown> = Promise.resolve()

// One model call at a time, so two triggers never fork twice.
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

async function toplevel($: EngineInterface, dir: string): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'])
    const top = r.stdout.trim()
    if (r.exitCode === 0 && top !== '') return top
  } catch {}
  return dir
}

async function repoOf($: EngineInterface): Promise<string> {
  if (repoCache === '') repoCache = await toplevel($, await $.session.cwd())
  return repoCache
}

async function storedCards($: EngineInterface): Promise<Record<string, Card[]>> {
  const v = await $.store.get('cards')
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Card[]>) : {}
}

async function saveCard($: EngineInterface, card: Card): Promise<void> {
  await $.store.set('cards', addCard(await storedCards($), card))
}

// The fork runs over this session's own transcript while its prompt cache is warm.
async function makeCard($: EngineInterface, force: boolean): Promise<Made> {
  return serial(async (): Promise<Made> => {
    try {
      const repo = await repoOf($)
      if (turns <= cardAt) {
        if (!force) return { kind: 'none' }
        const newest = (await storedCards($))[repo]?.[0]
        return newest ? { kind: 'old', card: newest } : { kind: 'fail', reason: 'nothing to save yet' }
      }
      const seen = turns
      const r = await $.model.fork({ prompt: CARD_PROMPT })
      if (!r.isAnswered) return { kind: 'fail', reason: r.reason }
      const parsed = parseCard(r.text)
      if (!parsed) return { kind: 'fail', reason: 'the reply was not a 3 line card' }
      const card: Card = { ...parsed, savedAt: await $.clock.now(), sessionId: await $.session.id(), repo }
      await saveCard($, card)
      cardAt = seen
      return { kind: 'new', card }
    } catch (err) {
      return { kind: 'fail', reason: err instanceof Error ? err.message : 'error' }
    }
  })
}

async function autoCard($: EngineInterface): Promise<Made> {
  const made = await makeCard($, false)
  if (made.kind === 'fail') $.ui.toast(`save-game: no card saved: ${made.reason}`)
  return made
}

async function checkNight($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now()
    const key = nightKey(now)
    if (key === null || key === lastNight) return
    if (lastTurnAt === 0 || now - lastTurnAt > RECENT_MS) return
    lastNight = key
    await autoCard($)
    $.ui.toast('save-game: saved. It is past 1am, a good point to stop.')
  } catch {}
}

async function showBand($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const newest = (await storedCards($))[await repoOf($)]?.[0]
  const card = newest && isFresh(newest, now) ? newest : null
  await update($, band, () => ({ card, isShown: card !== null }))
}

// Turns a session that ended without a card into one, from its transcript file.
async function cardFromTranscript($: EngineInterface, p: Pending): Promise<boolean> {
  if (!(await $.fs.exists(p.transcriptPath))) return false
  const r = await $.process.run(['tail', '-c', TAIL_BYTES, p.transcriptPath])
  if (r.exitCode !== 0) return false
  const tail = tailFromJsonl(r.stdout)
  if (tail === '') return false
  const reply = await $.model.complete({ model: 'sonnet', prompt: transcriptPrompt(tail), maxTokens: 400, timeoutMs: 120_000 })
  if (!reply.isAnswered) return false
  const parsed = parseCard(reply.text)
  if (!parsed) return false
  await saveCard($, { ...parsed, savedAt: p.endedAt, sessionId: p.sessionId, repo: p.repo })
  return true
}

const isPending = (p: unknown): p is Pending =>
  !!p &&
  typeof (p as Pending).repo === 'string' &&
  typeof (p as Pending).sessionId === 'string' &&
  typeof (p as Pending).transcriptPath === 'string' &&
  typeof (p as Pending).endedAt === 'number'

async function drain($: EngineInterface): Promise<void> {
  try {
    const list = await $.store.get('pending')
    if (!Array.isArray(list) || list.length === 0) return
    await $.store.set('pending', [])
    let made = false
    for (const p of list) {
      if (!isPending(p)) continue
      try {
        if (await cardFromTranscript($, p)) made = true
      } catch {}
    }
    if (made && !isDone) await showBand($)
  } catch {}
}

async function transcriptPath($: EngineInterface, cwd: string, sessionId: string): Promise<string | null> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
  const path = `${dir}/projects/${projectDir(cwd)}/${sessionId}.jsonl`
  return (await $.fs.exists(path)) ? path : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isLive = e.isInteractive
    if (!isLive) return next(e)
    try {
      startCwd = e.cwd
      repoCache = await toplevel($, e.cwd)
      await $.command.register({
        name: 'save',
        description: 'Save a 3 line card: what you were doing, the next step, the open question',
        argumentHint: '[list]',
      })
      night?.cancel()
      night = $.clock.every(60_000, () => {
        void checkNight($)
      })
      await showBand($)
      // Not awaited: cards for earlier sessions must not delay startup.
      $.clock.after(0, () => {
        void drain($)
      })
    } catch {}
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    idle?.cancel()
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    idle?.cancel()
    isDone = true
    try {
      await update($, band, b => ({ ...b, isShown: false }))
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (isLive && e.agentId === undefined) {
        turns += 1
        lastTurnAt = await $.clock.now()
        idle?.cancel()
        idle = $.clock.after(IDLE_MS, () => {
          void autoCard($)
        })
      }
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'save' }, async ($, e, next) => {
    if (!isLive) return next(e)
    try {
      const now = await $.clock.now()
      if (e.args.trim() === 'list') {
        const cards = (await storedCards($))[await repoOf($)] ?? []
        return { text: listText(cards, now) }
      }
      const made = await makeCard($, true)
      if (made.kind === 'fail') return { text: `save-game: no card saved: ${made.reason}` }
      if (made.kind === 'none') return next(e)
      return { text: saveReply(made.card) }
    } catch (err) {
      return { text: `save-game: no card saved: ${err instanceof Error ? err.message : 'error'}` }
    }
  })

  // No model call here: the exit budget is short. The next session start writes the card.
  on('session.end', async ($, e, next) => {
    if (!isLive) return next(e)
    try {
      idle?.cancel()
      night?.cancel()
      if (turns > cardAt) {
        const cwd = startCwd !== '' ? startCwd : await $.session.cwd()
        const path = await transcriptPath($, cwd, e.sessionId)
        if (path !== null) {
          const old = await $.store.get('pending')
          const entry: Pending = { repo: await repoOf($), sessionId: e.sessionId, transcriptPath: path, endedAt: await $.clock.now() }
          await $.store.set('pending', [...(Array.isArray(old) ? old : []), entry].slice(-MAX_PENDING))
        }
      }
      if (e.reason === 'clear') {
        turns = 0
        cardAt = 0
      }
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band has one slot shared with other mods: draw ours above whatever is beneath.
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    try {
      const { card, isShown } = await read($, band)
      if (!isShown || card === null) return inner

      const { Box, Button, Text } = $.ui.resolve(e)
      const [doing, nextStep, open] = cardLines(card)
      const hide = () => update($, band, b => ({ ...b, isShown: false }))
      const onContinue = async () => {
        isDone = true
        const text = continuePrompt(card)
        await hide()
        try {
          await $.prompt.submit({ text, asUser: true })
        } catch {
          $.clock.after(0, () => {
            void $.prompt.submit({ text, asUser: true }).catch(() => undefined)
          })
        }
      }
      const onDismiss = async () => {
        isDone = true
        await hide()
      }
      return (
        <Box flexDirection="column">
          <Text bold>{savedHeader(card, await $.clock.now())}</Text>
          <Text>{doing}</Text>
          <Text>{nextStep}</Text>
          <Text>{open}</Text>
          <Box>
            <Button key="save-continue" label="Continue" variant="primary" onPress={onContinue} />
            <Text> </Text>
            <Button key="save-dismiss" label="Dismiss" onPress={onDismiss} />
          </Box>
          {inner.type !== 'engine' ? inner : null}
        </Box>
      )
    } catch {
      return inner
    }
  })
}
