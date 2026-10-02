// Pure STE style scoring. It measures style only: sentence length, passive
// voice and word length. The official ASD-STE100 dictionary is not used.

export type SteScore = { score: number; sentences: number; words: number }

const MIN_WORDS = 40
const MAX_SENTENCE_WORDS = 20
const MAX_WORD_LENGTH = 12
const PASSIVE = /\b(am|is|are|was|were|be|been|being)\s+(\w+ly\s+)?\w+(ed|en)\b/i
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

/** Prose sentences of a markdown answer: code, tables, headings, URLs and blank lines dropped. */
export function proseSentences(text: string): string[] {
  const noFences = text.replace(/```[\s\S]*?(?:```|$)/g, '\n')
  const blocks: string[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length > 0) blocks.push(buf.join(' '))
    buf = []
  }
  for (const raw of noFences.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('|') || trimmed.startsWith('#')) {
      flush()
      continue
    }
    const line = trimmed.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')
    const body = line.replace(LIST_ITEM, '').trim()
    if (body === '') {
      flush()
      continue
    }
    if (LIST_ITEM.test(trimmed)) {
      flush()
      blocks.push(body)
    } else {
      buf.push(body)
    }
  }
  flush()
  const sentences: string[] = []
  for (const block of blocks) {
    for (const part of block.split(/(?<=[.!?])\s+/)) {
      if (wordsOf(part).length > 0) sentences.push(part.trim())
    }
  }
  return sentences
}

function wordsOf(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(w => w !== '')
}

/** Number of prose words in an answer, by the same rules as the score. */
export function proseWordCount(text: string): number {
  return proseSentences(text).reduce((n, s) => n + wordsOf(s).length, 0)
}

export function scoreSte(text: string): SteScore | undefined {
  const sentences = proseSentences(text)
  const lengths = sentences.map(s => wordsOf(s))
  const words = lengths.reduce((n, w) => n + w.length, 0)
  if (words < MIN_WORDS) return undefined
  const count = sentences.length
  const short = lengths.filter(w => w.length <= MAX_SENTENCE_WORDS).length
  const active = sentences.filter(s => !PASSIVE.test(s)).length
  const plain = lengths.reduce((n, w) => n + w.filter(x => x.length <= MAX_WORD_LENGTH).length, 0)
  const score = Math.round(100 * (0.6 * (short / count) + 0.25 * (active / count) + 0.15 * (plain / words)))
  return { score, sentences: count, words }
}

export function statusText(score: number): string {
  return `STE ${score}%`
}
