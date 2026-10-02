import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentStatus } from '../types'
import { DONE_VISIBLE_MS, TICK_MS, describeTool, labelFor, rowText, visibleRows } from './agent'

const agents = atom({ plugin: 'agent-watch', key: 'agents' } as const, {} as Record<string, AgentRow>)

type Ticker = { timer: { cancel: () => void } | null }

// Ends a running agent once: marks the row, toasts, and drops the row after 30 s.
async function finish($: EngineInterface, id: string, status: AgentStatus): Promise<void> {
  const now = await $.clock.now()
  let description: string | null = null
  await update($, agents, rows => {
    const row = rows[id]
    if (!row || row.status !== 'running') return rows
    description = row.description
    return { ...rows, [id]: { ...row, status, endedAt: now } }
  })
  if (description === null) return
  $.ui.toast(`Agent finished: ${description}`)
  $.ui.invalidate('ui.render')
  $.clock.after(DONE_VISIBLE_MS, async () => {
    await update($, agents, rows => {
      const { [id]: _gone, ...rest } = rows
      return rest
    })
    $.ui.invalidate('ui.render')
  })
}

// Ends agents the engine lists as no longer running (covers a stop that raises no turn.complete).
async function reconcile($: EngineInterface): Promise<void> {
  let list: { id: string; status: string }[] = []
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const rows = await read($, agents)
  for (const info of list) {
    const row = rows[info.id]
    if (!row || row.status !== 'running') continue
    if (info.status === 'completed') await finish($, info.id, 'done')
    else if (info.status === 'failed' || info.status === 'killed') await finish($, info.id, 'stopped')
  }
}

async function tick($: EngineInterface, ticker: Ticker): Promise<void> {
  try {
    await reconcile($)
    const now = await $.clock.now()
    const rows = await read($, agents)
    const left = visibleRows(rows, now)
    if (left.length !== Object.keys(rows).length) {
      await update($, agents, all => Object.fromEntries(left.map(r => [r.id, all[r.id] ?? r])))
    }
    if (left.length === 0 && ticker.timer) {
      ticker.timer.cancel()
      ticker.timer = null
    }
  } catch {}
  $.ui.invalidate('ui.render')
}

// Starts the 15 s redraw timer once per module load; a hot reload drops it, so render restarts it.
function ensureTick($: EngineInterface, ticker: Ticker): void {
  if (ticker.timer) return
  ticker.timer = $.clock.every(TICK_MS, () => {
    void tick($, ticker)
  })
}

export const register: Register = on => {
  const ticker: Ticker = { timer: null }
  // The latest tool of an agent whose row does not exist yet (its first call can beat the spawn answer).
  const early = new Map<string, string>()

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    try {
      const id = res.agentId
      if (id !== undefined) {
        const startedAt = await $.clock.now()
        const row: AgentRow = {
          id,
          label: labelFor(res.model, e.subagentType),
          description: e.description,
          startedAt,
          tool: early.get(id) ?? '',
          status: 'running',
        }
        early.delete(id)
        await update($, agents, rows => ({ ...rows, [id]: row }))
        ensureTick($, ticker)
        $.ui.invalidate('ui.render')
      }
    } catch {}
    return res
  })

  on('tool.call', async ($, e, next) => {
    try {
      if (e.agentId !== undefined) {
        const id = e.agentId
        const tool = describeTool(e as any)
        const rows = await read($, agents)
        if (rows[id]) {
          await update($, agents, all => (all[id] ? { ...all, [id]: { ...all[id], tool } } : all))
          $.ui.invalidate('ui.render')
        } else if (early.size < 50) {
          early.set(id, tool)
        }
      }
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    try {
      if (e.agentId !== undefined) await finish($, e.agentId, e.reason === 'answer' ? 'done' : 'stopped')
    } catch {}
    return res
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // The band has one slot shared with other mods: our rows on top, their drawing below.
    const below = await next(e)
    try {
      const now = await $.clock.now()
      const rows = visibleRows(await read($, agents), now)
      if (rows.length === 0) return below
      ensureTick($, ticker)

      const { Box, Text } = $.ui.resolve(e)
      const columns = e.props.bodyColumns
      return (
        <Box flexDirection="column">
          {rows.map(row => (
            <Text
              key={`aw-${row.id}`}
              color={row.status === 'done' ? 'green' : row.status === 'stopped' ? 'yellow' : undefined}
            >
              {rowText(row, now, columns)}
            </Text>
          ))}
          {below.type !== 'engine' ? below : null}
        </Box>
      )
    } catch {
      return below
    }
  })
}
