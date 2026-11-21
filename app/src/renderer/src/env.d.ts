import type { TapApi } from '../../preload/index'

declare global {
  interface Window {
    tap: TapApi
  }
}

export {}
