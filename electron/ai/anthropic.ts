/**
 * Anthropic Provider（Claude 原生协议）。
 * 协议：POST {baseUrl}/v1/messages，SSE 流式（content_block_delta → text）。
 * system 消息单独传参（Anthropic 协议与 OpenAI 的差异点）。
 */
import type { ChatMessage, ChatUsage, ConnectionResult, ProviderConfig } from '../../shared/types'
import { mapHttpError, wrapNetworkError } from './provider'
import type { ChatParams, ChatResult, LLMProvider } from './provider'

const ANTHROPIC_VERSION = '2023-06-01'

export class AnthropicProvider implements LLMProvider {
  constructor(
    private config: ProviderConfig,
    private getApiKey: () => Promise<string>,
  ) {}

  private splitSystem(messages: ChatMessage[]): { system: string; messages: ChatMessage[] } {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    const rest = messages.filter((m) => m.role !== 'system')
    return { system, messages: rest }
  }

  private async request(messages: ChatMessage[], stream: boolean, params: ChatParams, signal?: AbortSignal) {
    const key = await this.getApiKey()
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '')
    const { system, messages: bodyMessages } = this.splitSystem(messages)
    // 认证方式自适应：API Key（sk-ant- 开头）用 x-api-key；
    // OAuth token（如 Claude Code 凭据）用 Authorization: Bearer
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    }
    if (key.startsWith('sk-ant-')) {
      headers['x-api-key'] = key
    } else {
      headers['Authorization'] = `Bearer ${key}`
    }
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages: bodyMessages,
        system: system || undefined,
        temperature: params.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? this.config.maxTokens ?? 2048,
        stream,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw mapHttpError(resp.status, body, this.config.label)
    }
    return resp
  }

  async chatStream(params: ChatParams, onToken: (t: string) => void, signal?: AbortSignal): Promise<ChatUsage> {
    const started = Date.now()
    let resp: Response
    try {
      resp = await this.request(params.messages, true, params, signal)
    } catch (err) {
      throw wrapNetworkError(err, this.config.label)
    }
    if (!resp.body) throw new Error('响应无流式内容')

    let completionTokens = 0
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                onToken(json.delta.text ?? '')
                completionTokens++
              }
              if (json.type === 'message_delta' && json.usage?.output_tokens) {
                completionTokens = json.usage.output_tokens
              }
            } catch {
              /* 忽略非 JSON 帧 */
            }
          }
        }
      }
    } catch (err) {
      throw wrapNetworkError(err, this.config.label)
    }

    return {
      promptTokens: 0,
      completionTokens,
      latencyMs: Date.now() - started,
      model: this.config.model,
      provider: this.config.label,
    }
  }

  async chat(params: ChatParams, signal?: AbortSignal): Promise<ChatResult> {
    const started = Date.now()
    let resp: Response
    try {
      resp = await this.request(params.messages, false, params, signal)
    } catch (err) {
      throw wrapNetworkError(err, this.config.label)
    }
    const json = await resp.json().catch(() => ({}))
    const text = (json.content ?? [])
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('')
    return {
      text,
      usage: {
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - started,
        model: this.config.model,
        provider: this.config.label,
      },
    }
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionResult> {
    const started = Date.now()
    try {
      await this.chat({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 5 }, signal)
      return { ok: true, latencyMs: Date.now() - started, model: this.config.model }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
