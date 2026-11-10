export type Card = {
  id: string
  type: string
  desc: string
  model: string
  start: number
  end?: number
  aborted?: boolean
  current?: string
  recent: string[]
}

/** One side-by-side row: unchanged context, a change (either side may be empty), or a skipped gap. */
export type DiffRow = { k: 'eq' | 'chg' | 'gap'; l: string; r: string }

export type Diff = {
  file: string
  who: string
  added: number
  removed: number
  rows: DiffRow[]
}

/** Session resource use: cpu % of the whole machine, ram bytes, gpu % (-1 unknown), cpu history. */
export type Stats = { cpu: number; ram: number; gpu: number; hist: number[] }

declare module 'claude-code' {
  interface PluginState {
    'netrunner-deck': {
      cards: Shaped<Card[]>
      now: number
      diff: Shaped<Diff | null>
      sfx: boolean
      stats: Shaped<Stats | null>
    }
  }
}
