import { test, expect } from 'claude-code/testing'
import { snapArgv, snapFile } from './snap'

const FILE = '/home/u/.cache/claude-snaps/snap-20261003-142530.png'

type Run = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const done = (exitCode: number): Run => ({ exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

type Rig = { argvs: string[][]; toasts: string[]; fills: any[] }

// The engine beneath the plugin: a fake process table, a toast list, a prompt box.
function engine(on: any, shot: 'ok' | 'cancel' | 'empty' | 'missing' | 'timeout' | 'mkdir'): Rig {
  const rig: Rig = { argvs: [], toasts: [], fills: [] }
  on('env.get', () => ({ value: '/home/u' }) as never)
  let now = new Date(2026, 9, 3, 14, 25, 30).getTime()
  on('clock.now', () => ({ value: now }) as never)
  on('process.run', (_$: any, e: any) => {
    rig.argvs.push([...e.argv])
    const cmd = e.argv[0]
    if (cmd === 'sh') return { value: done(shot === 'missing' ? 1 : 0) } as never
    if (cmd === 'mkdir' && shot === 'mkdir') throw new Error('mkdir: permission denied')
    if (cmd === 'spectacle') {
      if (shot === 'missing') throw new Error('spawn spectacle ENOENT')
      if (shot === 'timeout') {
        now += 120_000
        throw new Error('command timed out')
      }
      return { value: done(shot === 'cancel' ? 1 : 0) } as never
    }
    if (cmd === 'test') return { value: done(shot === 'ok' ? 0 : 1) } as never
    return { value: done(0) } as never
  })
  on('ui.toast', (_$: any, e: any) => {
    rig.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.fill', (_$: any, e: any) => {
    rig.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true } as never
  })
  return rig
}

const run = ($: any) => $.command.run({ command: 'snap', args: '' })

test('snapFile: local time stamp under ~/.cache/claude-snaps', () => {
  expect(snapFile('/home/u', new Date(2026, 9, 3, 14, 25, 30).getTime())).toBe(FILE)
})

test('snapArgv: region, background, no notification, output file', () => {
  expect(snapArgv(FILE)).toEqual(['spectacle', '--region', '--background', '--nonotify', '--output', FILE])
})

test('success: spectacle argv, then @path inserted at the cursor', async ($, on) => {
  const rig = engine(on, 'ok')
  const r = await run($)
  expect(rig.argvs[0]).toEqual(['mkdir', '-p', '/home/u/.cache/claude-snaps'])
  expect(rig.argvs[1]).toEqual(['spectacle', '--region', '--background', '--nonotify', '--output', FILE])
  expect(rig.fills).toEqual([{ text: `@${FILE} `, mode: 'insert' }])
  expect(rig.toasts).toEqual([])
  expect(r.text).toBe('Snap added to your message.')
})

test('cancel: non-zero exit toasts and changes nothing', async ($, on) => {
  const rig = engine(on, 'cancel')
  await run($)
  expect(rig.toasts).toEqual(['Snap cancelled'])
  expect(rig.fills).toEqual([])
})

test('cancel: exit 0 but no file toasts and changes nothing', async ($, on) => {
  const rig = engine(on, 'empty')
  await run($)
  expect(rig.toasts).toEqual(['Snap cancelled'])
  expect(rig.fills).toEqual([])
})

test('spectacle missing: toast, no fill', async ($, on) => {
  const rig = engine(on, 'missing')
  await run($)
  expect(rig.toasts).toEqual(['Snap needs Spectacle (KDE)'])
  expect(rig.fills).toEqual([])
})

test('timeout: toast and text say it timed out', async ($, on) => {
  const rig = engine(on, 'timeout')
  const r = await run($)
  expect(rig.toasts).toEqual(['Snap timed out after 2 minutes'])
  expect(r.text).toBe('Snap timed out after 2 minutes.')
  expect(rig.fills).toEqual([])
})

test('other failure: Snap failed with the reason', async ($, on) => {
  const rig = engine(on, 'mkdir')
  const r = await run($)
  // The test engine words the rejection itself, so only the prefix is fixed.
  expect(rig.toasts).toHaveLength(1)
  expect(rig.toasts[0]).toMatch(/^Snap failed: .+/)
  expect(r.text).toBe(`${rig.toasts[0]}.`)
  expect(rig.fills).toEqual([])
})
