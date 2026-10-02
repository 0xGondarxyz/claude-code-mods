import type { Card } from '../types'

export const KEEP = 5
export const MAX_AGE_MS = 14 * 24 * 3_600_000
export const IDLE_MS = 4 * 60_000
export const RECENT_MS = 30 * 60_000
export const TAIL_CHARS = 30_000
export const FIELD_MAX = 240

export const CARD_PROMPT = [
  'Write the save card for this session in exactly this 3 line format, plain text, no other text:',
  'Doing: <what the user and you were working on, concrete: files, feature, bug>',
  'Next: <the single next step>',
  'Open: <the open question or blocker, or "none">',
  'Each line under 110 characters.',
].join('\n')

export type Parsed = { doing: string; next: string; open: string }

const clip = (s: string) => (s.length > FIELD_MAX ? `${s.slice(0, FIELD_MAX - 1)}…` : s)

// Finds the three labelled lines, tolerating blank lines, bullets and bold marks.
// Doing and Next are required; a missing or empty Open is "none".
export function parseCard(text: string): Parsed | null {
  const pick = (label: string): string => {
    const re = new RegExp(`^[\\s>*_\\-]*${label}[*_]*\\s*:[*_]*\\s*(.*)$`, 'i')
    for (const line of text.split('\n')) {
      const m = re.exec(line)
      if (m) return m[1]!.replace(/[*_]+$/, '').trim()
    }
    return ''
  }
  const doing = pick('doing')
  const next = pick('next')
  if (doing === '' || next === '') return null
  return { doing: clip(doing), next: clip(next), open: clip(pick('open') || 'none') }
}

// Newest first, KEEP per repo. A newer card of the same session replaces the older one.
export function addCard(all: Record<string, Card[]>, card: Card): Record<string, Card[]> {
  const rest = (all[card.repo] ?? []).filter(c => c.sessionId !== card.sessionId)
  return { ...all, [card.repo]: [card, ...rest].sort((a, b) => b.savedAt - a.savedAt).slice(0, KEEP) }
}

export function ageText(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export const shortId = (id: string) => id.slice(0, 7)
export const resumeLine = (c: Card) => `full context: claude --resume ${c.sessionId}`
export const cardLines = (c: Card) => [`Doing: ${c.doing}`, `Next: ${c.next}`, `Open: ${c.open}`]
export const cardText = (c: Card) => cardLines(c).join('\n')
export const savedHeader = (c: Card, now: number) => `Saved ${ageText(now - c.savedAt)} (session ${shortId(c.sessionId)})`
export const continuePrompt = (c: Card) => `Continue where I stopped. Save card:\n${cardText(c)}`

export const saveReply = (c: Card) => `${cardText(c)}\n${resumeLine(c)}`

export function listText(cards: Card[], now: number): string {
  if (cards.length === 0) return 'save-game: no saved cards for this repo yet.'
  return cards
    .slice(0, KEEP)
    .map(c => [savedHeader(c, now), ...cardLines(c), resumeLine(c)].join('\n'))
    .join('\n\n')
}

export const isFresh = (c: Card, now: number) => now - c.savedAt < MAX_AGE_MS

export function projectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

// Local clock: the key of the night a 01:00 to 05:59 time belongs to, else null.
export function nightKey(ms: number): string | null {
  const d = new Date(ms)
  const h = d.getHours()
  if (h < 1 || h >= 6) return null
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// User prompts and assistant text only, last `max` chars, from the raw JSONL tail.
// The first line may be cut in half by the tail, so lines that do not parse are skipped.
export function tailFromJsonl(jsonl: string, max = TAIL_CHARS): string {
  const parts: string[] = []
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row || row.isMeta === true || row.isSidechain === true) continue
    const content = row.message?.content
    const text = Array.isArray(content)
      ? content
          .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text)
          .join('\n')
      : typeof content === 'string'
        ? content
        : ''
    if (text.trim() === '') continue
    if (row.type === 'user') parts.push(`User: ${text.trim()}`)
    else if (row.type === 'assistant') parts.push(`Assistant: ${text.trim()}`)
  }
  const all = parts.join('\n\n')
  return all.length > max ? all.slice(all.length - max) : all
}

export const transcriptPrompt = (tail: string) =>
  `Below is the end of a work session between a user and an AI coding assistant.\n\n<transcript>\n${tail}\n</transcript>\n\n${CARD_PROMPT}`
