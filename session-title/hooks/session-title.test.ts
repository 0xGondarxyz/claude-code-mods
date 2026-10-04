import { test, expect } from 'claude-code/testing'
import { buildPrompt, cleanTitle, lastAssistantText, userPrompts, type Row } from './title'

test('cleanTitle strips quotes, label, dashes, trailing period', () => {
  expect(cleanTitle('"ASO research"')).toBe('ASO research')
  expect(cleanTitle('`Poki game`')).toBe('Poki game')
  expect(cleanTitle('**Poki game**')).toBe('Poki game')
  expect(cleanTitle('Title: ASO research')).toBe('ASO research')
  expect(cleanTitle('TITLE:  "ASO research".')).toBe('ASO research')
  expect(cleanTitle('Session overview — title mod')).toBe('Session overview title mod')
  expect(cleanTitle('A – B -- C')).toBe('A B C')
  expect(cleanTitle('ASO research.')).toBe('ASO research')
  expect(cleanTitle('Session overview + title mod')).toBe('Session overview + title mod')
})

test('cleanTitle takes the first non-empty line', () => {
  expect(cleanTitle('\n\n  YouTube API upload  \nsecond line')).toBe('YouTube API upload')
})

test('cleanTitle cuts long input on a word boundary', () => {
  const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu'
  const out = cleanTitle(long)!
  expect(out.length).toBeLessThanOrEqual(60)
  expect(long.startsWith(out)).toBe(true)
  expect(out.endsWith(' ')).toBe(false)
  expect(out).toBe('alpha beta gamma delta epsilon zeta eta theta iota kappa')
  expect(cleanTitle('x'.repeat(100))).toBe('x'.repeat(60))
})

test('cleanTitle returns undefined when empty', () => {
  expect(cleanTitle('')).toBeUndefined()
  expect(cleanTitle('  \n ')).toBeUndefined()
  expect(cleanTitle('""')).toBeUndefined()
  expect(cleanTitle('Title:')).toBeUndefined()
  expect(cleanTitle('.')).toBeUndefined()
})

test('userPrompts skips empty and angle-bracket rows and assistant rows', () => {
  const rows: Row[] = [
    { role: 'user', text: '  first  ' },
    { role: 'user', text: '' },
    { role: 'user', text: '   ' },
    { role: 'user', text: '<system-reminder>x</system-reminder>' },
    { role: 'assistant', text: 'hello' },
    { role: 'user', text: '<task-notification>done</task-notification>' },
    { role: 'user', text: 'second' },
  ]
  expect(userPrompts(rows)).toEqual(['first', 'second'])
})

test('lastAssistantText finds the last non-empty assistant row', () => {
  const rows: Row[] = [
    { role: 'assistant', text: 'one' },
    { role: 'assistant', text: 'two' },
    { role: 'assistant', text: '' },
    { role: 'user', text: 'q' },
  ]
  expect(lastAssistantText(rows)).toBe('two')
  expect(lastAssistantText([{ role: 'user', text: 'q' }])).toBeUndefined()
})

test('buildPrompt truncates prompts to 300 and assistant text to 600', () => {
  const out = buildPrompt(['a'.repeat(400), 'b'.repeat(400)], 'c'.repeat(700))
  expect(out).toContain('a'.repeat(300))
  expect(out).not.toContain('a'.repeat(301))
  expect(out).toContain('b'.repeat(300))
  expect(out).not.toContain('b'.repeat(301))
  expect(out).toContain('c'.repeat(600))
  expect(out).not.toContain('c'.repeat(601))
})

test('buildPrompt uses first plus last 8 with no duplicate', () => {
  const ps = Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
  const out = buildPrompt(ps)
  expect(out).toContain('<first_prompt>P01</first_prompt>')
  expect(out).not.toContain('<prompt>P01</prompt>')
  expect(out).not.toContain('P04')
  for (const p of ['P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12']) expect(out).toContain(`<prompt>${p}</prompt>`)
  expect(out.match(/<prompt>/g)).toHaveLength(8)

  const short = buildPrompt(['one', 'two', 'three'])
  expect(short.match(/one/g)).toHaveLength(1)
  expect(short).toContain('<prompt>two</prompt>')
  expect(short).toContain('<prompt>three</prompt>')

  const single = buildPrompt(['only'])
  expect(single.match(/only/g)).toHaveLength(1)
  expect(single).not.toContain('<recent_prompts>')
})

test('buildPrompt includes current title, last assistant text and the data warning', () => {
  const out = buildPrompt(['hi', 'there'], 'did a thing', 'ASO research')
  expect(out).toContain('<current_title>ASO research</current_title>')
  expect(out).toContain('<last_assistant_reply>did a thing</last_assistant_reply>')
  expect(out).toContain('data')
  const bare = buildPrompt(['hi'])
  expect(bare).not.toContain('current_title')
  expect(bare).not.toContain('last_assistant_reply')
})
