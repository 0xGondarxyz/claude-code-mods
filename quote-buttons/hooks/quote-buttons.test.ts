import { test, expect, mock } from 'claude-code/testing'
import { handOffArgv, preview, quoteBlock, shellLine } from './quote'

const PLUGIN = 'quote-buttons'
const SURFACES = ['terminal', 'desktop'] as const

type Rig = { box: { text: string; cursor: number }; toasts: string[]; delivered: string[]; fills: any[] }

// The engine beneath the plugin: a prompt box, a toast list, a submit bottom, an empty band.
function engine(on: any, draft = ''): Rig {
  const rig: Rig = { box: { text: draft, cursor: draft.length }, toasts: [], delivered: [], fills: [] }
  on('prompt.read', () => ({ value: { ...rig.box } }) as never)
  on('prompt.fill', (_$: any, e: any) => {
    rig.fills.push({ text: e.text, mode: e.mode })
    rig.box.text = e.mode === 'append' ? rig.box.text + e.text : e.text
    rig.box.cursor = rig.box.text.length
    return { isFilled: true } as never
  })
  on('ui.toast', (_$: any, e: any) => {
    rig.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.submit', (_$: any, e: any) => {
    rig.delivered.push(e.text)
    return { text: e.text } as never
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  return rig
}

const userProps = (text: string) => ({ text, origin: { kind: 'composer' }, isExpanded: true }) as any
const assistantProps = (text: string) => ({ text, isFirstOfReply: true }) as any

async function mountMessage($: any, surface: any, component: string, props: any) {
  return $.ui.mount({ plugin: PLUGIN, surface, component, props })
}

const bandProps = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as any
const mountBand = ($: any) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps })

const midTurn = (text: string) => ({ text, wait: false, turnId: 't1', origin: { kind: 'composer' } }) as any

// Pure functions.

test('quoteBlock: prefixes lines, cuts at 6 lines and 400 characters', () => {
  expect(quoteBlock('a\nb')).toBe('> a\n> b')
  const many = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n')
  expect(quoteBlock(many)).toBe(['> line 1', '> line 2', '> line 3', '> line 4', '> line 5', '> line 6…'].join('\n'))
  expect(quoteBlock(Array.from({ length: 6 }, (_, i) => `l${i}`).join('\n'))).not.toContain('…')
  const long = quoteBlock('x'.repeat(900))
  expect(long).toBe(`> ${'x'.repeat(400)}…`)
})

test('preview: first 60 characters on one line', () => {
  expect(preview('short')).toBe('short')
  expect(preview('a\nb')).toBe('a b')
  expect(preview('y'.repeat(100))).toBe(`${'y'.repeat(60)}…`)
})

// Message buttons.

for (const surface of SURFACES) {
  test(`quote a user message, empty box (${surface})`, async ($, on) => {
    const rig = engine(on)
    const m = await mountMessage($, surface, 'UserMessage', userProps('first line\nsecond line'))
    await m.press({ key: 'qb-quote' })
    expect(rig.box.text).toBe('> first line\n> second line\n')
    expect(rig.fills[0].mode).toBe('replace')
  })

  test(`quote a user message above an existing draft (${surface})`, async ($, on) => {
    const rig = engine(on, 'my draft')
    const m = await mountMessage($, surface, 'UserMessage', userProps('hello'))
    await m.press({ key: 'qb-quote' })
    expect(rig.box.text).toBe('> hello\nmy draft')
    expect(rig.box.cursor).toBe(rig.box.text.length)
  })

  test(`quote an assistant message of more than 6 lines (${surface})`, async ($, on) => {
    const rig = engine(on)
    const text = Array.from({ length: 10 }, (_, i) => `row ${i + 1}`).join('\n')
    const m = await mountMessage($, surface, 'AssistantMessage', assistantProps(text))
    await m.press({ key: 'qb-quote' })
    expect(rig.box.text).toBe('> row 1\n> row 2\n> row 3\n> row 4\n> row 5\n> row 6…\n')
  })

  test(`assistant message has no edit button (${surface})`, async ($, on) => {
    engine(on)
    const m = await mountMessage($, surface, 'AssistantMessage', assistantProps('hi'))
    expect(await m.find({ type: 'Button', key: 'qb-edit' })).toBeFalsy()
    expect(await m.find({ type: 'Button', key: 'qb-quote' })).toBeTruthy()
  })

  test(`edit with an empty box fills the original text (${surface})`, async ($, on) => {
    const rig = engine(on)
    const m = await mountMessage($, surface, 'UserMessage', userProps('fix this typo'))
    await m.press({ key: 'qb-edit' })
    expect(rig.box.text).toBe('fix this typo')
    expect(rig.fills[0].mode).toBe('replace')
    expect(rig.toasts).toEqual([])
  })

  test(`edit with a non-empty box changes nothing (${surface})`, async ($, on) => {
    const rig = engine(on, 'typing')
    const m = await mountMessage($, surface, 'UserMessage', userProps('old text'))
    await m.press({ key: 'qb-edit' })
    expect(rig.box.text).toBe('typing')
    expect(rig.fills).toEqual([])
    expect(rig.toasts).toEqual(['Clear the box first'])
  })
}

