/**
 * 阅读档案首页（步骤 19 验收：FR-22，MVP 简化版）。
 * 我的想法（全部章节最终想法聚合）｜ 我的问题（访谈与反思中的问题）
 * 主题标签（自动提取 1~3 个，可手动编辑）
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { BookDto, ChapterJournalDto } from '../api/types'

export default function Archive() {
  const [books, setBooks] = useState<BookDto[]>([])
  const [journals, setJournals] = useState<Record<number, ChapterJournalDto[]>>({})
  const [tags, setTags] = useState<Record<number, string[]>>({})
  const [tagInput, setTagInput] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const list = await api.listBooks()
    setBooks(list)
    const jMap: Record<number, ChapterJournalDto[]> = {}
    await Promise.all(
      list.map(async (b) => {
        jMap[b.id] = await api.listJournals(b.id)
      }),
    )
    setJournals(jMap)

    // 标签：settings 读取 + 自动提取（从书名关键词，MVP 简化规则）
    const settings = await api.getSettings().catch(() => ({}))
    const saved = (settings as Record<string, Record<string, unknown>>).book_tags as
      | Record<number, string[]>
      | undefined
    const auto: Record<number, string[]> = {}
    for (const b of list) {
      auto[b.id] = saved?.[b.id] ?? [b.title.slice(0, 4)]
    }
    setTags(auto)
    setLoading(false)
  }, [])

  useEffect(() => {
    load().catch((e) => console.error(e))
  }, [load])

  const saveTags = async (bookId: number, next: string[]) => {
    const updated = { ...tags, [bookId]: next }
    setTags(updated)
    await api.putSetting('book_tags', updated)
  }

  if (loading) return <div className="empty">加载中…</div>

  const allThoughts = books.flatMap((b) =>
    (journals[b.id] ?? [])
      .filter((j) => j.final_thought)
      .map((j) => ({ book: b, chapterTitle: b.chapters?.find((c) => c.id === j.chapter_id)?.toc_title ?? `第${j.chapter_id}章`, thought: j.final_thought, level: j.agreement_level })),
  )
  const allQuestions = books.flatMap((b) => {
    const intentQ = b.intent?.personal_questions ? [{ book: b, q: b.intent.personal_questions, from: '阅读前' }] : []
    const journalQ = (journals[b.id] ?? [])
      .filter((j) => j.reader_questions)
      .map((j) => ({ book: b, q: j.reader_questions, from: '章节反思' }))
    return [...intentQ, ...journalQ]
  })

  return (
    <div style={{ maxWidth: 860 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>我的阅读档案</h2>

      {/* 主题标签 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>主题</h3>
        {books.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>《{b.title}》</span>
            {(tags[b.id] ?? []).map((t) => (
              <span key={t} style={{ background: 'var(--accent-soft)', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>
                {t}
              </span>
            ))}
            <input
              style={{ width: 120, fontSize: 12, padding: '2px 8px' }}
              placeholder="添加标签"
              value={tagInput[b.id] ?? ''}
              onChange={(e) => setTagInput({ ...tagInput, [b.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput[b.id]?.trim()) {
                  saveTags(b.id, [...(tags[b.id] ?? []), tagInput[b.id].trim()])
                  setTagInput({ ...tagInput, [b.id]: '' })
                }
              }}
            />
          </div>
        ))}
        {books.length === 0 && <div className="muted" style={{ fontSize: 13 }}>还没有书</div>}
      </div>

      {/* 我的想法 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>我的想法（{allThoughts.length}）</h3>
        {allThoughts.map((t, i) => (
          <div key={i} style={{ marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>
              《{t.book.title}》· {t.chapterTitle}
              {t.level && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>{t.level}</span>}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>{t.thought}</div>
          </div>
        ))}
        {allThoughts.length === 0 && <div className="muted" style={{ fontSize: 13 }}>还没有想法——读完一章并完成反思后，你的最终想法会出现在这里。</div>}
      </div>

      {/* 我的问题 */}
      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>我的问题（{allQuestions.length}）</h3>
        {allQuestions.map((q, i) => (
          <div key={i} style={{ marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 2 }}>
              《{q.book.title}》· {q.from}
            </div>
            <div style={{ fontSize: 13.5 }}>{q.q}</div>
          </div>
        ))}
        {allQuestions.length === 0 && <div className="muted" style={{ fontSize: 13 }}>还没有问题。</div>}
      </div>
    </div>
  )
}
