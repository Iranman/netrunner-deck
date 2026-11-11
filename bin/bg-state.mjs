// Stop / SubagentStop hook: records this session's in-flight background work so
// WezTerm (safe close) and the Netrunner Deck can show it. Never blocks.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let raw = ''
process.stdin.on('data', d => (raw += d))
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(raw)
    if (!e.session_id || !Array.isArray(e.background_tasks)) return
    const count = t => e.background_tasks.filter(x => x.type === t).length
    const dir = join(homedir(), '.claude', 'state', 'bg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${e.session_id}.json`), JSON.stringify({
      cwd: e.cwd,
      agents: count('subagent'),
      shells: count('shell'),
      monitors: count('monitor'),
      other: e.background_tasks.length - count('subagent') - count('shell') - count('monitor'),
      crons: (e.session_crons ?? []).length,
      t: Date.now(),
    }))
  } catch {}
})