test('notification and teammate rows get no buttons', async ($, on) => {
  engine(on)
  const task = await mountMessage($, 'terminal', 'UserMessage', {
    ...userProps('done'),
    origin: { kind: 'task-notification' },
    task: { id: 'x', status: 'completed', durationMs: 1 },
  })
  expect(await task.find({ type: 'Button', key: 'qb-quote' })).toBeFalsy()
  const from = await mountMessage($, 'terminal', 'UserMessage', { ...userProps('hi'), from: { name: 'bob' } })
  expect(await from.find({ type: 'Button', key: 'qb-quote' })).toBeFalsy()
})

// Undo send.

test('mid-turn submit is delivered after 5 seconds', async ($, on) => {
  const rig = engine(on)
  const clock = mock.clock(on)
  const pending = $.prompt.submit(midTurn('go on'))
  await clock.advance(1000)
  const m = await mountBand($)
  expect(await m.find({ type: 'Button', key: 'qb-undo-h1' })).toBeTruthy()
  expect(rig.delivered).toEqual([])
  await clock.advance(4000)
  const result = await pending
  expect(result.text).toBe('go on')
  expect(rig.delivered).toEqual(['go on'])
  expect(await (await mountBand($)).find({ type: 'Button', key: 'qb-undo-h1' })).toBeFalsy()
})

test('mid-turn submit that is undone is dropped and its text is back in the box', async ($, on) => {
  const rig = engine(on)
  const clock = mock.clock(on)
  const pending = $.prompt.submit(midTurn('take it back'))
  await clock.advance(2000)
  const m = await mountBand($)
  await m.press({ key: 'qb-undo-h1' })
  const result = await pending
  expect(result.drop).toBe('Unsent. Your text is back in the box.')
  expect(rig.delivered).toEqual([])
  expect(rig.box.text).toBe('take it back')
  await clock.advance(10000)
  expect(rig.delivered).toEqual([])
})

test('undo appends below a draft that is already in the box', async ($, on) => {
  const rig = engine(on, 'new draft')
  const clock = mock.clock(on)
  const pending = $.prompt.submit(midTurn('old one'))
  await clock.advance(1000)
  await (await mountBand($)).press({ key: 'qb-undo-h1' })
  await pending
  expect(rig.box.text).toBe('new draft\nold one')
})

test('idle submit passes straight through', async ($, on) => {
  const rig = engine(on)
  const clock = mock.clock(on)
  const result = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } } as any)
  expect(result.text).toBe('hello')
  expect(rig.delivered).toEqual(['hello'])
  expect(clock.now()).toBe(0)
})

// Hand-off buttons.

type Launch = { argv: readonly string[]; cwd?: string }

