/**
 * epub.js 0.2.15 类型声明（UMD 全局加载，仅声明本项目用到的 API 子集）。
 * 包本体：public/vendor/epub.js（全局变量 ePub）
 */

interface EpubLocation {
  start: { cfi: string; index: number }
  end?: { cfi: string; index: number }
  percentage?: number
}

interface EpubNavigationItem {
  label: string
  href: string
  subitems?: EpubNavigationItem[]
}

interface EpubAnnotations {
  add(kind: 'highlight' | 'underline', cfi: string, data: unknown, cb?: () => void, className?: string, cb2?: () => void): unknown
  remove(kind: string, cfi: string, className?: string): void
}

interface EpubRendition {
  display(target?: string | number): Promise<unknown>
  renderTo(element: HTMLElement, options: Record<string, unknown>): EpubRendition
  on(event: 'relocated', cb: (location: EpubLocation) => void): EpubRendition
  on(event: string, cb: (...args: unknown[]) => void): EpubRendition
  off(event: string, cb?: (...args: unknown[]) => void): EpubRendition
  annotations: EpubAnnotations
  highlight(cfi: string, cb?: () => void, className?: string): void
  highlightRange(range: Range, className?: string, cb?: () => void): void
  getRange(cfi: string): Range | null
  destroy(): void
  currentLocation(): EpubLocation
  next(): Promise<unknown>
  prev(): Promise<unknown>
  themes: {
    register(theme: string, styles: Record<string, string>): void
    select(theme: string): void
    fontSize(size: string): void
    font(size: string): void
    override(key: string, value: string): void
  }
}

interface EpubBook {
  ready: Promise<unknown>
  loaded: {
    metadata: Promise<{ title: string; author: string }>
    navigation: Promise<{ toc: EpubNavigationItem[] }>
  }
  locations: {
    generate(chars?: number): Promise<number>
    percentageFromCfi(cfi: string): number
    cfiFromPercentage(percentage: number): string
    length: number
  }
  spine: Array<{ index: number; href: string }>
  cfiFromRange(range: Range): string
  getRange(cfi: string): Range | null
  destroy(): void
}

interface EpubJsConstructor {
  (url: string, options?: Record<string, unknown>): EpubBook
}

declare global {
  interface Window {
    ePub: EpubJsConstructor
  }
}

export {}
