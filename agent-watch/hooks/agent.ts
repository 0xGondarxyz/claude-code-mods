import type { AgentRow } from '../types'

export const TICK_MS = 15000
export const DONE_VISIBLE_MS = 30000

const MODELS = ['sonnet', 'opus', 'haiku', 'fable']

// The model's short name when the id or alias holds one, else the subagent type.
export function labelFor(model: string | undefined, subagentType: string | undefined): string {
  const lower = (model ?? '').toLowerCase()
  const known = MODELS.find(m => lower.includes(m))
  if (known) return known[0]!.toUpperCase() + known.slice(1)
  return subagentType && subagentType !== '' ? subagentType : 'Agent'
}

const base = (path: unknown): string => String(path ?? '').split('/').pop() ?? ''

// A short "Tool arg" for the latest tool call. `e` is the tool.call event.
export function describeTool(e: { tool: string } & Record<string, unknown>): string {
  const tool = String(e.tool)
  let arg = ''
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') arg = base(e.file_path)
  else if (tool === 'Bash') arg = String(e.command ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  else if (tool === 'Grep' || tool === 'Glob') arg = String(e.pattern ?? '')
  return arg === '' ? tool : `${tool} ${arg}`
}

export function truncate(text: string, columns: number): string {
  if (columns <= 0 || text.length <= columns) return text
  return columns === 1 ? '…' : `${text.slice(0, columns - 1)}…`
}

export function minutes(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 60000))
}

// One band line. The `now:` part is cut to the space the columns leave.
export function rowText(row: AgentRow, now: number, columns: number): string {
  const head = `${row.label} · ${row.description}`
  if (row.status === 'done') return truncate(`${head} · done`, columns)
  if (row.status === 'stopped') return truncate(`${head} · stopped`, columns)
  const mins = minutes(row.startedAt, now)
  const withTime = `${head} · ${mins < 1 ? '<1' : mins} min`
  if (row.tool === '') return truncate(withTime, columns)
  return truncate(`${withTime} · now: ${row.tool}`, columns)
}

// Rows to draw: running ones, and finished ones for DONE_VISIBLE_MS.
export function visibleRows(rows: Record<string, AgentRow>, now: number): AgentRow[] {
  return Object.values(rows)
    .filter(r => r.status === 'running' || now - (r.endedAt ?? 0) < DONE_VISIBLE_MS)
    .sort((a, b) => a.startedAt - b.startedAt)
}
