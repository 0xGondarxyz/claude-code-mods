import { test, expect } from 'claude-code/testing'
import {
  bandText,
  newTracker,
  noteFailure,
  noteFix,
  noteSuccess,
  notePrompt,
  signature,
  top,
} from './spiral'

const OUT_A = `FAIL src/a.test.ts (3.21s)
  expected 5 to equal 6
    at /home/me/proj/src/a.ts:42:17
Error: boom 0xdeadbeef at 2026-10-02T10:11:12Z took 340ms
Error: third line`
const OUT_A2 = `FAIL src/a.test.ts (12.9s)
  expected 7 to equal 9
    at /tmp/other/proj/src/a.ts:420:3
Error: boom 0xabc12345 at 2026-10-03T01:02:03Z took 12ms`
const OUT_B = 'TypeError: cannot read property x of undefined'

test('signature ignores numbers, durations, ids, timestamps and path prefixes', () => {
  expect(signature(OUT_A)).toBe(signature(OUT_A2))
  expect(signature(OUT_A)).not.toBe(signature(OUT_B))
  expect(signature(OUT_A).includes(' | ')).toBe(true)
  expect(signature('x'.repeat(500) + ' error').length <= 200).toBe(true)
})

test('signature falls back to the last non-empty line', () => {
  expect(signature("ls: cannot access '/nonexistent_dir_3': No such file\n\n")).toBe(
    "ls: cannot access 'nonexistent_dir_': No such file",
  )
})

test('wrapper lines are ignored so different failures differ', () => {
  const ls = (n: number) => `Exit code 2\nls: cannot access '/tmp/a_missing_${n}': No such file or directory`
  const cat = 'Exit code 1\ncat: /b_missing: No such file or directory'
  expect(signature(ls(1))).toBe(signature(ls(7)))
  expect(signature(ls(1))).not.toBe(signature(cat))
  expect(signature('Error: Exit code 3')).toBe('')
  const t = newTracker()
  expect(noteFailure(t, 'make  build', 'Exit code 3').signature).toBe('make build exit 3')
  expect(noteFailure(t, 'make test', 'Exit code 3').signature).toBe('make test exit 3')
})

test('same failing command twice with no edit counts once', () => {
  const t = newTracker()
  expect(noteFailure(t, 'npm test', OUT_A).count).toBe(1)
  expect(noteFailure(t, 'npm test', OUT_A2).count).toBe(1)
})

test('fail, edit, fail, edit, fail triggers at 3, once', () => {
  const t = newTracker()
  expect(noteFailure(t, 'npm test', OUT_A).trigger).toBe(false)
  noteFix(t)
  expect(noteFailure(t, 'npm test', OUT_A).trigger).toBe(false)
  noteFix(t)
  const f = noteFailure(t, 'npm test', OUT_A)
  expect(f.count).toBe(3)
  expect(f.trigger).toBe(true)
  noteFix(t)
  expect(noteFailure(t, 'npm test', OUT_A).trigger).toBe(false)
})

test('interleaved different errors do not trigger', () => {
  const t = newTracker()
  noteFailure(t, 'npm test', OUT_A)
  noteFix(t)
  noteFailure(t, 'npm test', OUT_B)
  noteFix(t)
  const f = noteFailure(t, 'npm test', OUT_A)
  expect(f.trigger).toBe(false)
  expect(top(t, 5).every(r => r.count < 3)).toBe(true)
})

test('success of the same command resets, other commands do not', () => {
  const t = newTracker()
  noteFailure(t, 'npm  test', OUT_A)
  expect(noteSuccess(t, 'ls')).toEqual([])
  expect(noteSuccess(t, 'npm test').length).toBe(1)
  expect(top(t, 5)).toEqual([])
  noteFix(t)
  expect(noteFailure(t, 'npm test', OUT_A).count).toBe(1)
})

