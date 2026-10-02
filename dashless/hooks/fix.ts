// Em dash is written as a unicode escape so this file never contains the character.
const DASH = /[ \t]*(?:\u2014|(?<=[ \t])\u2013(?=[ \t]))[ \t]*/g

export function fixDashes(text: string): { text: string; count: number } {
  let count = 0
  const out = text.replace(DASH, (match, offset: number, whole: string) => {
    count++
    const next = whole[offset + match.length]
    if (offset === 0 || whole[offset - 1] === '\n') return match.match(/^[ \t]*/)![0]
    if (next === undefined || next === '\n' || next === '\r') return ''
    return /[,;:.(]/.test(whole[offset - 1] ?? '') ? ' ' : ', '
  })
  return count === 0 ? { text, count: 0 } : { text: out, count }
}
