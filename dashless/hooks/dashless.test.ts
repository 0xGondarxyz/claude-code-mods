import { test, expect } from 'claude-code/testing'
import { fixDashes } from './fix'

const D = '\u2014'
const EN = '\u2013'

test('fixDashes cases', () => {
  const f = (s: string) => fixDashes(s).text
  expect(f(`a ${D} b`)).toBe('a, b')
  expect(f(`a${D}b`)).toBe('a, b')
  expect(f(`a ${D}b`)).toBe('a, b')
  expect(f(`${D} item`)).toBe('item')
  expect(f(`  ${D} item`)).toBe('  item')
  expect(f(`end ${D}`)).toBe('end')
  expect(f(`end ${D}\nnext`)).toBe('end\nnext')
  expect(fixDashes(`a ${D} b ${D} c`)).toEqual({ text: 'a, b, c', count: 2 })
  expect(f(`one ${D} two\n${D} three\nfour ${D}\nfive`)).toBe('one, two\nthree\nfour\nfive')
  expect(f(`note: ${D} x`)).toBe('note: x')
  expect(f(`a ${EN} b`)).toBe('a, b')
  expect(fixDashes(`1990${EN}2000`)).toEqual({ text: `1990${EN}2000`, count: 0 })
  expect(fixDashes('run --force -- x')).toEqual({ text: 'run --force -- x', count: 0 })
  expect(fixDashes('plain')).toEqual({ text: 'plain', count: 0 })
})

test('Write content is rewritten', async ($, on) => {
  let seen = ''
  on('tool.call', { tool: 'Write' }, (_$, e) => {
    seen = e.content
    return { result: {} as never, text: 'ok' }
  })
  await $.tool.call({ tool: 'Write', file_path: '/x', content: `a ${D} b` })
  expect(seen).toBe('a, b')
})

test('Edit rewrites new_string only', async ($, on) => {
  let seen: { o: string; n: string } = { o: '', n: '' }
  on('tool.call', { tool: 'Edit' }, (_$, e) => {
    seen = { o: e.old_string, n: e.new_string }
    return { result: {} as never, text: 'ok' }
  })
  await $.tool.call({ tool: 'Edit', file_path: '/x', old_string: `a ${D} b`, new_string: `c ${D} d` })
  expect(seen).toEqual({ o: `a ${D} b`, n: 'c, d' })
})

test('Bash only rewrites commit and PR commands', async ($, on) => {
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen.push(e.command)
    return { result: {} as never, text: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: `git commit -m "a ${D} b"` })
  await $.tool.call({ tool: 'Bash', command: `grep "${D}" x` })
  expect(seen).toEqual(['git commit -m "a, b"', `grep "${D}" x`])
})

// The kit has no bottom for session.append (a hook that answers without next is skipped, and
// nothing sits below it), so each append rejects. The hook beneath the plugin still sees the
// row exactly as the plugin passed it down, which is what these tests read.
test('session.append rewrites response text blocks only', async ($, on) => {
  const seen: unknown[] = []
  on('session.append', (_$, e) => {
    seen.push(e.message.content)
    return { message: e.message, uuid: e.uuid }
  })
  const base = { origin: { kind: 'model', model: 'm' } as never, uuid: 'u1' }
  const tool = { type: 'tool_use', id: 't', name: 'Bash', input: { command: `echo ${D}` } }
  await $.session.append({
    ...base,
    door: 'response',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: `a ${D} b` }, tool] },
  }).catch(() => undefined)
  await $.session.append({
    ...base,
    door: 'prompt',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: `a ${D} b` }] },
  }).catch(() => undefined)
  expect(seen).toEqual([
    [{ type: 'text', text: 'a, b' }, tool],
    [{ type: 'text', text: `a ${D} b` }],
  ])
})
