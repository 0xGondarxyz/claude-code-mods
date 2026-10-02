import { test, expect, mock } from 'claude-code/testing'
import { buildAsk, responseText } from './ladder'
import { scoreSte } from './ste'

const PLUGIN = 'output-ladder'

const STE_80 =
  'Rewrite your last answer about 80% of the way to ASD-STE100 Simplified Technical English: sentences of 20 words or fewer, common words with one meaning each, active voice, present tense, one idea per sentence, no idioms. Keep every fact and every number.'
const STE_FULL =
  'Rewrite your last answer in ASD-STE100 Simplified Technical English, following the specification strictly. Keep every fact and every number.'
const DIAGRAM =
  'Explain your last answer as a diagram. Draw an ASCII diagram with boxes and arrows that fits in 100 columns, then add at most 3 short lines of notes.'
const PAGE =
  'Turn your last answer into one self-contained HTML page that explains it visually: clear layout, inline SVG diagrams, small interactions only where they help understanding. If an Artifact or publish tool is available, publish it; otherwise save the file and give its path.'
const VIDEO =
  'Make a short explainer video of your last answer in the style of 3Blue1Brown. First show a scene plan. Use free or local tools for visuals and narration; do not use paid APIs unless I ask. Render an MP4 and give its path.'

const PLAIN = [
  'The pump moves water. It starts when you press the green button.',
  'The motor turns the shaft. The shaft turns the blades. The blades push the water out.',
  'You check the dial every day. The needle stays in the green zone. If it moves, you stop the pump.',
  'Then you call the team. The team finds the fault. They fix it fast.',
  'Keep the filter clean. Clean it each week. Use a soft brush and cold water.',
  'Dry the filter before you put it back. Close the lid. Press the button again.',
].join(' ')

const WINDY =
  'It has been widely believed by many of the engineers who were consulted during the extensive investigation that the unexpectedly considerable deterioration of the cooling infrastructure was caused by numerous maintenance procedures that had been inconsistently implemented throughout the organization over a surprisingly long period of time, and it was subsequently recommended by the independent review committee that comprehensive documentation requirements should be established immediately across every department. Furthermore, the recommendations were eventually accepted by management after a protracted discussion that was conducted over several months, although the implementation timeline was repeatedly postponed because the responsibilities were disputed by the departments that were affected.'

const longAnswer = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says a short plain thing.`).join(' ')
const shortAnswer = 'Done. The file is saved.'

// Test harness helpers.
type Seen = { prompts: Array<{ text: string; asUser?: boolean }>; statuses: string[] }

function engine(on: any): Seen {
  const seen: Seen = { prompts: [], statuses: [] }
  on('prompt.submit', (_$: any, e: any) => {
    seen.prompts.push({ text: e.text, asUser: e.origin?.asUser })
    return { text: e.text } as never
  })
  on('ui.status', (_$: any, e: any) => {
    seen.statuses.push(e.text)
    return { value: undefined } as never
  })
  // Bottom of the render chain: an empty band, as the engine draws when no plugin does.
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }) as never)
  return seen
}

let n = 0
const run = ($: any, command: string, args: string): Promise<any> => $.command.run({ command, args })
const complete = ($: any, answer = '') =>
  $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: `t${++n}`, reason: 'answer' })

const submit = ($: any, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any

const bandKeys = async ($: any) => {
  const m = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  const keys: string[] = []
  for (const key of ['ste', 'diagram', 'page', 'video']) {
    if (await m.find({ type: 'Button', key })) keys.push(key)
  }
  return { m, keys }
}

// Pure functions.

test('buildAsk texts, args and full', () => {
  expect(buildAsk('ste').text).toBe(STE_80)
  expect(buildAsk('ste', 'full').text).toBe(STE_FULL)
  expect(buildAsk('ste', 'FULL  for a child').text).toBe(`${STE_FULL}\nExtra instruction: for a child`)
  expect(buildAsk('ste', 'fullest').text).toBe(`${STE_80}\nExtra instruction: fullest`)
  expect(buildAsk('diagram').text).toBe(DIAGRAM)
  expect(buildAsk('page', ' dark theme ').text).toBe(`${PAGE}\nExtra instruction: dark theme`)
  expect(buildAsk('video').text).toBe(VIDEO)
  expect(buildAsk('diagram', 'full').text).toBe(`${DIAGRAM}\nExtra instruction: full`)
})

test('scoreSte: short plain paragraph scores high', () => {
  const s = scoreSte(PLAIN)
  expect(s).toBeDefined()
  expect(s!.score).toBeGreaterThanOrEqual(85)
  expect(s!.score).toBeLessThanOrEqual(100)
  expect(Number.isInteger(s!.score)).toBe(true)
})

test('scoreSte: long passive paragraph scores low', () => {
  const s = scoreSte(WINDY)
  expect(s).toBeDefined()
  expect(s!.score).toBeLessThan(50)
})

test('scoreSte: code, tables, headings, urls and inline code are ignored', () => {
  const noisy = [
    '# A heading that is not prose at all',
    '```js',
    'const was_written_by = a very long line of code that goes on and on and on and on and on and on and on and on and on and on and on',
    '```',
    '| a | b |',
    '| --- | --- |',
    PLAIN,
    'See https://example.com/a/very/long/path/that/should/not/count for more.',
    'Use `a_very_long_inline_code_span_name_that_is_not_prose` here.',
  ].join('\n')
  const clean = scoreSte(PLAIN)!
  const s = scoreSte(noisy)!
  expect(s.words).toBe(clean.words + 5)
  expect(s.sentences).toBe(clean.sentences + 2)
  expect(s.score).toBeGreaterThanOrEqual(85)
  // Only code, table and heading: nothing to score.
  expect(scoreSte('```\n' + PLAIN + '\n```')).toBeUndefined()
  expect(scoreSte('| ' + PLAIN + ' |')).toBeUndefined()
  expect(scoreSte('# ' + PLAIN)).toBeUndefined()
})

