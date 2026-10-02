import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { BUTTON_LABELS, DESCRIPTIONS, RUNGS, buildAsk, responseText } from './ladder'
import { proseWordCount, scoreSte, statusText } from './ste'

const BAND_MIN_WORDS = 120

const isShown = atom({ plugin: 'output-ladder', key: 'isShown' } as const, false)

export const register: Register = on => {
  // Text of the latest turn's answer. A turn can append several messages.
  let answer = ''
  let isFresh = true

  on('session.start', async ($, e, next) => {
    try {
      for (const rung of RUNGS) {
        await $.command.register({
          name: rung,
          description: DESCRIPTIONS[rung],
          argumentHint: rung === 'ste' ? '[full] [extra instruction]' : '[extra instruction]',
        })
      }
    } catch {}
    return next(e)
  })

  for (const rung of RUNGS) {
    on('command.run', { command: rung }, async ($, e) => {
      const ask = buildAsk(rung, e.args)
      await update($, isShown, () => false)
      // The engine refuses a submit from inside command.run (it would wait on
      // this very hook), so the prompt is queued right after the hook returns.
      $.clock.after(0, () => {
        void $.prompt.submit({ text: ask.text, asUser: true })
      })
      return { text: ask.reply }
    })
  }

  on('session.append', ($, e, next) => {
    try {
      const text = responseText(e)
      if (text !== '') {
        answer = isFresh ? text : `${answer}\n\n${text}`
        isFresh = false
      }
    } catch {}
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    answer = ''
    isFresh = true
    await update($, isShown, () => false)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined && e.reason === 'answer') {
        // Rows seen by session.append; the turn's final text is the fallback.
        const text = answer !== '' ? answer : e.answer
        answer = ''
        isFresh = true
        const scored = scoreSte(text)
        if (scored) $.ui.status(statusText(scored.score))
        await update($, isShown, () => proseWordCount(text) >= BAND_MIN_WORDS)
      }
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>Explain it another way: </Text>
        <Button
          key="ste"
          label={BUTTON_LABELS.ste}
          onPress={async () => {
            await update($, isShown, () => false)
            await $.prompt.submit({ text: buildAsk('ste').text, asUser: true })
          }}
        />
        <Button
          key="diagram"
          label={BUTTON_LABELS.diagram}
          onPress={async () => {
            await update($, isShown, () => false)
            await $.prompt.submit({ text: buildAsk('diagram').text, asUser: true })
          }}
        />
        <Button
          key="page"
          label={BUTTON_LABELS.page}
          onPress={async () => {
            await update($, isShown, () => false)
            await $.prompt.submit({ text: buildAsk('page').text, asUser: true })
          }}
        />
        <Button
          key="video"
          label={BUTTON_LABELS.video}
          onPress={async () => {
            await update($, isShown, () => false)
            await $.prompt.submit({ text: buildAsk('video').text, asUser: true })
          }}
        />
      </Box>
    )
  })
}
