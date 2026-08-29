/**
 * 阅读器页（步骤 07/08/09/10 验收：FR-04~09）。
 * 三栏：目录树 | 正文（epub.js） | 伴读面板（步骤 15 启用，当前为占位）
 * 功能：翻页/章节跳转/进度自动保存（防抖）/阅读设置/高亮+笔记/「读完本章」
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import EpubViewer, { type EpubViewerCtrl, type EpubRelocated } from '../reader/EpubViewer'
import ReflectionPanel, { type ReflectionMode } from '../components/ReflectionPanel'
import { api } from '../api/client'
import type { BookDto, HighlightDto } from '../api/types'

const FONT_SIZES = [15, 17, 19, 22, 25]
const LINE_HEIGHTS = [1.5, 1.75, 2.0]
const THEMES = ['light', 'sepia', 'dark'] as const
const COLORS = [
  { key: 'yellow', label: '黄' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
]

export default function Reader({ bookId }: { bookId: number }) {
  const [book, setBook] = useState<BookDto | null>(null)
  const [ctrl, setCtrl] = useState<EpubViewerCtrl | null>(null)
  const [currentChapter, setCurrentChapter] = useState<number | null>(null)
  const [percent, setPercent] = useState(0)
  const [highlights, setHighlights] = useState<HighlightDto[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fontSize, setFontSize] = useState(19)
  const [lineHeight, setLineHeight] = useState(1.75)
  const [theme, setTheme] = useState<'light' | 'sepia' | 'dark'>('light')
  const [pendingHighlight, setPendingHighlight] = useState<{ cfiStart: string; cfiEnd: string; text: string } | null>(null)
  const [noteForHighlight, setNoteForHighlight] = useState('')
  const [panelMode, setPanelMode] = useState<ReflectionMode | null>(null)
  const [reflectChapter, setReflectChapter] = useState<number | null>(null)
  const saveTimer = useRef<number | null>(null)

  // 加载书籍与标注
  useEffect(() => {
    let cancelled = false
    Promise.all([api.getBook(bookId), api.listHighlights(bookId)])
      .then(([b, hs]) => {
        if (cancelled) return
        setBook(b)
        setHighlights(hs)
        setPercent(b.percent)
        setCurrentChapter(b.current_chapter_index)
        // FR-13：新书首次打开 → 自动启动阅读前访谈（已跳过/已完成的不再打扰）
        const hasIntent = b.intent && b.intent.status !== 'in_progress'
        if (!hasIntent) {
          setPanelOpen(true)
          setPanelMode('interview')
        }
      })
      .catch((e) => console.error('加载阅读器数据失败', e))
    return () => {
      cancelled = true
    }
  }, [bookId])

  // 阅读偏好持久化 + 应用
  useEffect(() => {
    document.body.dataset.theme = theme
    api.putSetting('reader', { fontSize, lineHeight, theme }).catch(() => undefined)
  }, [fontSize, lineHeight, theme])

  const onRelocated = useCallback(
    (loc: EpubRelocated) => {
      setCurrentChapter(loc.chapterIndex >= 0 ? loc.chapterIndex : currentChapter)
      setPercent(loc.percent)
      // 防抖保存进度（FR-04 自动保存）
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        api.saveProgress(bookId, loc.cfi, loc.chapterIndex, loc.percent).catch(() => undefined)
      }, 1500)
    },
    [bookId, currentChapter],
  )

  const onReady = useCallback((c: EpubViewerCtrl) => setCtrl(c), [])

  const onHighlightRequest = useCallback((cfiStart: string, cfiEnd: string, text: string) => {
    setPendingHighlight({ cfiStart, cfiEnd, text })
    setNoteForHighlight('')
  }, [])

  const confirmHighlight = async (color: string) => {
    if (!pendingHighlight || !book) return
    const chapter = book.chapters?.find((c) => c.index === currentChapter)
    try {
      await api.createHighlight(bookId, {
        chapter_id: chapter?.id ?? 0,
        cfi_start: pendingHighlight.cfiStart,
        cfi_end: pendingHighlight.cfiEnd,
        selected_text: pendingHighlight.text,
        color,
        note: noteForHighlight || null,
      })
      setHighlights(await api.listHighlights(bookId))
    } catch (e) {
      console.error('高亮失败', e)
    }
    setPendingHighlight(null)
  }

  const deleteHighlight = async (id: number) => {
    if (!confirm('删除这条高亮？')) return
    await api.deleteHighlight(id)
    setHighlights(await api.listHighlights(bookId))
  }

  const jumpToChapter = async (index: number) => {
    await ctrl?.displayChapter(index)
  }

  if (!book) return <div className="empty">加载中…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶栏 */}
      <div className="topbar" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => (window.location.hash = `#/book/${book.id}`)}>←</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{book.title}</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {book.chapters?.[currentChapter ?? 0]?.toc_title ?? ''}
        </span>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12 }}>{Math.round(percent)}%</span>
        <button onClick={() => setPanelOpen((v) => !v)} style={{ background: panelOpen ? 'var(--accent-soft)' : undefined }}>
          伴读
        </button>
        <button onClick={() => setSettingsOpen((v) => !v)}>Aa 设置</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 左：目录树 */}
        <div style={{ width: 220, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '8px 0', flexShrink: 0 }}>
          {book.chapters?.map((ch) => (
            <div
              key={ch.id}
              onClick={() => jumpToChapter(ch.index)}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                cursor: 'pointer',
                marginLeft: (ch.toc_level - 1) * 12,
                background: ch.index === currentChapter ? 'var(--accent-soft)' : undefined,
                borderRadius: 4,
              }}
            >
              {ch.toc_title}
            </div>
          ))}
        </div>

        {/* 中：正文 */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <EpubViewer
              url={api.bookFileUrl(book.id)}
              initialCfi={book.progress_cfi ?? null}
              fontSize={fontSize}
              lineHeight={lineHeight}
              theme={theme}
              highlights={highlights.map((h) => ({ cfi_start: h.cfi_start, cfi_end: h.cfi_end, color: h.color }))}
              onRelocated={onRelocated}
              onHighlightRequest={onHighlightRequest}
              onReady={onReady}
            />
          </div>
          {/* 选区工具条 */}
          {pendingHighlight && (
            <div className="card" style={{ position: 'absolute', bottom: 72, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, alignItems: 'center', zIndex: 20 }}>
              {COLORS.map((c) => (
                <button key={c.key} onClick={() => confirmHighlight(c.key)} title={`高亮为${c.label}色`}>
                  {c.label}
                </button>
              ))}
              <input
                style={{ width: 140 }}
                placeholder="附注（可选）"
                value={noteForHighlight}
                onChange={(e) => setNoteForHighlight(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmHighlight('yellow')}
              />
              <button onClick={() => setPendingHighlight(null)}>取消</button>
            </div>
          )}
          {/* 底栏：读完本章 → 章节反思（FR-15） */}
          <div style={{ padding: 10, textAlign: 'center', borderTop: '1px solid var(--border)' }}>
            <button
              className="primary"
              style={{ width: 220 }}
              onClick={() => {
                setReflectChapter(currentChapter)
                setPanelMode('reflect')
                setPanelOpen(true)
              }}
            >
              读完本章，开始反思
            </button>
          </div>
        </div>

        {/* 右：伴读面板（访谈 / 章节反思） */}
        {panelOpen && (
          <div style={{ width: 360, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {panelMode && book && (
              <ReflectionPanel
                book={book}
                mode={panelMode}
                chapterId={panelMode === 'reflect' ? (reflectChapter ?? currentChapter ?? undefined) : undefined}
                onDone={(kind) => {
                  if (kind === 'journal') {
                    // 反思完成：刷新书籍信息（最新 Journal）
                    api.getBook(bookId).then((b) => setBook(b)).catch(() => undefined)
                  }
                  if (kind === 'skipped' || kind === 'intent') {
                    api.getBook(bookId).then((b) => setBook(b)).catch(() => undefined)
                  }
                }}
              />
            )}
          </div>
        )}

        {/* 设置弹窗 */}
        {settingsOpen && (
          <div className="modal-mask" onClick={() => setSettingsOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>阅读设置</h3>
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>字体大小</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {FONT_SIZES.map((s) => (
                    <button key={s} style={{ background: s === fontSize ? 'var(--accent-soft)' : undefined }} onClick={() => setFontSize(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>行距</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {LINE_HEIGHTS.map((l) => (
                    <button key={l} style={{ background: l === lineHeight ? 'var(--accent-soft)' : undefined }} onClick={() => setLineHeight(l)}>
                      {l === 1.5 ? '紧凑' : l === 1.75 ? '适中' : '宽松'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>主题</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {THEMES.map((t) => (
                    <button key={t} style={{ background: t === theme ? 'var(--accent-soft)' : undefined }} onClick={() => setTheme(t)}>
                      {t === 'light' ? '亮' : t === 'sepia' ? '米黄' : '夜间'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>我的标注（{highlights.length}）</div>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {highlights.map((h) => (
                    <div key={h.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                      <span style={{ flex: 1, color: 'var(--fg-muted)' }}>{h.selected_text.slice(0, 30)}</span>
                      <button style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => deleteHighlight(h.id)}>
                        删
                      </button>
                    </div>
                  ))}
                  {highlights.length === 0 && <div className="muted" style={{ fontSize: 12 }}>还没有高亮</div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
