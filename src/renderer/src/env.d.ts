import type { PawseApi } from '@shared/ipc'

declare global {
  interface Window {
    pawse: PawseApi
  }
}
