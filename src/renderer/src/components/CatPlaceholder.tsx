/** Simple hand-drawn placeholder. Detailed art and animation arrive in Phase 2. */
export function CatPlaceholder({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 200 180" className={`cat ${active ? 'cat-active' : ''}`} role="img" aria-label="A sketchy cat">
      <path d="M52 78 L46 30 L84 56" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M148 78 L156 29 L116 56" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 84 C44 126 70 150 101 149 C134 150 158 126 150 82 C140 56 62 54 50 84 Z" fill="#242826" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      <path d="M78 94 q6 -9 13 0" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M110 94 q6 -9 13 0" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M96 106 l5 5 l5 -5 z" fill="currentColor" />
      <path d="M101 111 q-4 9 -12 7 M101 111 q4 9 12 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M62 108 l-24 -5 M62 116 l-25 4 M140 108 l25 -5 M140 116 l24 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
