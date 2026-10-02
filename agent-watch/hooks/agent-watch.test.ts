import { test, expect, mock } from 'claude-code/testing'
import { describeTool, labelFor, rowText, truncate, visibleRows } from './agent'

const PLUGIN = 'agent-watch'
const bandProps = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as any

type Rig = { toasts: string[]; listed: { id: string; status: string }[] }

// The engine beneath: a spawn that hands out ids, a toast sink, a drawing of another mod, an agent list.
function engine(on: any): Rig {
  const rig: Rig = { toasts: [], listed: [] }
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }) as never)
  on('agent.list', () => ({ value: rig.listed }) as never)
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }) as never)
  on('ui.toast', (_$: any, e: any) => {
    rig.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  return rig
}

const spawn = ($: any, description: string, subagentType = 'sonnet-coder') =>
  $.agent.spawn({ prompt: 'p', description, subagentType })

const mountBand = ($: any) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps })

const texts = async (m: any): Promise<string[]> =>
  (await m.findAll({ type: 'Text' })).map((t: any) => t.text ?? '')

const toolCall = ($: any, agentId: string | undefined, input: any) =>
  $.tool.call({ ...input, agentId } as any)

const complete = ($: any, agentId: string, reason = 'answer') =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', agentId, reason } as any)

// Pure helpers.

test('labelFor: model name, else subagent type', () => {
  expect(labelFor('claude-sonnet-5-5', 'x')).toBe('Sonnet')
  expect(labelFor('opus', 'x')).toBe('Opus')
  expect(labelFor(undefined, 'Explore')).toBe('Explore')
  expect(labelFor('gpt-x', 'Explore')).toBe('Explore')
  expect(labelFor(undefined, undefined)).toBe('Agent')
})

test('describeTool: short argument per tool', () => {
  expect(describeTool({ tool: 'Read', file_path: '/a/b/c.ts' })).toBe('Read c.ts')
  expect(describeTool({ tool: 'Edit', file_path: '/a/b/d.ts' })).toBe('Edit d.ts')
  expect(describeTool({ tool: 'Write', file_path: 'e.md' })).toBe('Write e.md')
  expect(describeTool({ tool: 'Bash', command: `${'x'.repeat(60)}\nmore` })).toBe(`Bash ${'x'.repeat(40)}`)
  expect(describeTool({ tool: 'Grep', pattern: 'foo.*' })).toBe('Grep foo.*')
  expect(describeTool({ tool: 'Glob', pattern: '**/*.ts' })).toBe('Glob **/*.ts')
  expect(describeTool({ tool: 'WebFetch', url: 'u' })).toBe('WebFetch')
})

test('rowText: cuts the now part to the columns', () => {
  const row = { id: 'a', label: 'Sonnet', description: 'Build it', startedAt: 0, tool: 'Bash claude plugin test', status: 'running' } as const
  expect(rowText(row, 6 * 60000, 100)).toBe('Sonnet · Build it · 6 min · now: Bash claude plugin test')
  expect(rowText(row, 0, 100)).toBe('Sonnet · Build it · <1 min · now: Bash claude plugin test')
  expect(rowText(row, 0, 30)).toHaveLength(30)
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(rowText({ ...row, status: 'done', endedAt: 1 }, 0, 100)).toBe('Sonnet · Build it · done')
  expect(rowText({ ...row, status: 'stopped', endedAt: 1 }, 0, 100)).toBe('Sonnet · Build it · stopped')
})

test('visibleRows: done rows leave after 30 s', () => {
  const base = { label: 'L', description: 'd', startedAt: 0, tool: '' }
  const rows = {
    a: { ...base, id: 'a', status: 'running' as const },
    b: { ...base, id: 'b', status: 'done' as const, endedAt: 1000 },
  }
  expect(visibleRows(rows, 30999).map(r => r.id)).toEqual(['a', 'b'])
  expect(visibleRows(rows, 31000).map(r => r.id)).toEqual(['a'])
})

// Engine tests.

test('an agent starts: row with label and description', async ($, on) => {
  engine(on)
  mock.clock(on)
  await spawn($, 'Build snap screenshot mod')
  const t = await texts(await mountBand($))
  expect(t).toEqual(['Sonnet · Build snap screenshot mod · <1 min'])
})

