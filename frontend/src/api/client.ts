/** 后端 REST 客户端：统一错误处理（错误 message 直接来自后端中文 detail） */
import type {
  BookDto,
  BookmarkDto,
  BookReportDto,
  ChapterJournalDto,
  HighlightDto,
  NoteDto,
  ReadingIntentDto,
  ThoughtEntry,
} from './types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, options)
  if (!resp.ok) {
    let detail = `请求失败（${resp.status}）`
    try {
      const body = await resp.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ApiError(resp.status, detail)
  }
  if (resp.status === 204) return undefined as T
  return resp.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: () => request<{ app: string; version: string; database: string }>('/health'),

  // 书籍
  importBook: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<BookDto>('/books/import', { method: 'POST', body: form })
  },
  listBooks: () => request<BookDto[]>('/books'),
  getBook: (id: number) => request<BookDto>(`/books/${id}`),
  deleteBook: (id: number) => request<{ ok: boolean }>(`/books/${id}`, { method: 'DELETE' }),
  bookFileUrl: (id: number) => `${BASE}/books/${id}/file`,
  coverUrl: (book: BookDto) => (book.cover_path ? `${BASE}/books/${book.id}/cover` : ''),

  // 进度
  saveProgress: (bookId: number, cfi: string, chapterIndex: number | null, percent: number) =>
    request<{ ok: boolean }>(`/books/${bookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cfi, chapter_index: chapterIndex, percent }),
    }),

  // 高亮 / 笔记 / 书签
  listHighlights: (bookId: number) => request<HighlightDto[]>(`/books/${bookId}/highlights`),
  createHighlight: (bookId: number, h: { chapter_id: number; cfi_start: string; cfi_end: string; selected_text: string; color: string; note?: string | null }) =>
    request<{ id: number }>(`/books/${bookId}/highlights`, json(h)),
  deleteHighlight: (id: number) => request<{ ok: boolean }>(`/highlights/${id}`, { method: 'DELETE' }),

  listNotes: (bookId: number) => request<NoteDto[]>(`/books/${bookId}/notes`),
  createNote: (bookId: number, n: { chapter_id: number; cfi?: string | null; content: string }) =>
    request<{ id: number }>(`/books/${bookId}/notes`, json(n)),
  updateNote: (id: number, content: string) =>
    request<{ ok: boolean }>(`/notes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }),
  deleteNote: (id: number) => request<{ ok: boolean }>(`/notes/${id}`, { method: 'DELETE' }),

  listBookmarks: (bookId: number) => request<BookmarkDto[]>(`/books/${bookId}/bookmarks`),
  createBookmark: (bookId: number, b: { chapter_id: number; cfi: string }) =>
    request<{ id: number }>(`/books/${bookId}/bookmarks`, json(b)),
  deleteBookmark: (id: number) => request<{ ok: boolean }>(`/bookmarks/${id}`, { method: 'DELETE' }),

  // 伴读数据
  saveIntent: (bookId: number, intent: Partial<ReadingIntentDto>) =>
    request<ReadingIntentDto>(`/books/${bookId}/intent`, json(intent)),
  getIntent: (bookId: number) => request<ReadingIntentDto | null>(`/books/${bookId}/intent`),
  saveJournal: (bookId: number, j: Partial<ChapterJournalDto> & { chapter_id: number }) =>
    request<ChapterJournalDto>(`/books/${bookId}/journals`, json(j)),
  listJournals: (bookId: number) => request<ChapterJournalDto[]>(`/books/${bookId}/journals`),
  saveReport: (bookId: number, r: { sections?: Record<string, string>; trajectory?: unknown[]; user_edits?: Record<string, string> }) =>
    request<BookReportDto>(`/books/${bookId}/reports`, json(r)),
  getReport: (bookId: number) => request<BookReportDto | null>(`/books/${bookId}/reports`),
  getThoughts: (bookId: number) => request<ThoughtEntry[]>(`/books/${bookId}/thoughts`),
  recordAiMessage: (m: { session_key: string; role: string; content: string; source_tag?: string | null; provider?: string; model?: string; prompt_tokens?: number; completion_tokens?: number; latency_ms?: number }) =>
    request<{ id: number }>('/ai/messages', json(m)),
  listAiMessages: (sessionKey?: string) => request<unknown[]>(`/ai/messages${sessionKey ? `?session_key=${encodeURIComponent(sessionKey)}` : ''}`),

  // 设置
  getSettings: () => request<Record<string, Record<string, unknown>>>(`/settings`),
  putSetting: (key: string, value: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/settings/${key}`, json({ value_json: value })),

  // 备份
  exportBackup: () => fetch(`${BASE}/backup/export`).then((r) => (r.ok ? r.blob() : Promise.reject(new ApiError(r.status, '导出失败')))),
  importBackup: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ ok: boolean }>('/backup/import', { method: 'POST', body: form })
  },
}
