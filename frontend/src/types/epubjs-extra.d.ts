/** 补充 epubjs 0.3.93 官方类型缺失的 API（模块增强） */
declare module 'epubjs' {
  interface Book {
    /** 从 DOM Range 生成 CFI 锚点（高亮持久化关键 API） */
    cfiFromRange(range: Range): string
    getRange(cfi: string): Range | null
  }
}

export {}
