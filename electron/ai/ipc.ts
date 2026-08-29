/**
 * AI IPC 注册：renderer 通过 preload 调用（密钥不出 main 进程）。
 * - ai.chatStream：流式对话（逐块事件回传）
 * - ai.testConnection / ai.cancel
 * 调用完成后自动记录 ai_messages（FR-24，经后端 REST）
 */
import { ipcMain } from 'electron'
import { store } from '../store'
import { createProvider } from './factory'
import type { ChatRequest, ChatUsage, ProviderConfig } from '../../shared/types'

const BACKEND = 'http://127.0.0.1:8000'

/** 记录一次 AI 调用（FR-24 可追踪） */
async function recordCall(sessionKey: string, role: string, content: string, usage: ChatUsage, sourceTag?: string) {
  try {
    await fetch(`${BACKEND}/api/ai/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_key: sessionKey,
        role,
        content,
        source_tag: sourceTag ?? null,
        provider: usage.provider,
        model: usage.model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        latency_ms: usage.latencyMs,
      }),
    })
  } catch {
    /* 记录失败不影响主流程 */
  }
}

export function registerAiIpc(): void {
  // 流式对话：事件 'ai:token:{requestId}' 逐块推送（requestId 由 preload 生成并随请求传入）
  ipcMain.handle('ai:chatStream', async (event, req: ChatRequest) => {
    const config = await store.listProviders().then((list) => list.find((p) => p.id === req.providerId))
    if (!config) throw new Error('Provider 不存在，请先在设置中配置')
    const provider = createProvider(config)
    const requestId = req.requestId ?? Math.random().toString(36).slice(2)
    let full = ''

    const usage = await provider.chatStream(
      { messages: req.messages },
      (token) => {
        full += token
        if (!event.sender.isDestroyed()) {
          event.sender.send(`ai:token:${requestId}`, token)
        }
      },
    )

    // 完整回复落库（FR-24 可追踪）
    if (req.sessionKey) {
      await recordCall(req.sessionKey, 'assistant', full.slice(0, 4000), usage, '[AI]')
    }
    return usage
  })

  ipcMain.handle('ai:testConnection', async (_event, providerId: string) => {
    const config = await store.listProviders().then((list) => list.find((p) => p.id === providerId))
    if (!config) throw new Error('Provider 不存在')
    const provider = createProvider(config)
    return provider.testConnection()
  })

  ipcMain.handle('ai:cancel', () => undefined)
}

export async function recordUserMessage(sessionKey: string, content: string): Promise<void> {
  await fetch(`${BACKEND}/api/ai/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_key: sessionKey,
      role: 'user',
      content,
      source_tag: '[READER]',
    }),
  }).catch(() => undefined)
}

/** 内置厂商模型清单（配置页下拉，FR-10） */
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    type: 'anthropic',
    label: 'Anthropic（Claude）',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    temperature: 0.7,
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5', 'claude-sonnet-4-5-20250929'],
  },
  {
    id: 'openai',
    type: 'openai-compat',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    temperature: 0.7,
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  {
    id: 'deepseek',
    type: 'openai-compat',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openrouter',
    type: 'openai-compat',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    temperature: 0.7,
    models: ['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat', 'openai/gpt-4o'],
  },
  {
    id: 'ollama',
    type: 'openai-compat',
    label: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5',
    temperature: 0.7,
    models: ['qwen2.5', 'llama3.1', 'deepseek-r1'],
  },
  {
    id: 'opencode',
    type: 'openai-compat',
    label: 'OpenCode 网关',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'deepseek-v4-pro',
    temperature: 0.7,
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k3', 'qwen3.8-max', 'glm-5.3', 'minimax-m3'],
  },
]
