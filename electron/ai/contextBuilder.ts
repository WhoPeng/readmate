/**
 * AI Context 组装器（设计文档第 6 节）。
 * 原则：不把整本书发给模型，只发送当前该有的最小上下文。
 * 数据经后端 REST 拉取（章节文本按需提取，历史 Journal 摘要化）。
 *
 * 预算（≈7k tokens/次，适配 8k 上下文模型）：
 *   System 原则 ≤800 ｜ Reader Profile ≤500 ｜ 当前章节 ≤3000 ｜ 历史反思 ≤500 ｜ 对话历史 ≤2000
 */
import type { ChatMessage } from '../../shared/types'
import { SYSTEM_PRINCIPLES } from './prompts'

const BACKEND = 'http://127.0.0.1:8000'
const CHAPTER_TEXT_MAX = 6000 // 字符（≈2-3k tokens）
const JOURNAL_SUMMARY_MAX = 3 // 历史 Journal 最多摘要条数

export interface ReaderContextData {
  bookId: number
  chapterId?: number
  bookTitle?: string
  bookAuthor?: string
  intent?: { motivation?: string; expected_gain?: string; interested_topics?: string; personal_questions?: string }
  chapterTitle?: string
  chapterText?: string
  highlights?: string[]
  notes?: string[]
  previousJournals?: string[]
  history?: ChatMessage[]
}

/** 从后端拉取上下文数据（main 进程调用） */
export async function fetchReaderContext(bookId: number, chapterId?: number): Promise<ReaderContextData> {
  const [book, highlights, journals] = await Promise.all([
    fetch(`${BACKEND}/api/books/${bookId}`).then((r) => r.json()),
    fetch(`${BACKEND}/api/books/${bookId}/highlights`).then((r) => r.json()),
    fetch(`${BACKEND}/api/books/${bookId}/journals`).then((r) => r.json()),
  ])

  const data: ReaderContextData = {
    bookId,
    chapterId,
    bookTitle: book.title,
    bookAuthor: book.author,
    intent: book.intent ?? undefined,
  }

  const ch = book.chapters?.find((c: { id: number }) => c.id === chapterId)
  if (chapterId && ch) {
    data.chapterTitle = ch.toc_title
    const textResp = await fetch(`${BACKEND}/api/chapters/${chapterId}/text`).then((r) => r.json().catch(() => null))
    data.chapterText = (textResp?.text ?? '').slice(0, CHAPTER_TEXT_MAX)
  }

  const chHighlights = highlights
    .filter((h: { chapter_id: number }) => h.chapter_id === chapterId)
    .slice(0, 10)
    .map((h: { selected_text: string }) => h.selected_text)
  data.highlights = chHighlights

  // 历史 Journal 摘要（每章取最终想法与一致程度）
  data.previousJournals = (journals ?? [])
    .filter((j: { chapter_id: number }) => j.chapter_id !== chapterId)
    .slice(-JOURNAL_SUMMARY_MAX)
    .map(
      (j: { chapter_id: number; agreement_level: string; final_thought: string }) =>
        `第${j.chapter_id}章 [${j.agreement_level}] ${(j.final_thought || '').slice(0, 120)}`,
    )

  return data
}

/** 组装 System 消息（角色 + 场景模板 + 用户画像） */
function buildSystem(scene: string, data: ReaderContextData, sceneSystem: string): string {
  const parts: string[] = [sceneSystem]

  if (data.bookTitle) {
    parts.push(`\n\n【当前书籍】《${data.bookTitle}》${data.bookAuthor ? `（${data.bookAuthor}）` : ''}`)
  }
  if (data.intent?.motivation) {
    parts.push(`【读者的阅读动机】${data.intent.motivation}`)
  }
  if (data.intent?.expected_gain) {
    parts.push(`【读者期待】${data.intent.expected_gain}`)
  }
  if (data.intent?.interested_topics) {
    parts.push(`【读者关注主题】${data.intent.interested_topics}`)
  }
  if (data.intent?.personal_questions) {
    parts.push(`【读者想弄清的问题】${data.intent.personal_questions}`)
  }
  return parts.join('\n')
}

/** 组装当前章节的用户消息（正文 + 高亮 + 笔记 + 历史反思） */
function buildChapterUser(data: ReaderContextData): string {
  const parts: string[] = []
  if (data.chapterTitle) parts.push(`【本章】《${data.chapterTitle}》`)
  if (data.chapterText) parts.push(`【本章正文】\n${data.chapterText}`)
  if (data.highlights?.length) parts.push(`【读者本章高亮】\n${data.highlights.map((h) => `- ${h}`).join('\n')}`)
  if (data.previousJournals?.length) parts.push(`【此前章节的反思摘要】\n${data.previousJournals.map((j) => `- ${j}`).join('\n')}`)
  if (!parts.length) return ''
  return parts.join('\n\n')
}

export type ChatScene = 'interview' | 'reflect_questions' | 'follow_up' | 'author_position' | 'book_report'

export function buildChatMessages(scene: ChatScene, data: ReaderContextData, sceneSystem: string): ChatMessage[] {
  const messages: ChatMessage[] = []
  messages.push({ role: 'system', content: buildSystem(scene, data, sceneSystem) })
  if (scene !== 'interview') {
    const chapter = buildChapterUser(data)
    if (chapter) messages.push({ role: 'user', content: chapter })
  }
  // 对话历史（最近 N 轮）
  if (data.history?.length) {
    messages.push(...data.history.slice(-12))
  }
  return messages
}

export { SYSTEM_PRINCIPLES }
