import { useEffect, useState } from 'react'
import type { MascotChoice } from '../../hooks/use-mascot'

type Palette = Record<string, string>

function PixelSprite({
  rows,
  palette,
  px = 5,
}: {
  rows: string[]
  palette: Palette
  px?: number
}) {
  const w = rows[0].length
  const h = rows.length

  return (
    <svg
      width={w * px}
      height={h * px}
      viewBox={`0 0 ${w * px} ${h * px}`}
      role="img"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell !== '.' ? (
            <rect
              key={`${x}-${y}`}
              x={x * px}
              y={y * px}
              width={px}
              height={px}
              fill={palette[cell]}
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

function AnimatedMascot({
  frames,
  palette,
  interval,
  floatSequence,
  px = 5,
}: {
  frames: string[][]
  palette: Palette
  interval: number
  floatSequence: number[]
  px?: number
}) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStep(current => (current + 1) % frames.length), interval)
    return () => clearInterval(id)
  }, [frames.length, interval])

  const rows = frames[step]
  const floatY = floatSequence[step % floatSequence.length] ?? 0

  return (
    <div className="flex flex-col items-center text-text">
      <div
        className="transition-transform duration-300 ease-out"
        style={{ transform: `translateY(${floatY}px)` }}
      >
        <PixelSprite rows={rows} palette={palette} px={px} />
      </div>
    </div>
  )
}

const DREAM_PUFF_PALETTE = {
  A: '#3a2635',
  B: '#f6b8cf',
  C: '#ffd9e7',
  D: '#ffffff',
  E: '#3b2a34',
  F: '#f08aaa',
  G: '#8f7480',
}

const DREAM_PUFF_FRAMES = [
  [
    '.....AA..AA.....',
    '....ABB..BBA....',
    '...ABBBBBBBBA...',
    '..ABCCCCCCCCBA..',
    '.ABCCCCCCCCCCBA.',
    '.ABCCEECCEECCBA.',
    '.ABCCEECCEECCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCCCCCCCCBA.',
    '.ABCCCBCCBCCCBA.',
    '..ABBBBBBBBBBA..',
    '..AFBBBBBBBBFA..',
    '...AGB....BGA...',
    '..AGG......GGA..',
    '................',
    '................',
  ],
  [
    '.....AA..AA.....',
    '....ABB..BBA....',
    '...ABBBBBBBBA...',
    '..ABCCCCCCCCBA..',
    '.ABCCCCCCCCCCBA.',
    '.ABCCEECCEECCBA.',
    '.ABCCEECCEECCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCCCCCCCCBA.',
    '.ABCCCBCCBCCCBA.',
    '..ABBBBBBBBBBA..',
    '..AFBBBBBBBBFA..',
    '..AGGB....BGGA..',
    '.AGG........GGA.',
    '................',
    '................',
  ],
  [
    '.....AA..AA.....',
    '....ABB..BBA....',
    '...ABBBBBBBBA...',
    '..ABCCCCCCCCBA..',
    '.ABCCCCCCCCCCBA.',
    '.ABCCDDCCDDCCBA.',
    '.ABCCDDCCDDCCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCCCCCCCCBA.',
    '.ABCCCBCCBCCCBA.',
    '..ABBBBBBBBBBA..',
    '..AFBBBBBBBBFA..',
    '...AGB....BGA...',
    '..AGG......GGA..',
    '................',
    '................',
  ],
  [
    '.....AA..AA.....',
    '....ABB..BBA....',
    '...ABBBBBBBBA...',
    '..ABCCCCCCCCBA..',
    '.ABCCCCCCCCCCBA.',
    '.ABCCEECCEECCBA.',
    '.ABCCEECCEECCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCCCCCCCCBA.',
    '.ABCCCBCCBCCCBA.',
    '..ABBBBBBBBBBA..',
    '..AFBBBBBBBBFA..',
    '...AGB....BGA...',
    '..AGG......GGA..',
    '................',
    '................',
  ],
]

