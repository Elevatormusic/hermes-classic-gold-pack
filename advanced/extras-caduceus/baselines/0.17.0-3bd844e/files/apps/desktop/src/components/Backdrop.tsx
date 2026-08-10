import { useStore } from '@nanostores/react'

import { $backdrop } from '@/store/backdrop'

// Classic Gold: the stock statue backdrop is replaced by a braille-art caduceus
// watermark. Values (opacity/size/position) are the pack's tuned defaults from
// the previous leva-driven Backdrop; upstream has since dropped leva, so they
// are baked in as constants here.
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

const CADUCEUS_OPACITY = 0.42
const CADUCEUS_FONT_VW = 2.7
const CADUCEUS_SCALE = 1.16
const CADUCEUS_TOP_PCT = 23

export function Backdrop() {
  const on = useStore($backdrop)

  if (!on) {
    return null
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
      style={{ opacity: CADUCEUS_OPACITY }}
    >
      <pre
        className="absolute left-1/2 m-0 select-none whitespace-pre text-center leading-[0.92] tracking-[0]"
        style={{
          fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace',
          fontSize: `clamp(22px, ${CADUCEUS_FONT_VW}vw, 76px)`,
          textShadow: '0 0 24px rgba(242, 183, 5, 0.12)',
          top: `${CADUCEUS_TOP_PCT}%`,
          transform: `translateX(-50%) scale(${CADUCEUS_SCALE})`,
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
  )
}
