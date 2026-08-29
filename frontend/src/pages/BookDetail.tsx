/** 书籍详情页（步骤 06 验收：FR-03）：封面/元数据/目录树/阅读入口/意图卡 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { BookDto } from '../api/types'

export default function BookDetail({ bookId }: { bookId: number }) {
  const [book, setBook] = useState<BookDto | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setBook(await api.getBook(bookId))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [bookId])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <div className="card" style={{ color: '#c96a5f' }}>{error}</div>
  if (!book) return <div className="empty">加载中…</div>

  const startReading = () => (window.location.hash = `#/reader/${book.id}`)

  return (
    <div>
      <button style={{ marginBottom: 16 }} onClick={() => (window.location.hash = '#/library')}>
        ← 返回书架
      </button>
      <div style={{ display: 'flex', gap: 24 }}>
        <div className="book-cover" style={{ width: 180, flexShrink: 0 }}>
          {api.coverUrl(book) ? <img src={api.coverUrl(book)} alt={book.title} /> : '📖'}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, marginBottom: 6 }}>{book.title}</h1>
          <div className="muted" style={{ marginBottom: 12 }}>{book.author}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="primary" onClick={startReading}>
              {book.status === 'finished' ? '重新阅读' : book.status === 'reading' ? '继续阅读' : '开始阅读'}
            </button>
            {book.status !== 'unread' && <span className="muted" style={{ alignSelf: 'center' }}>已读 {book.percent}%</span>}
          </div>
          {book.intent && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>阅读意图</div>
              {book.intent.motivation && <div className="muted" style={{ fontSize: 13 }}>动机：{book.intent.motivation}</div>}
              {book.intent.expected_gain && <div className="muted" style={{ fontSize: 13 }}>期待：{book.intent.expected_gain}</div>}
            </div>
          )}
          {book.latest_journal && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>最近章节记录</div>
              <div className="muted" style={{ fontSize: 13 }}>{book.latest_journal.final_thought || book.latest_journal.ai_feedback}</div>
            </div>
          )}
        </div>
      </div>

      <h2 style={{ fontSize: 16, margin: '24px 0 12px' }}>目录</h2>
      <div className="card">
        {book.chapters?.map((ch) => (
          <div
            key={ch.id}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              marginLeft: (ch.toc_level - 1) * 16,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={startReading}
          >
            <span style={{ fontSize: 14 }}>{ch.toc_title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
