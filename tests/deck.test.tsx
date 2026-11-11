import { expect, test } from 'claude-code/testing'

import { cpuPct, layout, running, segments, spark } from '../hooks/register'

test('long diff lines wrap instead of being cut, shared indent removed', async () => {
  const { lines, more } = layout([{ k: 'chg', l: '    abcdefghij', r: '    xyz' }], 4, 10)
  expect(lines.map(x => x.slice(0, 2).join('|')).join(',')).toBe('abcd|xyz,efgh|,ij|')
  expect(more).toBe(0)
  expect(layout([{ k: 'chg', l: 'abcdefgh', r: '' }], 2, 3).more).toBe(1)
})

test('cpu % and sparkline math', async () => {
  // 12 cores, 1 s wall, 6 core-seconds of cpu = 50%
  expect(cpuPct({ cpu: 0, ram: 0, gpu: 0, cores: 12, t: 0 }, { cpu: 6e7, ram: 0, gpu: 0, cores: 12, t: 1000 })).toBe(50)
  expect(cpuPct({ cpu: 9, ram: 0, gpu: 0, cores: 12, t: 0 }, { cpu: 1, ram: 0, gpu: 0, cores: 12, t: 1000 })).toBe(0)
  expect(spark([0, 10, 20])).toBe('▁▅█')
})

test('running line lists only what is in flight', async () => {
  expect(running(null)).toBe('')
  expect(running({ agents: 0, shells: 0, monitors: 0, other: 0, crons: 0, t: 0 })).toBe('')
  expect(running({ agents: 3, shells: 1, monitors: 0, other: 0, crons: 1, t: 0 })).toBe('3 agents · 1 shell · 1 loop')
})

test('key points and questions are split out, code fences left alone', async () => {
  const segs = segments([
    'Done with the deck.',
    'Key: the sampler runs every 3 s.',
    '```',
    'is this a question?',
    '```',
    'Want me to copy it to the installed mod?',
  ].join('\n'))
  expect(segs.map(s => s.kind).join(',')).toBe('md,key,md,ask')
  expect(segs[1]!.text).toBe('the sampler runs every 3 s.')
})

test('a reply with a question draws a callout', async ($, on) => {
  const ui = await $.ui.mount({
    plugin: 'netrunner-deck', component: 'AssistantMessage', surface: 'terminal',
    props: { text: 'All set.\n\nShould I deploy it now?', isFirstOfReply: true },
  } as never)
  expect((await ui.find({ type: 'Text', text: /YOUR CALL/ }))?.text).toContain('YOUR CALL')
  await ui.unmount()
})

const PANE = {
  plugin: 'netrunner-deck',
  component: 'Pane',
  requestId: 'netrunner-deck',
  props: {
    title: 'Netrunner Deck',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a subagent shows up live, then as jacked out', async ($, on) => {
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))

  await $.agent.spawn({
    tool_use_id: 't1', prompt: 'find it', description: 'find statusline config',
    subagentType: 'tier-light', parentModel: 'claude-opus-5-5', background: false, fork: false,
  } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'statusLine', agentId: 'a1' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /tier-light/ }))?.text).toContain('tier-light')
  expect((await ui.find({ type: 'Text', text: /HAIKU/ }))?.text).toContain('[HAIKU]')
  expect((await ui.find({ type: 'Text', text: /find statusline config/ }))?.text).toContain('find statusline config')
  expect((await ui.find({ type: 'Text', text: /✓ Grep/ }))?.text).toContain('✓ Grep')
  expect((await ui.find({ type: 'Text', text: /1 live/ }))?.text).toBe('1 live')
  await ui.unmount()

  await $.turn.complete({ agentId: 'a1', answer: 'done', durationMs: 1000, isAborted: false, turnId: 'x' } as never)
  const ui2 = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui2.find({ type: 'Text', text: /live/ }))?.text).toBe('0 live')
  await ui2.unmount()
})

test('an Edit shows as a side-by-side diff under the deck', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))

  await $.tool.call({
    tool: 'Edit', file_path: 'C:\\x\\app.lua',
    old_string: 'local a = 1\nlocal b = 2\nreturn a', new_string: 'local a = 1\nlocal b = 3\nlocal c = 4\nreturn a',
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /DIFF app\.lua/ }))?.text).toContain('app.lua')
  expect((await ui.find({ type: 'Text', text: /^\+2 $/ }))?.text).toBe('+2 ')
  expect((await ui.find({ type: 'Text', text: /^-1$/ }))?.text).toBe('-1')
  expect((await ui.find({ type: 'Text', text: /local b = 2/ }))?.text).toContain('local b = 2')
  expect((await ui.find({ type: 'Text', text: /local b = 3/ }))?.text).toContain('local b = 3')
  await ui.unmount()
})
