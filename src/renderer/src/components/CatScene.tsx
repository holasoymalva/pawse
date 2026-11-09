import type { Ref } from 'react'
import type { CatState } from '@shared/animation/catState'

/**
 * The cozy PAWSE scene and the illustrated cat (original artwork, plain SVG).
 *
 * All motion is driven by CSS custom properties that `useCatAnimation` writes on
 * the root <svg> every frame (see cssVars.ts and the `.c-*` rules in styles.css),
 * so React never re-renders per frame.
 */

const BODY = '#171a19'
const OUTLINE = '#060706'
const RIM = '#3a423e'
const BELLY = '#232826'
const INNER_EAR = '#e8eee2'
const NOSE = '#d9a5a0'
const LIME = '#b6f23a'

interface Props {
  state: CatState
  svgRef: Ref<SVGSVGElement>
  /** Human description of the current state, used for the accessible name. */
  description: string
}

function Eye({ side }: { side: 'l' | 'r' }) {
  const cx = side === 'l' ? 198 : 282
  const irisX = side === 'l' ? 202 : 278
  const lidTilt = side === 'l' ? -6 : 6
  const clip = `url(#eye-clip-${side})`
  return (
    <g>
      <ellipse cx={cx} cy={160} rx={24} ry={18} fill="#f4f7ef" stroke={OUTLINE} strokeWidth={4} />
      <g clipPath={clip}>
        <circle cx={irisX} cy={162} r={12.5} fill="url(#iris)" stroke="#1f7a55" strokeWidth={1.5} />
        <ellipse className={`c-pupil c-pupil-${side}`} cx={irisX} cy={162} rx={4.5} ry={9.5} fill="#0b0d0c" />
        <circle cx={irisX - 4.5} cy={157} r={3.4} fill="#fff" />
        <circle cx={irisX + 4} cy={167} r={1.6} fill="#fff" opacity={0.85} />
        {/* Upper eyelid: slides down for blinks and sleepy/resting expressions. */}
        <g transform={`rotate(${lidTilt} ${cx} 160)`}>
          <rect className="c-lid" x={cx - 30} y={96} width={60} height={46} fill={BODY} stroke={OUTLINE} strokeWidth={4} />
        </g>
      </g>
    </g>
  )
}

