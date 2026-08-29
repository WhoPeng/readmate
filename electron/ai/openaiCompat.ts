/**
 * OpenAI-compatible Provider（OpenAI / DeepSeek / OpenRouter / Ollama / Moonshot 等）。
 * 协议：POST {baseUrl}/chat/completions，SSE 流式（choices[].delta.content）。
 */
import type { ChatMessage, ChatUsage, ConnectionResult, ProviderConfig } from '../../shared/types'
import { mapHttpError, wrapNetworkError } from './provider'
import type { ChatParams, ChatResult, LLMProvider } from './provider'

export class OpenAICompatProvider implements LLMProvider {
  constructor(
    private config: ProviderConfig,
    private getApiKey: () => Promise<string>,
  ) {}

  private async request(messages: ChatMessage[], stream: boolean, params: ChatParams, signal?: AbortSignal) {
    const key = await this.getApiKey()
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '')
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: params.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? this.config.maxTokens,
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
        // SSE 按 \n\n 切分
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content
            if (typeof delta === 'string') {
              onToken(delta)
              completionTokens++
            }
            if (json.usage?.completion_tokens) completionTokens = json.usage.completion_tokens
          } catch {
            /* 忽略非 JSON 帧 */
          }
        }
      }
    } catch (err) {
      throw wrapNetworkError(err, this.config.label)
    }

    return {
      promptTokens: 0, // OpenAI 流式不含 usage，调用方按需估算
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
    const text = json.choices?.[0]?.message?.content ?? ''
    return {
      text,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
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
