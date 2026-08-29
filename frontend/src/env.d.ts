/// <reference types="vite/client" />
import type { ReadmateApi } from '../../shared/types'

declare global {
  interface Window {
    /** Electron preload 暴露的 IPC API（shared/types.ts） */
    readmate?: ReadmateApi
  }
}

export {}