function PixelDreamPuff() {
  return (
    <AnimatedMascot
      frames={DREAM_PUFF_FRAMES}
      palette={DREAM_PUFF_PALETTE}
      interval={340}
      floatSequence={[0, -1, -2, -1]}
      px={5}
    />
  )
}

const SLEEPY_GIANT_PALETTE = {
  A: '#1f2328',
  B: '#31535a',
  C: '#4f7980',
  D: '#eadfbc',
  E: '#ffffff',
  F: '#2b1d18',
  G: '#7f695f',
}

const SLEEPY_GIANT_FRAMES = [
  [
    '.....AAAAAA.....',
    '....ABBBBBBA....',
    '...ABCCCCCCBA...',
    '..ABCCCCCCCCBA..',
    '..ABCFCEECFCBA..',
    '.ABCCFCEECFCCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCDDDDCCCBA.',
    '.ABCDDDDDDDDCCA.',
    '.ABCDDDDDDDDCCA.',
    '..ABCDDDDDDCCBA.',
    '..ABCCCCCCCCBA..',
    '...AGC....CGA...',
    '..AGG......GGA..',
    '................',
    '................',
  ],
  [
    '.....AAAAAA.....',
    '....ABBBBBBA....',
    '...ABCCCCCCBA...',
    '..ABCCCCCCCCBA..',
    '..ABCFCEECFCBA..',
    '.ABCCFCEECFCCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCDDDDCCCBA.',
    '.ABCDDDDDDDDCCA.',
    '.ABCDDDDDDDDCCA.',
    '..ABCDDDDDDCCBA.',
    '..ABCCCCCCCCBA..',
    '..AGGC....CGGA..',
    '.AGG........GGA.',
    '................',
    '................',
  ],
  [
    '.....AAAAAA.....',
    '....ABBBBBBA....',
    '...ABCCCCCCBA...',
    '..ABCCCCCCCCBA..',
    '..ABCFCDDCFCBA..',
    '.ABCCFCDDCFCCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCDDDDCCCBA.',
    '.ABCDDDDDDDDCCA.',
    '.ABCDDDDDDDDCCA.',
    '..ABCDDDDDDCCBA.',
    '..ABCCCCCCCCBA..',
    '...AGC....CGA...',
    '..AGG......GGA..',
    '................',
    '................',
  ],
  [
    '.....AAAAAA.....',
    '....ABBBBBBA....',
    '...ABCCCCCCBA...',
    '..ABCCCCCCCCBA..',
    '..ABCFCEECFCBA..',
    '.ABCCFCEECFCCBA.',
    '.ABCCCCFFFCCCBA.',
    '.ABCCCDDDDCCCBA.',
    '.ABCDDDDDDDDCCA.',
    '.ABCDDDDDDDDCCA.',
    '..ABCDDDDDDCCBA.',
    '..ABCCCCCCCCBA..',
    '...AGC....CGA...',
    '..AGG......GGA..',
    '................',
    '................',
  ],
]

function PixelSleepyGiant() {
  return (
    <AnimatedMascot
      frames={SLEEPY_GIANT_FRAMES}
      palette={SLEEPY_GIANT_PALETTE}
      interval={360}
      floatSequence={[0, -1, -1, 0]}
      px={5}
    />
  )
}

const MASCOT_MAP: Record<Exclude<MascotChoice, 'off'>, React.FC> = {
  'dream-puff': PixelDreamPuff,
  'sleepy-giant': PixelSleepyGiant,
}

const MASCOT_KEYS = Object.keys(MASCOT_MAP) as Exclude<MascotChoice, 'off'>[]

export function Mascot({ choice }: { choice?: MascotChoice }) {
  const [randomKey] = useState(() => MASCOT_KEYS[Math.floor(Math.random() * MASCOT_KEYS.length)])

  if (choice === 'off') return null

  const key = choice ?? randomKey
  const Component = MASCOT_MAP[key]
  return Component ? <Component /> : null
}

export { PixelDreamPuff, PixelSleepyGiant }
