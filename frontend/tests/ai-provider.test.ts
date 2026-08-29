/**
 * AI Provider 层单测（步骤 11 验收）：协议转换 / 流式解析 / 错误映射。
 * 使用 mock fetch，不访问真实网络。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { AiError } from '../../shared/types'
import { mapHttpError, wrapNetworkError } from '../../electron/ai/provider'
import { OpenAICompatProvider } from '../../electron/ai/openaiCompat'
import { AnthropicProvider } from '../../electron/ai/anthropic'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchStream(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } }))
}

function mockFetchJson(json: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

const config = {
  id: 'test', type: 'openai-compat', label: '测试厂商', baseUrl: 'https://example.com/v1', model: 'test-model',
  models: [], temperature: 0.7,
} as const

describe('OpenAICompatProvider', () => {
  it('流式解析：逐块回调 token（SSE data 帧）', async () => {
    vi.stubGlobal('fetch', mockFetchStream([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const provider = new OpenAICompatProvider({ ...config }, () => Promise.resolve('sk-test'))
    const tokens: string[] = []
    const usage = await provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (t) => tokens.push(t))
    expect(tokens.join('')).toBe('你好世界')
    expect(usage.model).toBe('test-model')
    // 请求体验证
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://example.com/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(true)
    expect(init.headers.Authorization).toBe('Bearer sk-test')
  })

  it('鉴权失败映射为 AUTH 错误', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: { message: 'bad key' } }, 401))
    const provider = new OpenAICompatProvider({ ...config }, () => Promise.resolve('sk-wrong'))
    await expect(provider.chat({ messages: [] })).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('限流映射为 RATE_LIMIT', async () => {
    vi.stubGlobal('fetch', mockFetchJson({}, 429))
    const provider = new OpenAICompatProvider({ ...config }, () => Promise.resolve('sk-test'))
    await expect(provider.chat({ messages: [] })).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('上下文超限映射为 CONTEXT_LENGTH', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: { message: 'context length exceeded' } }, 400))
    const provider = new OpenAICompatProvider({ ...config }, () => Promise.resolve('sk-test'))
    await expect(provider.chat({ messages: [] })).rejects.toMatchObject({ code: 'CONTEXT_LENGTH' })
  })
})

describe('AnthropicProvider', () => {
  const aConfig = { ...config, type: 'anthropic', label: 'Claude', baseUrl: 'https://api.anthropic.com' } as const

  it('system 消息拆分 + 流式解析（content_block_delta）', async () => {
    vi.stubGlobal('fetch', mockFetchStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"一"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"二"}}\n\n',
    ]))
    const provider = new AnthropicProvider({ ...aConfig }, () => Promise.resolve('sk-ant-api03-test-key'))
    const tokens: string[] = []
    await provider.chatStream(
      { messages: [{ role: 'system', content: '你是伴读' }, { role: 'user', content: 'hi' }] },
      (t) => tokens.push(t),
    )
    expect(tokens.join('')).toBe('一二')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const body = JSON.parse(String(init.body))
    expect(body.system).toBe('你是伴读') // system 单独传参
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(init.headers['x-api-key']).toBe('sk-ant-api03-test-key')
    expect(init.headers['anthropic-version']).toBeTruthy()
  })

  it('非流式：提取 text block 内容', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ content: [{ type: 'text', text: '回答内容' }], usage: { input_tokens: 10, output_tokens: 5 } }))
    const provider = new AnthropicProvider({ ...aConfig }, () => Promise.resolve('sk-ant-api03-test-key'))
    const result = await provider.chat({ messages: [] })
    expect(result.text).toBe('回答内容')
    expect(result.usage.completionTokens).toBe(5)
  })
})

describe('错误映射', () => {
  it('网络异常包装为 NETWORK', () => {
    const err = wrapNetworkError(new TypeError('fetch failed'), '厂商')
    expect(err).toBeInstanceOf(AiError)
    expect(err.code).toBe('NETWORK')
  })

  it('中断请求不误报网络错误', () => {
    const err = wrapNetworkError(new Error('This operation was aborted'), '厂商')
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toContain('中断')
  })
})