test('a subagent tool call updates now:, a main-loop call does not', async ($, on) => {
  engine(on)
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await spawn($, 'Work')
  await toolCall($, 'a1', { tool: 'Bash', command: 'claude plugin test /some/long/path' })
  expect((await texts(await mountBand($)))[0]).toBe('Sonnet · Work · <1 min · now: Bash claude plugin test /some/long/path')
  await toolCall($, undefined, { tool: 'Read', file_path: '/x/main.ts' })
  expect((await texts(await mountBand($)))[0]).toContain('now: Bash')
  await toolCall($, 'a1', { tool: 'Read', file_path: '/x/y/z.ts' })
  expect((await texts(await mountBand($)))[0]).toContain('now: Read z.ts')
})

test('minutes advance with the clock', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  await spawn($, 'Slow')
  await clock.advance(6 * 60000)
  expect((await texts(await mountBand($)))[0]).toBe('Sonnet · Slow · 6 min')
})

test('finish: done row, one toast, gone after 30 s', async ($, on) => {
  const rig = engine(on)
  const clock = mock.clock(on)
  await spawn($, 'Finish me')
  await complete($, 'a1')
  expect(rig.toasts).toEqual(['Agent finished: Finish me'])
  expect(await texts(await mountBand($))).toEqual(['Sonnet · Finish me · done'])
  await clock.advance(29000)
  expect(await texts(await mountBand($))).toEqual(['Sonnet · Finish me · done'])
  await clock.advance(2000)
  expect(await texts(await mountBand($))).toEqual([])
  expect(rig.toasts).toHaveLength(1)
})

test('an interrupted agent shows stopped', async ($, on) => {
  const rig = engine(on)
  mock.clock(on)
  await spawn($, 'Cut short')
  await complete($, 'a1', 'aborted')
  expect(await texts(await mountBand($))).toEqual(['Sonnet · Cut short · stopped'])
  expect(rig.toasts).toEqual(['Agent finished: Cut short'])
})

test('the tick ends an agent the list reports killed', async ($, on) => {
  const rig = engine(on)
  const clock = mock.clock(on)
  await spawn($, 'Killed one')
  rig.listed = [{ id: 'a1', status: 'killed' }]
  await clock.advance(15000)
  expect(await texts(await mountBand($))).toEqual(['Sonnet · Killed one · stopped'])
  expect(rig.toasts).toEqual(['Agent finished: Killed one'])
})

test('two agents at once, each with its own now:', async ($, on) => {
  const rig = engine(on)
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await spawn($, 'First')
  await spawn($, 'Second', 'Explore')
  await toolCall($, 'a2', { tool: 'Grep', pattern: 'foo' })
  await complete($, 'a1')
  expect(await texts(await mountBand($))).toEqual(['Sonnet · First · done', 'Sonnet · Second · <1 min · now: Grep foo'])
  expect(rig.toasts).toEqual(['Agent finished: First'])
})

test('no agents: the band is the engine drawing unchanged', async ($, on) => {
  engine(on)
  mock.clock(on)
  const m = await mountBand($)
  expect(await m.findAll({ type: 'Text' })).toEqual([])
  expect(await m.find({ type: 'Box' })).toBeTruthy()
})

test('other mods drawing stays below our rows', async ($, on) => {
  engine(on)
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: { key: 'other' }, children: ['other mod'] }) as never)
  await spawn($, 'Mine')
  const t = await texts(await mountBand($))
  expect(t[0]).toBe('Sonnet · Mine · <1 min')
})

test('tool.call always passes through unchanged', async ($, on) => {
  engine(on)
  mock.clock(on)
  const seen: any[] = []
  on('tool.call', (_$: any, e: any) => {
    seen.push(e)
    return { result: 'bottom' } as never
  })
  await spawn($, 'Pass')
  const a = await toolCall($, 'a1', { tool: 'Bash', command: 'ls' })
  const b = await toolCall($, undefined, { tool: 'Bash', command: 'pwd' })
  const c = await toolCall($, 'zzz', { tool: 'Bash', command: 'who' })
  expect([a.result, b.result, c.result]).toEqual(['bottom', 'bottom', 'bottom'])
  expect(seen.map(e => e.command)).toEqual(['ls', 'pwd', 'who'])
})