test('scoreSte: list items are sentences; under 40 words is undefined', () => {
  const items = Array.from({ length: 10 }, (_, i) => `- Item ${i} is a plain short note`).join('\n')
  const s = scoreSte(items)!
  expect(s.sentences).toBe(10)
  expect(scoreSte('The pump starts. The motor turns. Keep it clean.')).toBeUndefined()
  expect(scoreSte('')).toBeUndefined()
})

// Commands.

test('each command queues its prompt and replies', async ($, on) => {
  const seen = engine(on)
  const clock = mock.clock(on)
  const cases: Array<[string, string, string]> = [
    ['ste', STE_80, 'Asking for an STE version of the last answer.'],
    ['diagram', DIAGRAM, 'Asking for a diagram of the last answer.'],
    ['page', PAGE, 'Asking for an HTML page of the last answer.'],
    ['video', VIDEO, 'Asking for an explainer video of the last answer.'],
  ]
  for (const [command, text, reply] of cases) {
    const r = await run($, command, '')
    expect(r.text).toBe(reply)
    await clock.advance(1)
    expect(seen.prompts[seen.prompts.length - 1]!.text).toBe(text)
  }
  expect(seen.prompts).toHaveLength(4)
})

test('args become an extra instruction; /ste full is strict', async ($, on) => {
  const seen = engine(on)
  const clock = mock.clock(on)
  await run($, 'diagram', 'use colors')
  await clock.advance(1)
  expect(seen.prompts[0]!.text).toBe(`${DIAGRAM}\nExtra instruction: use colors`)
  const r = await run($, 'ste', 'full')
  await clock.advance(1)
  expect(seen.prompts[1]!.text).toBe(STE_FULL)
  expect(r.text).toBe('Asking for a full ASD-STE100 version of the last answer.')
  await run($, 'ste', 'full for a child')
  await clock.advance(1)
  expect(seen.prompts[2]!.text).toBe(`${STE_FULL}\nExtra instruction: for a child`)
})

// Band and status.

test('band shows after a long answer, buttons queue prompts and hide it', async ($, on) => {
  const seen = engine(on)
  await complete($, longAnswer)
  const { m, keys } = await bandKeys($)
  expect(keys).toEqual(['ste', 'diagram', 'page', 'video'])
  await m.press({ key: 'diagram' })
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]!.text).toBe(DIAGRAM)
  expect((await bandKeys($)).keys).toEqual([])
})

test('each button queues its own prompt', async ($, on) => {
  const seen = engine(on)
  const want: Record<string, string> = { ste: STE_80, diagram: DIAGRAM, page: PAGE, video: VIDEO }
  for (const key of Object.keys(want)) {
    await complete($, longAnswer)
    const { m } = await bandKeys($)
    await m.press({ key })
    expect(seen.prompts[seen.prompts.length - 1]!.text).toBe(want[key])
  }
})

test('band hides when the user submits a prompt', async ($, on) => {
  engine(on)
  await complete($, longAnswer)
  expect((await bandKeys($)).keys).toHaveLength(4)
  await submit($, 'next question')
  expect((await bandKeys($)).keys).toEqual([])
})

test('band stays hidden for a short answer', async ($, on) => {
  engine(on)
  await complete($, shortAnswer)
  expect((await bandKeys($)).keys).toEqual([])
})

test('band counts prose only, and only the latest turn', async ($, on) => {
  engine(on)
  await complete($, '```\n' + longAnswer + '\n```')
  expect((await bandKeys($)).keys).toEqual([])
  await complete($, longAnswer)
  expect((await bandKeys($)).keys).toHaveLength(4)
  await complete($, shortAnswer)
  expect((await bandKeys($)).keys).toEqual([])
})

test('status text format and keeping the last score', async ($, on) => {
  const seen = engine(on)
  await complete($, PLAIN)
  const expected = `STE ${scoreSte(PLAIN)!.score}%`
  expect(seen.statuses).toEqual([expected])
  expect(expected).toMatch(/^STE \d{1,3}%$/)
  await complete($, shortAnswer)
  expect(seen.statuses).toEqual([expected])
})

test('responseText reads only main conversation assistant text', () => {
  const row = (over: object, content: any[] = [{ type: 'text', text: 'Hello there.' }]) =>
    ({ door: 'response', message: { type: 'assistant', content }, ...over }) as any
  expect(responseText(row({}))).toBe('Hello there.')
  expect(responseText(row({}, [{ type: 'thinking' }, { type: 'text', text: 'A.' }, { type: 'tool_use' }, { type: 'text', text: 'B.' }]))).toBe('A.\n\nB.')
  expect(responseText(row({ door: 'tool-result' }))).toBe('')
  expect(responseText(row({ agentId: 'sub1' }))).toBe('')
  expect(responseText({ door: 'response', message: { type: 'user', content: [{ type: 'text', text: 'x' }] } } as any)).toBe('')
})
