// The progress bar styles, each drawn as runs of fill, track and frame text (claudepeeker's set).

import type { BarPref } from '../types'

export type BarPart = { kind: 'fill' | 'track' | 'frame'; text: string }

type Cells = { fill: string; track: string; open?: string; close?: string; head?: string }

export type BarStyle = {
  id: string
  name: string
  /** One glyph whatever the width: the width picker does not apply. */
  isGlyph?: boolean
  draw: (percent: number, width: number) => BarPart[]
}

/** Filled cells as the old script counted them: rounded, at least one above 0%. */
export function filledCells(percent: number, width: number): number {
  let filled = Math.floor((percent * width + 50) / 100)
  if (filled === 0 && percent > 0) filled = 1

  return Math.max(0, Math.min(filled, width))
}

function cells({ fill, track, open, close, head }: Cells): BarStyle['draw'] {
  return (percent, width) => {
    const filled = filledCells(percent, width)
    const parts: BarPart[] = []
    if (open) parts.push({ kind: 'frame', text: open })
    if (head && filled > 0 && filled < width) {
      parts.push({ kind: 'fill', text: fill.repeat(filled - 1) + head })
    } else {
      parts.push({ kind: 'fill', text: fill.repeat(filled) })
    }
    parts.push({ kind: 'track', text: track.repeat(width - filled) })
    if (close) parts.push({ kind: 'frame', text: close })

    return parts.filter(part => part.text !== '')
  }
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

function smooth(track: string): BarStyle['draw'] {
  return (percent, width) => {
    let eighths = Math.round((Math.min(percent, 100) * width * 8) / 100)
    if (eighths === 0 && percent > 0) eighths = 1
    const full = Math.floor(eighths / 8)
    const part = EIGHTHS[eighths % 8] ?? ''
    const rest = width - full - (part ? 1 : 0)

    return [
      { kind: 'fill' as const, text: '█'.repeat(full) + part },
      { kind: 'track' as const, text: track.repeat(Math.max(0, rest)) },
    ].filter(one => one.text !== '')
  }
}

function glyph(steps: string): BarStyle['draw'] {
  const list = [...steps]
  return percent => {
    const clamped = Math.max(0, Math.min(percent, 100))
    let at = Math.round((clamped / 100) * (list.length - 1))
    if (at === 0 && percent > 0) at = 1

    return [{ kind: 'fill', text: list[at] ?? '' }]
  }
}

export const STYLES: readonly BarStyle[] = [
  { id: 'blocks', name: 'Blocks', draw: cells({ fill: '█', track: '░' }) },
  { id: 'parallelogram', name: 'Parallelogram', draw: cells({ fill: '▰', track: '▱' }) },
  { id: 'shade', name: 'Shade', draw: cells({ fill: '▓', track: '░' }) },
  { id: 'solid', name: 'Solid track', draw: cells({ fill: '█', track: '█' }) },
  { id: 'smooth', name: 'Smooth', draw: smooth('░') },
  { id: 'smooth-bare', name: 'Smooth, bare', draw: smooth(' ') },
  { id: 'line', name: 'Line', draw: cells({ fill: '━', track: '─' }) },
  { id: 'dots', name: 'Dots', draw: cells({ fill: '●', track: '○' }) },
  { id: 'squares', name: 'Squares', draw: cells({ fill: '■', track: '□' }) },
  { id: 'diamonds', name: 'Diamonds', draw: cells({ fill: '◆', track: '◇' }) },
  { id: 'braille', name: 'Braille', draw: cells({ fill: '⣿', track: '⣀' }) },
  { id: 'ascii', name: 'ASCII', draw: cells({ fill: '#', track: '-', open: '[', close: ']' }) },
  { id: 'arrow', name: 'Arrow', draw: cells({ fill: '=', track: ' ', head: '>', open: '[', close: ']' }) },
  { id: 'pie', name: 'Pie', isGlyph: true, draw: glyph('○◔◑◕●') },
  { id: 'spark', name: 'Spark', isGlyph: true, draw: glyph(' ▁▂▃▄▅▆▇█') },
  { id: 'none', name: 'Hidden (percent only)', isGlyph: true, draw: () => [] },
]

export const WIDTHS: readonly number[] = [3, 4, 5, 6, 8, 10, 12, 15, 20]

export const DEFAULT_BAR: BarPref = { style: 'parallelogram', width: 5 }

export function styleOf(id: string): BarStyle {
  return STYLES.find(style => style.id === id) ?? STYLES[0]!
}

export function drawBar(pref: BarPref, percent: number): BarPart[] {
  return styleOf(pref.style).draw(percent, pref.width)
}

/** A stored value read back over the default, so a renamed style or a missing field never breaks a draw. */
export function normalizeBar(raw: unknown): BarPref {
  const one = (raw ?? {}) as Partial<BarPref>
  const style = STYLES.some(s => s.id === one.style) ? one.style! : DEFAULT_BAR.style
  const width = typeof one.width === 'number' && WIDTHS.includes(one.width) ? one.width : DEFAULT_BAR.width

  return { style, width }
}
