/**
 * AI 对话 Hook：封装 preload 流式调用，收集 token、错误处理（中文可读）。
 */
import { useCallback, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'

export interface AiChatResult {
  full: string
  ok: boolean
  error?: string
}

/** 从 AI 输出中提取第一个 JSON 对象（容忍前后杂文本/代码块） */
export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

export function useAiChat(providerId: string) {
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  /** 流式对话：返回完整文本（调用方自行落库/记录） */
  const chatStream = useCallback(
    async (messages: ChatMessage[], onToken?: (t: string) => void): Promise<AiChatResult> => {
      const rm = window.readmate
      if (!rm) return { full: '', ok: false, error: '桌面环境不可用' }
      setStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller
      let full = ''
      try {
        await rm.ai.chatStream(
          { providerId, messages },
          (t) => {
            full += t
            onToken?.(t)
          },
          controller.signal,
        )
        return { full, ok: true }
      } catch (e) {
        return { full, ok: false, error: e instanceof Error ? e.message : String(e) }
      } finally {
        setStreaming(false)
      }
    },
    [providerId],
  )

  /** 非流式（结构化输出场景：作者分析/访谈意图/报告） */
  const chat = useCallback(
    async (messages: ChatMessage[]): Promise<AiChatResult> => {
      // 复用流式通道（main 侧会拼接全文）
      return chatStream(messages)
    },
    [chatStream],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    window.readmate?.ai.cancel()
  }, [])

  return { chatStream, chat, cancel, streaming }
}
