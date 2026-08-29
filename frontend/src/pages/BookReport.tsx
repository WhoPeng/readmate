/**
 * 「我与这本书」（步骤 18 验收：FR-21）。
 * 全书完成后生成 10 项思想档案：真实记录驱动（禁止编造），可重新生成、可编辑。
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { BookDto, BookReportDto, ThoughtEntry } from '../api/types'
import { buildChatMessages, fetchReaderContext } from '../ai/contextBuilder'
import { BOOK_REPORT_SYSTEM } from '../ai/prompts'
import { extractJson, useAiChat } from '../hooks/useAiChat'

const SECTION_LABELS: Array<[string, string]> = [
  ['why_read', '我为什么读它'],
  ['before_me', '阅读前的我'],
  ['key_moments', '阅读过程中最重要的时刻'],
  ['resonance', '让我产生共鸣的观点'],
  ['opposition', '让我反对的观点'],
  ['misunderstandings', '我曾经误解过什么'],
  ['changed_mind', '哪些地方改变了我'],
  ['author_intent', '作者真正想表达的'],
  ['acceptance', '我最终是否接受作者'],
  ['impact', '这本书对我的影响'],
  ['reading_after_me', '阅读后的我'],
]

export default function BookReport({ bookId }: { bookId: number }) {
  const { chatStream, streaming } = useAiChat('opencode')
  const [book, setBook] = useState<BookDto | null>(null)
  const [report, setReport] = useState<BookReportDto | null>(null)
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const [b, r, t] = await Promise.all([api.getBook(bookId), api.getReport(bookId), api.getThoughts(bookId)])
    setBook(b)
    setReport(r)
    setThoughts(t)
    if (r) {
      const merged: Record<string, string> = { ...r.sections }
      for (const [k, v] of Object.entries(r.user_edits)) merged[k] = v
      setEdits(merged)
    }
  }, [bookId])

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
  }, [load])

  const generate = async () => {
    setGenerating(true)
    setError('')
    try {
      const ctx = await fetchReaderContext(bookId)
      const msgs = buildChatMessages('book_report', ctx, BOOK_REPORT_SYSTEM)
      msgs.push({
        role: 'user',
        content: '请根据我提供的阅读记录，生成「我与这本书」报告（JSON 输出，字段：why_read, before_me, key_moments, resonance, opposition, misunderstandings, changed_mind, author_intent, acceptance, impact, reading_after_me）。key_moments 和 misunderstandings 为数组，其余为字符串。',
      })
      const result = await chatStream(msgs)
      if (!result.ok) {
        setError(result.error ?? '生成失败')
        return
      }
      const parsed = extractJson<Record<string, unknown>>(result.full)
      if (!parsed) {
        setError('AI 输出格式异常，请重试')
        return
      }
      // 数组字段转字符串存储
      const sections: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        sections[k] = Array.isArray(v) ? (v as string[]).join('；') : String(v ?? '')
      }
      await api.saveReport(bookId, { sections, trajectory: [] })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const saveEdit = async (key: string, value: string) => {
    const next = { ...edits, [key]: value }
    setEdits(next)
    if (report) {
      // 用户编辑以 user_edits 保存（重新生成不覆盖，FR-21 版本区分）
      await api.saveReport(bookId, { user_edits: next })
    }
  }

  if (error && !report) return <div className="card" style={{ color: '#c96a5f' }}>{error}</div>
  if (!book) return <div className="empty">加载中…</div>

  return (
    <div style={{ maxWidth: 760 }}>
      <button style={{ marginBottom: 16 }} onClick={() => (window.location.hash = `#/book/${book.id}`)}>
        ← 返回
      </button>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>我与这本书</h1>
      <div className="muted" style={{ marginBottom: 16 }}>
        《{book.title}》{book.author ? `（${book.author}）` : ''}
      </div>

      {!report && (
        <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📖</div>
          <p style={{ marginBottom: 12 }}>
            读完这本书后，生成属于你的思想档案：<br />
            你曾相信过什么、怀疑过什么、被什么改变。
          </p>
          <button className="primary" disabled={generating || streaming} onClick={generate}>
            {generating || streaming ? '正在生成（AI 整理你的阅读记录）…' : '生成「我与这本书」'}
          </button>
        </div>
      )}

      {report && (
        <>
          {/* 思想变化轨迹（FR-19，真实记录） */}
          {thoughts.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>思想变化轨迹</h3>
              {thoughts.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  <div style={{ flexShrink: 0 }}>
                    <div className="health-dot ok" style={{ marginTop: 5 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{t.content}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {SECTION_LABELS.map(([key, label]) => (
            <div key={key} className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{label}</div>
              {Array.isArray(edits[key]) ? (
                (edits[key] as unknown as string[]).join('；')
              ) : (
                <textarea
                  style={{ width: '100%', minHeight: 56, fontSize: 13.5, lineHeight: 1.7 }}
                  value={edits[key] ?? ''}
                  placeholder="（未生成，可自行填写）"
                  onChange={(e) => saveEdit(key, e.target.value)}
                />
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              disabled={generating || streaming}
              onClick={async () => {
                if (!confirm('重新生成会覆盖 AI 生成的内容（你的手动编辑会保留）。继续？')) return
                await generate()
              }}
            >
              重新生成
            </button>
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              v{report.version} · 编辑内容在重新生成时保留（user_edits）
            </span>
          </div>
        </>
      )}
    </div>
  )
}
