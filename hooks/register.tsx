import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Diff, DiffRow, Stats } from '../types'

const PANE = 'netrunner-deck'
const TITLE = 'Netrunner Deck'
// The dock is capped at 45% of the terminal; asking for more than any terminal has gets that cap.
const OPEN = { id: PANE, title: TITLE, columns: 1000 } as const

// Night-city palette (matches the night-city skin).
const C = {
  frame: '#fcee0a',
  text: '#e6f7f5',
  muted: '#7fb8b4',
  live: '#05ffa1',
  current: '#fcee0a',
  dead: '#ff003c',
  add: '#05ffa1',
  del: '#ff2a6d',
  haiku: '#05ffa1',
  sonnet: '#02d7f2',
  opus: '#ff2a6d',
  fable: '#b967ff',
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const KEEP_DONE = 4
const MIN_DIFF_LINES = 8
const SHOW_DONE = 3
const HIST = 24

const cards = atom({ plugin: 'netrunner-deck', key: 'cards' } as const, [] as Card[], { shape: 'cards-1' })
const now = atom({ plugin: 'netrunner-deck', key: 'now' } as const, 0)
const diff = atom({ plugin: 'netrunner-deck', key: 'diff' } as const, null as Diff | null, { shape: 'diff-1' })
const sfx = atom({ plugin: 'netrunner-deck', key: 'sfx' } as const, true)
const stats = atom({ plugin: 'netrunner-deck', key: 'stats' } as const, null as Stats | null, { shape: 'stats-1' })

type Sample = { cpu: number; ram: number; gpu: number; cores: number; t: number }

/** CPU % of the whole machine between two samples (cpu in 100ns ticks, t in ms). */
export function cpuPct(a: Sample, b: Sample): number {
  const wall = (b.t - a.t) * 1e4 * Math.max(1, b.cores)
  return wall > 0 ? Math.max(0, Math.round(((b.cpu - a.cpu) / wall) * 1000) / 10) : 0
}

export function spark(hist: number[]): string {
  const bars = '▁▂▃▄▅▆▇█'
  const max = Math.max(5, ...hist)
  return hist.map(v => bars[Math.min(7, Math.round((v / max) * 7))]).join('')
}

function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)}G` : `${Math.round(bytes / 1e6)}M`
}

// One sampler per loaded module; it dies with the module (reload / session end).
let sampling = false

function startSampler($: EngineInterface) {
  if (sampling) return
  sampling = true
  void (async () => {
    let buf = ''
    let prev: Sample | undefined
    try {
      const child = $.process.spawn({
        argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          `${$.plugin.root}\\bin\\stats.ps1`],
      })
      for await (const { stream, text } of child) {
        if (stream !== 'stdout') continue
        const lines = (buf + text).split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const line of lines) {
          let s: Sample
          try {
            s = JSON.parse(line) as Sample
          } catch {
            continue
          }
          const p = prev
          prev = s
          if (!p) continue
          const cpu = cpuPct(p, s)
          await update($, stats, old => ({ cpu, ram: s.ram, gpu: s.gpu, hist: [...(old?.hist ?? []), cpu].slice(-HIST) }))
        }
      }
    } catch {
      // no sampler: the header just shows no stats
    } finally {
      sampling = false
    }
  })()
}

// Key points and questions, pulled out of a reply so they can be drawn as callouts.
export type Seg = { kind: 'md' | 'key' | 'ask'; text: string }
const KEY_RE = /^\s*(?:[-*]\s+)?\*{0,2}key(?: ?points?)?\*{0,2}:\*{0,2}\s+/i

export function segments(text: string): Seg[] {
  const out: Seg[] = []
  let fence = false
  const push = (kind: Seg['kind'], line: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += '\n' + line
    else out.push({ kind, text: line })
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) fence = !fence
    if (!fence && KEY_RE.test(line)) push('key', line.replace(KEY_RE, ''))
    else if (!fence && t.length >= 10 && /\?\**$/.test(t) && !/^[|#>`]/.test(t)) push('ask', t)
    else push('md', line)
  }
  return out.map(s => ({ ...s, text: s.text.trim() })).filter(s => s.text !== '')
}

const HIGHLIGHT_RULE = [
  '# Highlights',
  "The person's terminal highlights two kinds of line, so they can focus on what matters:",
  '- For the 1-3 points they must not miss, write each on its own line starting with `Key: `.',
  '- When you need an answer or decision from them, put each question on its own line ending with `?`.',
  'Use these only for genuinely important points and real questions; do not end other lines with `?`.',
].join('\n')