test('three still-broken prompts trigger, a normal prompt resets', () => {
  const t = newTracker()
  expect(notePrompt(t, "it's still broken")).toBe(false)
  expect(notePrompt(t, 'same error again')).toBe(false)
  expect(notePrompt(t, 'still not working')).toBe(true)
  const u = newTracker()
  notePrompt(u, 'still failing')
  notePrompt(u, 'add a button please')
  notePrompt(u, 'still failing')
  expect(notePrompt(u, 'still failing')).toBe(false)
  expect(notePrompt(u, 'you did not fix it, not fixed')).toBe(true)
})

test('band text is cut to fit', () => {
  const s = bandText('error', 'e'.repeat(300), 60)
  expect(s.length + ' [Dismiss]'.length <= 60).toBe(true)
  expect(bandText('prompt', '', 80).startsWith('Spiral:')).toBe(true)
})

// Wiring tests. The note for Claude travels in `context` (tool result) or `context` (prompt).

function fake(on: any, text = 'Exit code 1\nError: boom 7') {
  on('tool.call', () => ({ isError: true, result: text, text: 'compressed by another plugin' }) as never)
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
}

const bash = ($: any, command = 'npm test') => $.tool.call({ tool: 'Bash' as const, command })
const edit = ($: any) => $.tool.call({ tool: 'Edit' as const, file_path: '/tmp/x', old_string: 'a', new_string: 'b' })
const mountBand = ($: any) =>
  $.ui.mount({
    plugin: 'spiral-stop',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100 },
  } as any)

test('third failure tells Claude once, sets the band, dismiss clears it', async ($, on) => {
  fake(on)
  const results: any[] = []
  for (let i = 0; i < 3; i++) {
    results.push(await bash($))
    await edit($)
  }
  expect(results[0].context).toBeUndefined()
  expect(results[1].context).toBeUndefined()
  expect(results[2].text).toBe('compressed by another plugin')
  expect(results[2].context.length).toBe(1)
  expect(results[2].context[0].startsWith('spiral-stop: the same error came back after 3 fix attempts: "Error: boom"')).toBe(true)
  expect(results[2].context[0].includes('ask the user one diagnostic question')).toBe(true)
  const again: any = await bash($)
  expect(again.context).toBeUndefined()
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /Spiral: same error after 3 fixes/ })).toBeDefined()
  await ui.press({ key: 'spiral-dismiss' })
  expect(await ui.find({ type: 'Text', text: /Spiral:/ })).toBeUndefined()
})

test('the band wraps what another plugin drew', { plugins: [{
  name: 'other-band',
  tier: 'builtin' as const,
  register: (on: any) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
      await next(e)
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'OTHER-BAND')
    })
  },
}] }, async ($, on) => {
  fake(on)
  for (let i = 0; i < 3; i++) {
    await bash($)
    await edit($)
  }
  await bash($)
  const ui: any = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /Spiral:/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /OTHER-BAND/ })).toBeDefined()
})

test('/spiral lists and resets', async ($, on) => {
  fake(on)
  await bash($)
  const r: any = await $.command.run({ command: 'spiral', args: '' } as any)
  expect(r.text.includes('1x Error: boom')).toBe(true)
  expect(r.text.includes('Band: down')).toBe(true)
  const c: any = await $.command.run({ command: 'spiral', args: 'reset' } as any)
  expect(c.text).toBe('spiral-stop: cleared.')
  const l: any = await $.command.run({ command: 'spiral', args: '' } as any)
  expect(l.text.startsWith('No failing')).toBe(true)
})

test('third still-broken prompt carries the note in context', async ($, on) => {
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }) as never)
  const send = (text: string): Promise<any> => $.prompt.submit({ text } as any)
  expect((await send('still broken')).context).toBeUndefined()
  expect((await send('same error again')).context).toBeUndefined()
  const third = await send('still not working')
  expect(third.context.length).toBe(1)
  expect(third.context[0].startsWith('spiral-stop: the user said it is still broken 3 times in a row.')).toBe(true)
  expect((await send('still broken')).context).toBeUndefined()
})
