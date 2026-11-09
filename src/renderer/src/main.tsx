import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

async function boot(): Promise<void> {
  // Development only: allow previewing the UI in a plain browser (no preload bridge).
  if (import.meta.env.DEV && !('pawse' in window)) await import('./dev/browserStub')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void boot()
