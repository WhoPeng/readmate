/**
 * AI Provider 统一接口与错误模型（设计文档第 5 节，参考 Cherry Studio 的 Provider 抽象）。
 * 业务层（状态机/Context 组装）只依赖本接口，不感知具体厂商。
 */
import { AiError } from '../../shared/types'
import type { ChatMessage, ChatUsage, ConnectionResult } from '../../shared/types'

export interface ChatParams {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface ChatResult {
  text: string
  usage: ChatUsage
}

export interface LLMProvider {
  /** 流式对话：逐块回调 token；AbortSignal 可中断 */
  chatStream(params: ChatParams, onToken: (token: string) => void, signal?: AbortSignal): Promise<ChatUsage>
  /** 非流式对话（结构化输出场景） */
  chat(params: ChatParams, signal?: AbortSignal): Promise<ChatResult>
  /** 连接测试（FR-12） */
  testConnection(signal?: AbortSignal): Promise<ConnectionResult>
}

/** 记录一次调用的元信息（供 ai_messages 落库，FR-24） */
export interface CallMeta {
  provider: string
  model: string
}

export function mapHttpError(status: number, bodyText: string, providerName: string): AiError {
  const body = bodyText.slice(0, 300)
  switch (status) {
    case 401:
    case 403:
      return new AiError('AUTH', `鉴权失败（${providerName}）：请检查 API Key 与 Base URL（${body}）`)
    case 429:
      return new AiError('RATE_LIMIT', `请求过于频繁或额度不足（${providerName}，HTTP 429）`)
    case 400:
      if (body.includes('context') || body.includes('token') || body.includes('length')) {
        return new AiError('CONTEXT_LENGTH', `内容超出模型上下文限制（${providerName}），已自动截断请重试`)
      }
      return new AiError('UNKNOWN', `请求被拒绝（${providerName}，HTTP 400）：${body}`)
    default:
      return new AiError('UNKNOWN', `请求失败（${providerName}，HTTP ${status}）：${body}`)
  }
}

export function wrapNetworkError(err: unknown, providerName: string): AiError {
  if (err instanceof AiError) return err
  const msg = err instanceof Error ? err.message : String(err)
  if (/abort|terminated/i.test(msg)) return new AiError('UNKNOWN', '已中断')
  return new AiError('NETWORK', `网络错误（${providerName}）：${msg}。请检查 Base URL 与网络连接`)
}
