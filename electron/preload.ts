/**
 * preload：向 renderer 暴露最小 IPC 面（contextIsolation 下唯一通道）。
 * AI 与密钥接口在步骤 11/12 填充真实现，当前为占位（renderer 调用会得到明确错误）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ReadmateApi } from '../shared/types'

const api: ReadmateApi = {
  ai: {
    chatStream: () => Promise.reject(new Error('AI 功能尚未启用（步骤 11 实现）')),
    testConnection: () => Promise.reject(new Error('AI 功能尚未启用（步骤 11 实现）')),
    cancel: () => undefined,
  },
  store: {
    listProviders: () => Promise.resolve([]),
    saveProvider: () => Promise.resolve(),
    deleteProvider: () => Promise.resolve(),
    hasKey: () => Promise.resolve(false),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    pingBackend: () => ipcRenderer.invoke('app:pingBackend'),
  },
}

contextBridge.exposeInMainWorld('readmate', api)