// The host beneath the hand-off: a project root, a session id, a clipboard, a process call.
function host(on: any, run: (argv: readonly string[]) => any, id: string | undefined = 'sess-1') {
  const copied: string[] = []
  const launches: Launch[] = []
  on('session.root', () => ({ value: '/proj/root' }) as never)
  on('session.id', () => ({ value: id }) as never)
  on('ui.copy', (_$: any, e: any) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('process.run', (_$: any, e: any) => {
    launches.push({ argv: e.argv, cwd: e.init?.cwd })
    const out = run(e.argv)
    if (out instanceof Error) return { deny: out.message } as never
    return { value: out } as never
  })
  return { copied, launches }
}

const ok = () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

test('handOffArgv: with context forks the session, fresh starts a new one', () => {
  expect(handOffArgv('/r', 'do it', 's1')).toEqual([
    'konsole', '--new-tab', '--workdir', '/r', '-e', 'claude',
    '--resume', 's1', '--fork-session', 'Take this over and do it now:\n\ndo it',
  ])
  expect(handOffArgv('/r', 'do it')).toEqual(['konsole', '--new-tab', '--workdir', '/r', '-e', 'claude', 'do it'])
  expect(handOffArgv('/r', '-x')).toEqual(['konsole', '--new-tab', '--workdir', '/r', '-e', 'claude', '--', '-x'])
})

test('shellLine: quotes odd arguments', () => {
  expect(shellLine(['claude', "it's a\nb"])).toBe("claude 'it'\\''s a\nb'")
})

for (const surface of SURFACES) {
  test(`with context button runs a konsole fork (${surface})`, async ($, on) => {
    const rig = engine(on)
    const h = host(on, ok)
    const m = await mountMessage($, surface, 'UserMessage', userProps('fix "this"\nnow'))
    await m.press({ key: 'qb-ctx' })
    expect(h.launches).toEqual([
      {
        argv: [
          'konsole', '--new-tab', '--workdir', '/proj/root', '-e', 'claude',
          '--resume', 'sess-1', '--fork-session', 'Take this over and do it now:\n\nfix "this"\nnow',
        ],
        cwd: '/proj/root',
      },
    ])
    expect(rig.toasts).toEqual(['Opened a new tab (with context)'])
    expect(h.copied).toEqual([])
  })

  test(`fresh button runs a konsole new session on an assistant message (${surface})`, async ($, on) => {
    const rig = engine(on)
    const h = host(on, ok)
    const m = await mountMessage($, surface, 'AssistantMessage', assistantProps('plan B'))
    await m.press({ key: 'qb-fresh' })
    expect(h.launches[0]?.argv).toEqual(['konsole', '--new-tab', '--workdir', '/proj/root', '-e', 'claude', 'plan B'])
    expect(rig.toasts).toEqual(['Opened a new tab (fresh)'])
  })
}

test('hand-off spawn failure toasts the reason and copies the command', async ($, on) => {
  const rig = engine(on)
  const h = host(on, () => new Error('spawn konsole ENOENT'))
  const m = await mountMessage($, 'terminal', 'UserMessage', userProps('go'))
  await m.press({ key: 'qb-fresh' })
  expect(rig.toasts).toEqual(['Could not open a tab: quote-buttons: $.process.run: spawn konsole ENOENT. Command copied.'])
  expect(h.copied).toEqual(['konsole --new-tab --workdir /proj/root -e claude go'])
})

test('hand-off with a nonzero exit copies the command', async ($, on) => {
  const rig = engine(on)
  const h = host(on, () => ({ ...ok(), exitCode: 1, stderr: 'no display\n' }))
  const m = await mountMessage($, 'terminal', 'UserMessage', userProps('go'))
  await m.press({ key: 'qb-ctx' })
  expect(rig.toasts).toEqual(['Could not open a tab: no display. Command copied.'])
  expect(h.copied.length).toBe(1)
})

test('with context and no session id yet copies a fresh command', async ($, on) => {
  const rig = engine(on)
  const h = host(on, ok, '')
  const m = await mountMessage($, 'terminal', 'UserMessage', userProps('go'))
  await m.press({ key: 'qb-ctx' })
  expect(h.launches).toEqual([])
  expect(rig.toasts).toEqual(['Could not open a tab: No session id yet. Command copied.'])
  expect(h.copied).toEqual(['konsole --new-tab --workdir /proj/root -e claude go'])
})
