/** 书架页（步骤 05 验收：FR-01/FR-03）：书籍卡片 + 导入对话框 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { BookDto } from '../api/types'

export default function Library() {
  const [books, setBooks] = useState<BookDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setBooks(await api.listBooks())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onPickFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      setImportMsg('仅支持 EPUB 格式')
      return
    }
    setImporting(true)
    setImportMsg('正在导入…')
    try {
      await api.importBook(file)
      setImportMsg(`《${file.name.replace(/\.epub$/i, '')}》导入成功`)
      await load()
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18 }}>书架</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".epub"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
        />
        <button className="primary" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? '导入中…' : '+ 导入 EPUB'}
        </button>
        {importMsg && <span className="muted" style={{ fontSize: 13 }}>{importMsg}</span>}
      </div>

      {error && <div className="card" style={{ borderColor: '#c96a5f', color: '#c96a5f', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="empty">加载中…</div>
      ) : books.length === 0 ? (
        <div className="empty">
          <div className="big">📚</div>
          <div>书架还是空的</div>
          <div style={{ marginTop: 8 }}>点击右上角「导入 EPUB」开始你的第一本书</div>
        </div>
      ) : (
        <div className="library-grid">
          {books.map((book) => (
            <div key={book.id} className="card book-card" onClick={() => (window.location.hash = `#/book/${book.id}`)}>
              <div className="book-cover">
                {api.coverUrl(book) ? <img src={api.coverUrl(book)} alt={book.title} /> : '📖'}
              </div>
              <div className="title" title={book.title}>{book.title}</div>
              <div className="author">{book.author}</div>
              <div className="progress-bar">
                <div style={{ width: `${book.percent}%` }} />
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {book.status === 'finished' ? '已读完' : `${book.percent}%`} · {book.chapter_count} 章
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
