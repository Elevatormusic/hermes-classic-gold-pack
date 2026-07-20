import { useStore } from '@nanostores/react'
import { Leva, useControls } from 'leva'
import { type CSSProperties, useEffect, useState } from 'react'

import { $backdrop } from '@/store/backdrop'

const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity'
] as const

type BlendMode = (typeof BLEND_MODES)[number]
type CaduceusTone = 'amber' | 'bronze' | 'darkGold' | 'gold'

const CADUCEUS_COLORS: Record<CaduceusTone, string> = {
  amber: 'rgba(255, 191, 0, 0.26)',
  bronze: 'rgba(205, 127, 50, 0.28)',
  darkGold: 'rgba(184, 134, 11, 0.24)',
  gold: 'rgba(255, 215, 0, 0.3)'
}

const HERMES_CADUCEUS: readonly { text: string; tone: CaduceusTone }[] = [
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⡀⠀⣀⣀⠀⢀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⢀⣠⣴⣾⣿⣿⣇⠸⣿⣿⠇⣸⣿⣿⣷⣦⣄⡀⠀⠀⠀⠀⠀⠀' },
  { tone: 'amber', text: '⠀⢀⣠⣴⣶⠿⠋⣩⡿⣿⡿⠻⣿⡇⢠⡄⢸⣿⠟⢿⣿⢿⣍⠙⠿⣶⣦⣄⡀⠀' },
  { tone: 'amber', text: '⠀⠀⠉⠉⠁⠶⠟⠋⠀⠉⠀⢀⣈⣁⡈⢁⣈⣁⡀⠀⠉⠀⠙⠻⠶⠈⠉⠉⠀⠀' },
  { tone: 'gold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⡿⠛⢁⡈⠛⢿⣿⣦⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'gold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⣿⣦⣤⣈⠁⢠⣴⣿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'amber', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠻⢿⣿⣦⡉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'amber', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢷⣦⣈⠛⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣴⠦⠈⠙⠿⣦⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'bronze', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣤⡈⠁⢤⣿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠷⠄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⠑⢶⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠁⢰⡆⠈⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⠈⣡⠞⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' },
  { tone: 'darkGold', text: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀' }
]

export function Backdrop() {
  const [controlsOpen, setControlsOpen] = useState(false)
  const on = useStore($backdrop)

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      const editing =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement

      if (editing || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      if (event.shiftKey && event.code === 'KeyY') {
        setControlsOpen(open => !open)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const shape = useControls(
    'UI / Shape',
    { radiusScalar: { value: 0.2, min: 0, max: 2, step: 0.1, label: 'radius scalar' } },
    { collapsed: true }
  )

  useEffect(() => {
    document.documentElement.style.setProperty('--radius-scalar', String(shape.radiusScalar))
  }, [shape.radiusScalar])

  const caduceus = useControls(
    'Backdrop / Caduceus',
    {
      enabled: { value: true, label: 'on' },
      opacity: { value: 0.42, min: 0, max: 1, step: 0.01 },
      blendMode: { value: 'normal' as BlendMode, options: BLEND_MODES, label: 'blend' },
      fontSizeVw: { value: 2.7, min: 1, max: 6.5, step: 0.05, label: 'font vw' },
      scale: { value: 1.16, min: 0.6, max: 3.6, step: 0.02, label: 'scale' },
      top: { value: 23, min: -12, max: 74, step: 1, label: 'top %' }
    },
    { collapsed: true }
  )

  return (
    <>
      <Leva collapsed hidden={!import.meta.env.DEV || !controlsOpen} titleBar={{ title: 'backdrop', drag: true }} />

      {on && caduceus.enabled && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
          style={{
            mixBlendMode: caduceus.blendMode as CSSProperties['mixBlendMode'],
            opacity: caduceus.opacity
          }}
        >
          <pre
            className="absolute left-1/2 m-0 select-none whitespace-pre text-center leading-[0.92] tracking-[0]"
            style={{
              fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace',
              fontSize: `clamp(22px, ${caduceus.fontSizeVw}vw, 76px)`,
              textShadow: '0 0 24px rgba(242, 183, 5, 0.12)',
              top: `${caduceus.top}%`,
              transform: `translateX(-50%) scale(${caduceus.scale})`,
              transformOrigin: '50% 0%'
            }}
          >
            {HERMES_CADUCEUS.map((line, index) => (
              <span key={`${line.tone}:${index}`} style={{ color: CADUCEUS_COLORS[line.tone] }}>
                {line.text}
                {index < HERMES_CADUCEUS.length - 1 ? '\n' : ''}
              </span>
            ))}
          </pre>
        </div>
      )}
    </>
  )
}