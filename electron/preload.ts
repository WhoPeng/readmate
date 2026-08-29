/**
 * preload：向 renderer 暴露最小 IPC 面（contextIsolation 下唯一通道）。
 * - ai：流式对话（token 事件回传）、测试连接、中断
 * - store：Provider 配置（Key 只见掩码）
 * - app：版本与后端连通
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChatRequest, ConnectionResult, ProviderConfig, ReadmateApi } from '../shared/types'

const api: ReadmateApi = {
  ai: {
    chatStream: (req: ChatRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<any> => {
      const requestId = Math.random().toString(36).slice(2)
      const listener = (_e: IpcRendererEvent, token: string) => onToken(token)
      ipcRenderer.on(`ai:token:${requestId}`, listener)
      return ipcRenderer
        .invoke('ai:chatStream', { ...req, requestId })
        .finally(() => ipcRenderer.removeListener(`ai:token:${requestId}`, listener))
    },
    testConnection: (providerId: string): Promise<ConnectionResult> =>
      ipcRenderer.invoke('ai:testConnection', providerId),
    cancel: () => {
      ipcRenderer.invoke('ai:cancel').catch(() => undefined)
    },
  },
  store: {
    listProviders: (): Promise<ProviderConfig[]> => ipcRenderer.invoke('store:listProviders'),
    defaultProviders: (): Promise<ProviderConfig[]> => ipcRenderer.invoke('store:defaultProviders'),
    saveProvider: (config: ProviderConfig, apiKey?: string): Promise<void> =>
      ipcRenderer.invoke('store:saveProvider', config, apiKey),
    deleteProvider: (id: string): Promise<void> => ipcRenderer.invoke('store:deleteProvider', id),
    hasKey: (id: string): Promise<boolean> => ipcRenderer.invoke('store:hasKey', id),
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    pingBackend: (): Promise<boolean> => ipcRenderer.invoke('app:pingBackend'),
  },
}

contextBridge.exposeInMainWorld('readmate', api)