export function tier(model: string): { label: string; color: string } {
  const m = model.toLowerCase()
  for (const t of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
    if (m.includes(t)) return { label: t.toUpperCase(), color: C[t] }
  }
  return { label: (model || 'INHERIT').toUpperCase().slice(0, 10), color: C.muted }
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// One short line saying what a tool call is about.
export function describe(e: Record<string, unknown>): string {
  const pick = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'skill', 'notebook_path', 'path']
  for (const k of pick) {
    const v = e[k]
    if (typeof v === 'string' && v.trim()) return `${e.tool} ${v.replace(/\s+/g, ' ').trim()}`
  }
  return String(e.tool)
}

function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

// Line diff (LCS) laid out side by side: removed lines pair up with added ones.
// ponytail: O(n*m) LCS capped at 300 lines a side; swap for Myers if edits get bigger.
export function sideBySide(before: string, after: string): { rows: DiffRow[]; added: number; removed: number } {
  const a = before === '' ? [] : before.replace(/\t/g, '  ').split(/\r?\n/).slice(0, 300)
  const b = after === '' ? [] : after.replace(/\t/g, '  ').split(/\r?\n/).slice(0, 300)
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)

  const rows: DiffRow[] = []
  let dels: string[] = []
  let ins: string[] = []
  let added = 0
  let removed = 0
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, ins.length); k++) rows.push({ k: 'chg', l: dels[k] ?? '', r: ins[k] ?? '' })
    dels = []
    ins = []
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush()
      rows.push({ k: 'eq', l: a[i]!, r: b[j]! })
      i++
      j++
    } else if (j < b.length && (i >= a.length || L[i]![j + 1]! >= L[i + 1]![j]!)) {
      ins.push(b[j++]!)
      added++
    } else {
      dels.push(a[i++]!)
      removed++
    }
  }
  flush()

  // Keep one line of context around changes; fold the rest into gaps.
  const keep = rows.map((r, n) => r.k !== 'eq' || rows[n - 1]?.k === 'chg' || rows[n + 1]?.k === 'chg')
  const out: DiffRow[] = []
  rows.forEach((r, n) => {
    if (keep[n]) out.push(r)
    else if (out[out.length - 1]?.k !== 'gap') out.push({ k: 'gap', l: '', r: '' })
  })
  return { rows: out, added, removed }
}

/**
 * Lays diff rows out as screen lines `side` columns wide: shared indentation removed,
 * long lines wrapped (never cut). Each line is [left, right, kind]; at most `max` lines.
 */
export function layout(rows: DiffRow[], side: number, max: number): { lines: [string, string, DiffRow['k']][]; more: number } {
  const lead = (s: string) => (s.trim() ? s.length - s.trimStart().length : Infinity)
  const cut0 = Math.min(...rows.flatMap(r => [lead(r.l), lead(r.r)]))
  const strip = Number.isFinite(cut0) ? cut0 : 0
  const wrap = (s: string) => {
    const t = s.slice(Math.min(strip, lead(s)))
    const out: string[] = []
    for (let i = 0; i < t.length; i += side) out.push(t.slice(i, i + side))
    return out.length ? out : ['']
  }
  const lines: [string, string, DiffRow['k']][] = []
  let more = 0
  for (const r of rows) {
    if (r.k === 'gap') {
      if (lines.length < max) lines.push(['  ⋯', '  ⋯', 'gap'])
      else more++
      continue
    }
    const L = wrap(r.l)
    const R = wrap(r.r)
    for (let k = 0; k < Math.max(L.length, R.length); k++) {
      if (lines.length < max) lines.push([L[k] ?? '', R[k] ?? '', r.k])
      else more++
    }
  }
  return { lines, more }
}

