export type Hit = { rule: string; match: string }
export type LintOptions = { shell?: boolean }

const RULES: [string, RegExp][] = [
  ['dash', /\u2014/],
  ['dash', / \u2013 /],
  ['dash', /(^|\s)--(?=\s|$)|\w--/],
  ['hyphen', /[A-Za-z]-[A-Za-z]/],
  ['hashtag', /(^|\s)#[A-Za-z]\w*/],
  ['emoji', /\p{Extended_Pictographic}/u],
  ['profanity', /\bfuck\w*/],
  ['contrast', /\bnot (just|only|merely|simply)\b/],
  ['contrast', /\bnot [^.,;:!?\n]{1,40}, (but|it'?s|they'?re|that'?s)\b/],
  ['contrast', /\b(it'?s|that'?s|this is|they'?re) not [^.!?\n]{1,40}[.;] (it'?s|that'?s|this is|they'?re)\b/],
  ['contrast', /, not (a |an |the )?[a-z]+/],
  ['contrast', /\brather than\b/],
  ['contrast', /\binstead of\b/],
  ['contrast', /\bmatters? more than\b/],
  ['contrast', /\bmore than just\b/],
  ['contrast', /\bwins over\b/],
  ['contrast', /\bwins because\b/],
  ['contrast', /\b(always|still|quietly) (wins?|beats?)\b/],
  ['contrast', /\bwill always beat\b/],
  ['contrast', /\bbeats (giving|having|being|doing|a|an|the)\b/],
  ['template', /\bis the product\b/],
  ['template', /\bthe moat\b/],
  ['template', /\bwas never (the|about)\b/],
  ['template', /\bthat'?s what makes\b/],
  ['template', /\bis what (keeps|makes|separates|kills|matters)\b/],
  ['template', /\bthe real (edge|unlock|win|question|problem|work|lesson|story|moat|game)\b/],
  ['template', /\bhere'?s the thing\b/],
  ['template', /\bthe craft is\b/],
  ['template', /\bthe hard part\b/],
  ['template', /\bwhere the time goes\b/],
  ['template', /\bheavy lifting\b/],
  ['template', /\bdoing all the (\w+ )?work\b/],
  ['template', /\bis carrying\b/],
  ['template', /\bcarrying the (whole|entire)\b/],
  ['template', /\btreat it like one\b/],
  ['template', /\blet that sink in\b/],
  ['template', /\bthe lesson\?/],
  ['template', /\bkey takeaway\b/],
  ['template', /\bhere'?s what i learned\b/],
  ['template', /\bthe best part\?/],
  ['template', /\bgame ?changer\b/],
  ['template', /\bin today'?s\b/],
  ['template', /\bit'?s worth noting\b/],
  ['template', /\blet'?s dive\b/],
  ['template', /\bhard to fake\b/],
  ['template', /\bthis is why\b/],
  ['template', /\bwins? the math\b/],
  ['template', /\blesson for (anyone|everyone)\b/],
  ['template', /\bthe part i('?d| would)? (like|love|copy)\b/],
  ['template', /\bsave yourself the\b/],
  ['template', /\bexcited to share\b/],
  ['template', /\bhumbled\b/],
  ['template', /(^|\n)\s*(agree|thoughts)\?\s*$/m],
  ['verdict', /\breal traction\b/],
  ['verdict', /\breal validation\b/],
  ['verdict', /\bis brutal\b/],
  ['verdict', /\bsmart (way|move)\b/],
  ['verdict', /\bthe right (split|call|move)\b/],
  ['verdict', /\bsharp framing\b/],
  ['verdict', /\bno.?brainer\b/],
  ['verdict', /\bis huge\b/],
  ['advice', /\bnow figure out\b/],
  ['advice', /\bthe question is whether\b/],
  ['advice', /\bnow the question\b/],
  ['advice', /\bdouble down\b/],
  ['word', /\bleverage[ds]?\b/],
  ['word', /\bcompound(s|ing|ed)?\b/],
  ['word', /\bmoats?\b/],
  ['word', /\btraction\b/],
  ['word', /\bintentional(ly)?\b/],
  ['word', /\bcraft\b/],
  ['word', /\bdifferentiator\b/],
  ['word', /\bfundamentally\b/],
  ['word', /\bultimate\b/],
  ['word', /\bquietly\b/],
  ['word', /\blandscape\b/],
  ['word', /\bdelve\b/],
  ['word', /\btapestry\b/],
  ['word', /\btestament\b/],
  ['word', /\bpivotal\b/],
  ['word', /\bcrucial\b/],
  ['word', /\bseamless(ly)?\b/],
  ['word', /\brobust\b/],
  ['word', /\belevate\b/],
  ['word', /\bempower\b/],
  ['word', /\bdistribution engine\b/],
  ['word', /\bsynergy\b/],
  ['word', /\bat scale\b/],
  ['word', /\bnext level\b/],
  ['word', /\blevel up\b/],
  ['word', /\bROI\b/],
  ['word', /\bthe (real |biggest )?unlock\b/],
]

const LOL = /\blol\b/gi

function strip(text: string, shell: boolean): string {
  const base = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/@\w+/g, ' ')
  return base
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s*$/.test(tok)) return tok
      if (/[\/\\~]/.test(tok) || /\w+\.\w{2,}/.test(tok)) return ' '
      // In a shell command, bare flags, file names, owner:branch and --key=value ("-p", "social-media-posts") are not prose.
      if (shell && /^[\w.:=-]+$/.test(tok) && tok.includes('-')) return ' '
      return tok
    })
    .join('')
}

export function lint(text: string, opts: LintOptions = {}): Hit[] {
  const clean = strip(text, opts.shell === true)
  const hits: Hit[] = []
  const seen = new Set<string>()
  const add = (rule: string, raw: string) => {
    const match = raw.trim().slice(0, 60)
    const key = `${rule}\u0000${match.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ rule, match })
  }
  for (const [rule, re] of RULES) {
    const flags = re.flags.includes('i') ? re.flags : `${re.flags}i`
    const m = new RegExp(re.source, flags).exec(clean)
    if (m) add(rule, m[0])
  }
  const lols = clean.match(LOL)
  if (lols && lols.length > 1) add('lol', `lol x${lols.length} in one text`)
  return hits
}

export function hasLol(text: string): boolean {
  return /\blol\b/i.test(text)
}