export function CatScene({ state, svgRef, description }: Props) {
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 480 400"
      className={`scene cat-${state}`}
      data-state={state}
      role="img"
      aria-label={`PAWSE, a little black cat on a cushion. ${description}`}
    >
      <defs>
        <radialGradient id="lamp-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.28" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="heart-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.95" />
          <stop offset="55%" stopColor={LIME} stopOpacity="0.35" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="iris" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d9f98a" />
          <stop offset="100%" stopColor="#3fbf85" />
        </linearGradient>
        <clipPath id="eye-clip-l"><ellipse cx={198} cy={160} rx={22} ry={16} /></clipPath>
        <clipPath id="eye-clip-r"><ellipse cx={282} cy={160} rx={22} ry={16} /></clipPath>
      </defs>

      {/* ---- environment ---- */}
      <g aria-hidden="true">
        <circle className="lamp-glow" cx={436} cy={84} r={170} fill="url(#lamp-glow)" />
        <line x1={436} y1={0} x2={436} y2={44} stroke={RIM} strokeWidth={3} />
        <path d="M412 44 L460 44 L448 74 L424 74 Z" fill="#2c332f" stroke={OUTLINE} strokeWidth={4} strokeLinejoin="round" />
        <circle cx={436} cy={80} r={7} fill={LIME} />

        <circle className="mote mote-1" cx={90} cy={150} r={2.5} fill={LIME} />
        <circle className="mote mote-2" cx={140} cy={80} r={2} fill={LIME} />
        <circle className="mote mote-3" cx={360} cy={170} r={2.5} fill={LIME} />
        <circle className="mote mote-4" cx={430} cy={140} r={2} fill={LIME} />
        <circle className="mote mote-5" cx={60} cy={210} r={2} fill={LIME} />

        {/* rug */}
        <ellipse cx={240} cy={348} rx={218} ry={32} fill="#1f2321" stroke="#2b312e" strokeWidth={3} />
        <ellipse cx={240} cy={348} rx={190} ry={24} fill="none" stroke={LIME} strokeOpacity={0.18} strokeWidth={2} strokeDasharray="4 9" />

        {/* plant */}
        <path d="M64 328 C46 304 42 282 52 262 C66 278 70 304 64 328 Z" fill="#6c9a2c" stroke={OUTLINE} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M64 328 C70 300 86 282 104 276 C102 300 86 318 64 328 Z" fill="#8fc23a" stroke={OUTLINE} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M64 328 C58 304 60 280 70 258 C80 280 78 306 64 328 Z" fill="#7bab31" stroke={OUTLINE} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M42 326 L86 326 L81 356 L47 356 Z" fill="#3b3330" stroke={OUTLINE} strokeWidth={4} strokeLinejoin="round" />
        <path d="M42 326 L86 326" stroke="#54483f" strokeWidth={4} strokeLinecap="round" />

        {/* yarn ball */}
        <path d="M398 352 C380 366 340 364 328 354" fill="none" stroke="#7aa22b" strokeWidth={3} strokeLinecap="round" />
        <circle cx={418} cy={340} r={21} fill="#7aa22b" stroke={OUTLINE} strokeWidth={4} />
        <path d="M401 332 C412 321 429 323 435 334 M399 343 C413 333 433 335 437 348 M406 352 C416 346 428 348 432 356" fill="none" stroke="#b6f23a" strokeOpacity={0.75} strokeWidth={2.2} strokeLinecap="round" />

        {/* cushion */}
        <path d="M96 328 C96 306 130 300 240 300 C350 300 384 306 384 328 C384 352 350 358 240 358 C130 358 96 352 96 328 Z" fill="#2c332f" stroke={OUTLINE} strokeWidth={5} strokeLinejoin="round" />
        <path d="M120 314 C160 306 320 306 360 314" fill="none" stroke="#3d4741" strokeWidth={3} strokeLinecap="round" />
        <path d="M130 332 C170 342 310 342 350 332" fill="none" stroke={LIME} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="5 6" strokeLinecap="round" />
        <circle cx={92} cy={344} r={7} fill="#8fb82e" stroke={OUTLINE} strokeWidth={3} />
        <circle cx={388} cy={344} r={7} fill="#8fb82e" stroke={OUTLINE} strokeWidth={3} />

        {/* breathing halo (follows the breathing animation, not a synchronised breath) */}
        <ellipse className="c-halo" cx={240} cy={236} rx={196} ry={170} fill="none" stroke={LIME} strokeWidth={2} />
      </g>

      {/* ---- the cat ---- */}
      <g className="cat-art">
        {/* tail */}
        <g className="c-tail">
          <path d="M318 308 C372 314 408 278 392 234 C384 210 404 194 420 208" fill="none" stroke={OUTLINE} strokeWidth={27} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M318 308 C372 314 408 278 392 234 C384 210 404 194 420 208" fill="none" stroke={BODY} strokeWidth={19} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M330 314 C376 316 406 288 398 252" fill="none" stroke={RIM} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
        </g>

        {/* body: scales gently with the breathing animation */}
        <g className="c-breath">
          <path d="M178 206 C146 232 132 290 156 312 C176 328 304 328 324 312 C348 290 334 232 302 206 C276 192 204 192 178 206 Z" fill={BODY} stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
          <path d="M160 240 C150 262 148 286 158 304" fill="none" stroke={RIM} strokeWidth={4} strokeLinecap="round" opacity={0.85} />
          <path d="M322 238 C332 262 330 286 322 304" fill="none" stroke={RIM} strokeWidth={4} strokeLinecap="round" opacity={0.85} />
          <ellipse cx={172} cy={300} rx={32} ry={26} fill={BODY} stroke={OUTLINE} strokeWidth={5} />
          <ellipse cx={308} cy={300} rx={32} ry={26} fill={BODY} stroke={OUTLINE} strokeWidth={5} />
          <ellipse className="c-belly" cx={240} cy={270} rx={44} ry={38} fill={BELLY} />
          {/* chest glow: pulses subtly with the measured pulse rate */}
          <circle className="c-glow" cx={240} cy={262} r={34} fill="url(#heart-glow)" />
          <rect x={210} y={262} width={28} height={58} rx={14} fill={BODY} stroke={OUTLINE} strokeWidth={5} />
          <rect x={242} y={262} width={28} height={58} rx={14} fill={BODY} stroke={OUTLINE} strokeWidth={5} />
          <ellipse cx={224} cy={321} rx={21} ry={11} fill={BODY} stroke={OUTLINE} strokeWidth={5} />
          <ellipse cx={256} cy={321} rx={21} ry={11} fill={BODY} stroke={OUTLINE} strokeWidth={5} />
          <path d="M217 319 v7 M225 319 v8 M233 319 v7 M249 319 v7 M257 319 v8 M265 319 v7" stroke="#3a423e" strokeWidth={2.5} strokeLinecap="round" />
          {/* collar */}
          <path d="M170 212 C202 236 278 236 310 212" fill="none" stroke={OUTLINE} strokeWidth={13} strokeLinecap="round" />
          <path d="M170 212 C202 236 278 236 310 212" fill="none" stroke={LIME} strokeWidth={8} strokeLinecap="round" />
          <circle cx={240} cy={236} r={8} fill="#e3f26a" stroke={OUTLINE} strokeWidth={3} />
          <path d="M236 238 h8" stroke={OUTLINE} strokeWidth={2} strokeLinecap="round" />
        </g>

        {/* head: lifts slightly with each breath, tilts now and then */}
        <g className="c-head">
          <g className="c-ear c-ear-l">
            <path d="M160 128 C152 100 148 70 152 46 C170 56 204 78 224 98 Z" fill={BODY} stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
            <path d="M167 112 C163 92 161 72 164 58 C177 68 198 84 211 98 Z" fill={INNER_EAR} />
          </g>
          <g className="c-ear c-ear-r">
            <path d="M320 128 C328 100 332 70 328 46 C310 56 276 78 256 98 Z" fill={BODY} stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
            <path d="M313 112 C317 92 319 72 316 58 C303 68 282 84 269 98 Z" fill={INNER_EAR} />
          </g>
          <path d="M144 160 C144 104 190 88 240 88 C290 88 336 104 336 160 C336 206 296 230 240 230 C184 230 144 206 144 160 Z" fill={BODY} stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
          <path d="M150 168 L131 184 L155 193 Z M330 168 L349 184 L325 193 Z" fill={BODY} stroke={OUTLINE} strokeWidth={4} strokeLinejoin="round" />
          <path d="M158 128 C152 144 150 158 152 174" fill="none" stroke={RIM} strokeWidth={4} strokeLinecap="round" opacity={0.85} />
          <path d="M196 98 C214 92 240 92 256 96" fill="none" stroke={RIM} strokeWidth={3} strokeLinecap="round" opacity={0.6} />

          <Eye side="l" />
          <Eye side="r" />

          <ellipse className="c-blush" cx={170} cy={192} rx={13} ry={7} fill={NOSE} />
          <ellipse className="c-blush" cx={310} cy={192} rx={13} ry={7} fill={NOSE} />
          <path d="M233 178 Q240 174 247 178 Q245 187 240 189 Q235 187 233 178 Z" fill={NOSE} stroke={OUTLINE} strokeWidth={2.5} strokeLinejoin="round" />
          <g fill="none" stroke="#7d8a82" strokeWidth={3} strokeLinecap="round">
            <path className="c-mouth-neutral" d="M240 189 v5 M240 194 q-7 6 -14 1 M240 194 q7 6 14 1" />
            <path className="c-mouth-smile" d="M240 189 v4 M240 193 q-13 16 -26 3 M240 193 q13 16 26 3" />
          </g>

          <g className="c-whisker c-whisker-l" stroke="#e8eee2" strokeWidth={2} strokeLinecap="round" opacity={0.9}>
            <path d="M176 186 L116 174 M176 192 L112 194 M178 198 L120 214" fill="none" />
          </g>
          <g className="c-whisker c-whisker-r" stroke="#e8eee2" strokeWidth={2} strokeLinecap="round" opacity={0.9}>
            <path d="M304 186 L364 174 M304 192 L368 194 M302 198 L360 214" fill="none" />
          </g>
        </g>

        {/* resting "z"s, only while the cat is resting */}
        <g className="c-zzz" fill={LIME} fontFamily="Georgia, serif" fontStyle="italic" aria-hidden="true">
          <text className="zz zz-1" x={332} y={118} fontSize={20}>z</text>
          <text className="zz zz-2" x={348} y={92} fontSize={26}>z</text>
          <text className="zz zz-3" x={366} y={62} fontSize={32}>Z</text>
        </g>
      </g>
    </svg>
  )
}
