/**
 * 共享类型：Electron main（AI 层）与 renderer（React）共用的契约。
 * 设计文档第 5 节：AI Provider 抽象（参考 Cherry Studio）。
 */

/** AI 厂商配置（不含明文 Key，Key 经 safeStorage 加密后单独存储） */
export interface ProviderConfig {
  id: string
  type: 'openai-compat' | 'anthropic'
  label: string
  baseUrl: string
  model: string
  temperature?: number
  maxTokens?: number
  /** 内置模型清单（下拉选择用） */
  models: string[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  providerId: string
  messages: ChatMessage[]
  /** 流式回调由 IPC 事件承载，此字段仅为标识 */
  sessionKey?: string
  /** 流式 token 事件通道标识（preload 生成，main 复用，保证事件能送回调用方） */
  requestId?: string
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  latencyMs: number
  model: string
  provider: string
}

export type AiErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'CONTEXT_LENGTH' | 'UNKNOWN'

export class AiError extends Error {
  code: AiErrorCode
  constructor(code: AiErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface ConnectionResult {
  ok: boolean
  latencyMs?: number
  model?: string
  message?: string
}

/** preload 暴露给 renderer 的 IPC API 面 */
export interface ReadmateApi {
  ai: {
    chatStream(req: ChatRequest, onToken: (token: string) => void, signal?: AbortSignal): Promise<ChatUsage>
    testConnection(providerId: string): Promise<ConnectionResult>
    cancel(): void
  }
  store: {
    listProviders(): Promise<ProviderConfig[]>
    defaultProviders(): Promise<ProviderConfig[]>
    saveProvider(config: ProviderConfig, apiKey?: string): Promise<void>
    deleteProvider(id: string): Promise<void>
    hasKey(providerId: string): Promise<boolean>
  }
  app: {
    version(): Promise<string>
    pingBackend(): Promise<boolean>
  }
}