function play($: EngineInterface, name: 'jackin' | 'done' | 'fail') {
  void read($, sfx).then(enabled => {
    if (!enabled) return
    // Single-quoted PowerShell string: the path is taken literally ('' escapes a quote).
    const wav = `${$.plugin.root}\\fx\\${name}.wav`.replace(/'/g, "''")
    const cmd = `(New-Object Media.SoundPlayer '${wav}').PlaySync()`
    return $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', cmd], { timeoutMs: 5000 })
  }).catch(() => undefined)
}

// ponytail: one module-level ticker; restarts on reload only when an agent next spawns.
let ticker: { cancel: () => void } | undefined

function startTicker($: EngineInterface) {
  if (ticker) return
  ticker = $.clock.every(1000, async () => {
    const t = await $.clock.now()
    await update($, now, () => t)
    const list = await read($, cards)
    if (!list.some(c => c.end === undefined)) {
      ticker?.cancel()
      ticker = undefined
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'deck', description: 'Open the Netrunner Deck: live view of what subagents are doing' })
    await $.command.register({ name: 'deck-sfx', description: 'Turn Netrunner Deck sound effects on or off' })
    void $.ui.open(OPEN)
    startSampler($)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (e.traits.includes('bare')) return r
    return { sections: [...r.sections, { id: 'netrunner-deck:highlights', text: HIGHLIGHT_RULE, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const p = e.props
    if (!p || p.isSummary) return next(e)
    const segs = segments(p.text)
    if (!segs.some(s => s.kind !== 'md')) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const callout = (s: Seg) => (
      <Box flexDirection="column" borderStyle="round" borderColor={s.kind === 'ask' ? C.frame : C.del} paddingX={1} marginLeft={2}>
        <Text color={s.kind === 'ask' ? C.frame : C.del} bold>{s.kind === 'ask' ? '? YOUR CALL' : '◆ KEY'}</Text>
        <Markdown text={s.text} />
      </Box>
    )
    const [first, ...rest] = segs as [Seg, ...Seg[]]
    // The first text block goes through the engine so the reply keeps its bullet.
    const head = first.kind === 'md' ? await next({ ...e, props: { ...p, text: first.text } }) : callout(first)
    return (
      <Box flexDirection="column">
        {head}
        {rest.map(s =>
          s.kind === 'md' ? (
            <Box paddingLeft={2} marginTop={1}>
              <Markdown text={s.text} />
            </Box>
          ) : (
            callout(s)
          ),
        )}
      </Box>
    )
  })

  on('command.run', { command: 'deck' }, async $ => {
    const r = await $.ui.open(OPEN)
    return { text: r.isPlaced ? 'Netrunner Deck online.' : 'Netrunner Deck is waiting for a wider window.' }
  })

  on('command.run', { command: 'deck-sfx' }, async $ => {
    const enabled = await update($, sfx, v => !v)
    if (enabled) play($, 'jackin')
    return { text: enabled ? 'Deck sound effects on.' : 'Deck sound effects off.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if (!('agentId' in res) || !res.agentId) return res
    const t = await $.clock.now()
    const id = res.agentId
    const card: Card = {
      id,
      type: e.name ? `${e.subagentType}:${e.name}` : e.subagentType,
      desc: e.description,
      model: res.model,
      start: t,
      recent: [],
    }
    await update($, now, () => t)
    await update($, cards, list => {
      const rest = list.filter(c => c.id !== id)
      const done = rest.filter(c => c.end !== undefined).slice(-KEEP_DONE)
      return [...rest.filter(c => c.end === undefined), ...done, card]
    })
    play($, 'jackin')
    startTicker($)
    return res
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const line = describe(e as unknown as Record<string, unknown>)
      await update($, cards, list => list.map(c => (c.id === id ? { ...c, current: line } : c)))
    }
    const ran = await next(e)
    if (id) {
      await update($, cards, list =>
        list.map(c => (c.id === id ? { ...c, current: undefined, recent: [...c.recent, String(e.tool)].slice(-6) } : c)),
      )
    }
    // Latest file change from anyone (main session or a subagent) goes to the diff view.
    if (e.tool === 'Edit' || e.tool === 'Write') {
      const before = e.tool === 'Edit' ? e.old_string : ''
      const after = e.tool === 'Edit' ? e.new_string : e.content
      const d = sideBySide(before, after)
      const who = id ? ((await read($, cards)).find(c => c.id === id)?.type ?? 'agent') : 'main'
      const file = e.file_path.split(/[\\/]/).pop() ?? e.file_path
      await update($, diff, () => ({ file, who, ...d }))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const t = await $.clock.now()
      let ended: Card | undefined
      await update($, cards, list =>
        list.map(c => {
          if (c.id !== id || c.end !== undefined) return c
          ended = { ...c, end: t, aborted: e.isAborted, current: undefined }
          return ended
        }),
      )
      if (ended) {
        const verb = ended.aborted ? '✗ flatlined' : '✓ jacked out'
        void $.ui.toast(`${verb}: ${ended.type} · ${clock(t - ended.start)}`)
        play($, ended.aborted ? 'fail' : 'done')
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, cards)
    const t = await read($, now)
    const d = await read($, diff)
    const st = await read($, stats)
    const width = Math.max(24, (e.props?.bodyColumns ?? 40) - 2)
    const side = Math.max(8, Math.floor((width - 3) / 2))
    const live = list.filter(c => c.end === undefined)
    const spin = SPIN[Math.floor(t / 1000) % SPIN.length]
    const pad = (s: string) => cut(s, side).padEnd(side)
    const finished = list.filter(c => c.end !== undefined).slice(-SHOW_DONE).reverse()
    // The diff gets whatever height the deck leaves (deck: border+header+stats, 5 per live card, 1 per finished).
    const deckRows = 4 + (st ? 1 : 0) + live.length * 5 + (finished.length ? finished.length + 1 : 0)
    const bodyRows = e.props?.scroll?.bodyRows ?? 30
    const dl = d ? layout(d.rows, side, Math.max(MIN_DIFF_LINES, bodyRows - deckRows - 6)) : { lines: [], more: 0 }

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="double" borderColor={C.frame}>
          <Box justifyContent="space-between">
            <Text color={C.frame} bold>◢ NETRUNNER DECK</Text>
            <Text color={live.length ? C.live : C.muted}>{live.length} live</Text>
          </Box>
          {st && (
            <Text>
              <Text color={C.sonnet} bold>CPU {st.cpu.toFixed(1)}% </Text>
              <Text color={C.sonnet}>{spark(st.hist)}</Text>
              <Text color={C.fable} bold>  RAM {size(st.ram)}</Text>
              <Text color={C.haiku} bold>  GPU {st.gpu < 0 ? '–' : `${Math.round(st.gpu)}%`}</Text>
            </Text>
          )}
          {list.length === 0 && <Text color={C.muted}>No subagents jacked in. Waiting for a run…</Text>}
          {live.map(c => {
            const tr = tier(c.model)
            return (
              <Box flexDirection="column" marginTop={1}>
                <Box justifyContent="space-between">
                  <Text>
                    <Text color={tr.color} bold>◢ {cut(c.type, width - 20)} </Text>
                    <Text color={tr.color}>[{tr.label}]</Text>
                  </Text>
                  <Text color={C.text}>{clock(t - c.start)}</Text>
                </Box>
                <Text color={C.text}>  {cut(c.desc, width - 2)}</Text>
                <Text color={C.current}>
                  {'  '}{c.current ? `▸ ${cut(c.current, width - 6)} ${spin}` : `${spin} thinking…`}
                </Text>
                {c.recent.length > 0 && (
                  <Text color={C.muted}>{'  '}{cut(c.recent.map(r => `✓ ${r}`).join('  '), width - 2)}</Text>
                )}
              </Box>
            )
          })}
          {finished.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {finished.map(c => {
                const tr = tier(c.model)
                const tail = ` ${clock((c.end ?? t) - c.start)}`
                return (
                  <Text>
                    <Text color={c.aborted ? C.dead : C.muted}>{c.aborted ? '✗ ' : '✓ '}</Text>
                    <Text color={tr.color} dimColor>[{tr.label}] </Text>
                    <Text color={C.muted}>{cut(`${c.type} · ${c.desc}`, width - tr.label.length - tail.length - 6)}{tail}</Text>
                  </Text>
                )
              })}
            </Box>
          )}
        </Box>

        {d && (
          <Box flexDirection="column" borderStyle="single" borderColor={C.del} marginTop={1}>
            <Box justifyContent="space-between">
              <Text color={C.frame} bold>◢ DIFF {cut(d.file, width - 24)}</Text>
              <Text>
                <Text color={C.add}>+{d.added} </Text>
                <Text color={C.del}>-{d.removed}</Text>
              </Text>
            </Box>
            <Text color={C.muted}>{cut(`by ${d.who}`, width)}</Text>
            <Text>
              <Text color={C.del} bold>{pad('BEFORE')}</Text>
              <Text color={C.muted}> │ </Text>
              <Text color={C.add} bold>{pad('AFTER')}</Text>
            </Text>
            {dl.lines.map(([l, r, k]) => (
              <Text>
                <Text color={k === 'chg' ? C.del : C.muted}>{pad(l)}</Text>
                <Text color={C.muted}> │ </Text>
                <Text color={k === 'chg' ? C.add : C.muted}>{pad(r)}</Text>
              </Text>
            ))}
            {dl.more > 0 && <Text color={C.muted}>… {dl.more} more lines</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
