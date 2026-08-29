/**
 * epub.js 阅读器封装（步骤 07/08/10 核心，参考 Koodo Reader 用法）。
 *
 * - 渲染：epub.js 直接加载 EPUB 原文件（后端 /api/books/{id}/file）
 * - 定位：CFI 体系（章节跳转 / 进度 / 高亮锚点）
 * - 高亮：rendition.annotations.add('highlight', cfi, ...) 持久化锚点还原
 */
import { useEffect, useRef } from 'react'
import ePub, { EpubCFI } from 'epubjs'

export interface EpubRelocated {
  cfi: string
  chapterIndex: number
  percent: number
}

export interface EpubViewerProps {
  url: string
  initialCfi?: string | null
  fontSize: number // px
  lineHeight: number
  theme: 'light' | 'sepia' | 'dark'
  highlights: Array<{ cfi_start: string; cfi_end: string; color: string }>
  onRelocated: (loc: EpubRelocated) => void
  /** 用户选中文字并点高亮时回调（CFI 锚点由封装层生成） */
  onHighlightRequest?: (cfiStart: string, cfiEnd: string, text: string) => void
  /** 阅读器实例就绪（暴露给父组件做章节跳转等） */
  onReady?: (ctrl: EpubViewerCtrl) => void
}

export interface EpubViewerCtrl {
  displayChapter(index: number): Promise<void>
  displayCfi(cfi: string): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  destroy(): void
}

const COLOR_CLASS: Record<string, string> = {
  yellow: 'rm-highlight-yellow',
  green: 'rm-highlight-green',
  blue: 'rm-highlight-blue',
}

export default function EpubViewer({
  url,
  initialCfi,
  fontSize,
  lineHeight,
  theme,
  highlights,
  onRelocated,
  onHighlightRequest,
  onReady,
}: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<any>(null)
  const renditionRef = useRef<any>(null)
  const appliedHighlightsRef = useRef<Set<string>>(new Set())
  const relocatedRef = useRef(onRelocated)
  relocatedRef.current = onRelocated

  /** 初始化：加载书 + 渲染 + 事件绑定 */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const book = ePub(url, { openAs: 'epub' })
    bookRef.current = book
    const rendition = book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
      allowScriptedContent: false,
    })
    renditionRef.current = rendition

    let disposed = false

    rendition.on('relocated', (location: any) => {
      if (disposed) return
      const start = location?.start
      if (!start?.cfi) return
      let percent = 0
      try {
        percent = book.locations?.percentageFromCfi(start.cfi) || 0
      } catch {
        /* locations 未生成完成时忽略 */
      }
      relocatedRef.current({
        cfi: start.cfi,
        chapterIndex: start.index ?? -1,
        percent: Math.round(percent * 1000) / 10,
      })
    })

    const ctrl: EpubViewerCtrl = {
      displayChapter: async (index: number) => {
        const spineItem = book.spine?.get(index)
        if (spineItem) await rendition.display(spineItem.href)
      },
      displayCfi: async (cfi: string) => {
        await rendition.display(cfi)
      },
      next: () => rendition.next(),
      prev: () => rendition.prev(),
      destroy: () => {
        disposed = true
        rendition.destroy()
        book.destroy()
      },
    }

    // 选中文字 → 高亮工具条。
    // epub.js 正文渲染在 iframe 内：事件不会冒泡到父文档，
    // 必须监听内容文档（rendered 事件每次换章都会触发新视图）。
    const bindSelection = (contentDoc: Document) => {
      const onMouseUp = () => {
        window.setTimeout(() => {
          const sel = contentDoc.getSelection()
          if (!sel || sel.isCollapsed) return
          const text = sel.toString().trim()
          if (!text) return
          const range = sel.getRangeAt(0)
          let cfiStart = ''
          let cfiEnd = ''
          try {
            // epubjs 0.3.x：Range → CFI 字符串。
            // fromRange 返回纯对象（无 toString），需合并进 EpubCFI 实例再 toString。
            // base = 章节 CFI 前缀（不含 epubcfi( 前缀，parseComponent 期望组件串，
            // 如 /6/4[ch1.xhtml]! —— spinePos 取自 steps[1].index）
            const locCfi = rendition.currentLocation()?.start?.cfi ?? ''
            const bang = locCfi.indexOf('!')
            const base = bang >= 0 ? locCfi.slice('epubcfi('.length, bang + 1) : ''
            const toCfiString = (r: Range) =>
              String(Object.assign(new EpubCFI(), new EpubCFI().fromRange(r, base)))
            cfiStart = toCfiString(range)
            const clone = range.cloneRange()
            clone.setEnd(range.endContainer, range.endOffset)
            cfiEnd = toCfiString(clone)
          } catch (err) {
            console.warn('[readmate] CFI 生成失败', err)
          }
          if (cfiStart && cfiEnd && onHighlightRequest) {
            onHighlightRequest(cfiStart, cfiEnd, text.slice(0, 500))
          }
        }, 0)
      }
      contentDoc.addEventListener('mouseup', onMouseUp)
    }
    rendition.on('rendered', (_section: any, view: any) => {
      const doc = view?.document as Document | undefined
      if (doc) bindSelection(doc)
    })

    book.ready.then(() => {
      if (disposed) return
      return rendition.display(initialCfi || undefined).then(() => {
        onReady?.(ctrl)
        // 预生成分页位置（用于百分比计算）
        book.locations?.generate(1200).catch(() => undefined)
      })
    })

    return () => {
      disposed = true
      rendition.destroy()
      book.destroy()
      bookRef.current = null
      renditionRef.current = null
      appliedHighlightsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  /** 高亮渲染：增量应用（避免重复渲染累积） */
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    for (const h of highlights) {
      if (appliedHighlightsRef.current.has(h.cfi_start)) continue
      const cls = COLOR_CLASS[h.color] || COLOR_CLASS.yellow
      try {
        if (rendition.annotations?.add) {
          rendition.annotations.add('highlight', h.cfi_start, {}, undefined, cls)
        } else if (rendition.highlight) {
          rendition.highlight(h.cfi_start, undefined, cls)
        }
        appliedHighlightsRef.current.add(h.cfi_start)
      } catch {
        /* CFI 失效的高亮跳过（如排版变化） */
      }
    }
  }, [highlights])

  /** 阅读偏好实时生效 */
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition?.themes) return
    try {
      rendition.themes.fontSize(`${fontSize}px`)
      rendition.themes.override('line-height', String(lineHeight))
      rendition.themes.override('color', theme === 'dark' ? '#c9c7c1' : '#2b2a28')
    } catch {
      /* 主题未就绪时忽略 */
    }
  }, [fontSize, lineHeight, theme])

  return <div ref={containerRef} className="epub-viewer" style={{ width: '100%', height: '100%' }} />
}
