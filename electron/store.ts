/**
 * Provider 配置与 API Key 安全存储（FR-11）。
 *
 * - 配置（不含 Key）：存后端 SQLite settings 表（value_json）
 * - API Key：Electron safeStorage 加密（Windows DPAPI）后 base64 存入 settings
 * - renderer 永远拿不到明文 Key（只在 main 进程内解密使用）
 */
import { safeStorage } from 'electron'
import type { ProviderConfig } from '../shared/types'

const BACKEND = 'http://127.0.0.1:8000'
const SETTINGS_KEY = 'ai_providers'

interface StoredProvider {
  config: ProviderConfig
  encryptedKey: string | null // safeStorage 加密后的 base64
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BACKEND}${path}`, options)
  if (!resp.ok) throw new Error(`存储服务错误 ${resp.status}`)
  return resp.json() as Promise<T>
}

async function readAll(): Promise<StoredProvider[]> {
  // 后端 GET /api/settings 返回 { key: value_json }，value_json 即 { items: [...] }
  const settings = await apiRequest<Record<string, { items?: unknown }>>('/api/settings')
  return (settings[SETTINGS_KEY]?.items as StoredProvider[]) ?? []
}

async function writeAll(items: StoredProvider[]): Promise<void> {
  await apiRequest('/api/settings/' + SETTINGS_KEY, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value_json: { items } }),
  })
}

function encryptKey(plain: string): string {
  return safeStorage.encryptString(plain).toString('base64')
}

function decryptKey(stored: string): string {
  return safeStorage.decryptString(Buffer.from(stored, 'base64'))
}

export const store = {
  async listProviders(): Promise<ProviderConfig[]> {
    const items = await readAll()
    return items.map((i) => i.config)
  },

  async saveProvider(config: ProviderConfig, apiKey?: string): Promise<void> {
    const items = await readAll()
    const existing = items.find((i) => i.config.id === config.id)
    const entry: StoredProvider = {
      config,
      encryptedKey: apiKey ? encryptKey(apiKey) : (existing?.encryptedKey ?? null),
    }
    if (existing) {
      Object.assign(existing, entry)
    } else {
      items.push(entry)
    }
    await writeAll(items)
  },

  async deleteProvider(id: string): Promise<void> {
    const items = await readAll()
    await writeAll(items.filter((i) => i.config.id !== id))
  },

  async getApiKey(providerId: string): Promise<string> {
    const items = await readAll()
    const entry = items.find((i) => i.config.id === providerId)
    if (!entry?.encryptedKey) throw new Error('未配置 API Key')
    return decryptKey(entry.encryptedKey)
  },

  async hasKey(providerId: string): Promise<boolean> {
    const items = await readAll()
    return !!items.find((i) => i.config.id === providerId)?.encryptedKey
  },
}
