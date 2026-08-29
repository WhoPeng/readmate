/** 配置/密钥 IPC 注册：renderer 只能操作掩码与配置，密钥读写只在 main。 */
import { ipcMain } from 'electron'
import { store } from './store'
import { DEFAULT_PROVIDERS } from './ai/ipc'

export function registerStoreIpc(): void {
  ipcMain.handle('store:listProviders', () => store.listProviders())
  ipcMain.handle('store:saveProvider', (_e, config, apiKey?: string) => store.saveProvider(config, apiKey))
  ipcMain.handle('store:deleteProvider', (_e, id: string) => store.deleteProvider(id))
  ipcMain.handle('store:hasKey', (_e, id: string) => store.hasKey(id))
  ipcMain.handle('store:defaultProviders', () => DEFAULT_PROVIDERS)
}
