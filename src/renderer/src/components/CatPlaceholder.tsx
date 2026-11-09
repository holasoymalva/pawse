import type { Ref } from 'react'
import type { CatState } from '@shared/animation/catState'

/**
 * Simple hand-drawn placeholder. Final artwork comes later; the animation hooks
 * (CSS variables set by useCatAnimation) are what matter here.
 */
export function CatPlaceholder({ state, svgRef }: { state: CatState; svgRef: Ref<SVGSVGElement> }) {
  return (
    <svg ref={svgRef} viewBox="0 0 200 180" className={`cat cat-${state}`} role="img" aria-label="A sketchy cat">
      <g className="cat-breath">
        <path className="cat-ear cat-ear-l" d="M52 78 L46 30 L84 56" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path className="cat-ear cat-ear-r" d="M148 78 L156 29 L116 56" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M50 84 C44 126 70 150 101 149 C134 150 158 126 150 82 C140 56 62 54 50 84 Z" fill="#242826" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
        <ellipse className="cat-heart" cx="101" cy="132" rx="14" ry="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3 5" strokeLinecap="round" opacity="0.7" />
        <g className="cat-eye cat-eye-l"><ellipse cx="84" cy="94" rx="5" ry="7" fill="currentColor" /></g>
        <g className="cat-eye cat-eye-r"><ellipse cx="117" cy="94" rx="5" ry="7" fill="currentColor" /></g>
        <path d="M96 106 l5 5 l5 -5 z" fill="currentColor" />
        <path d="M101 111 q-4 9 -12 7 M101 111 q4 9 12 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M62 108 l-24 -5 M62 116 l-25 4 M140 108 l25 -5 M140 116 l24 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  )
}
