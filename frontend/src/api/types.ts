/** 后端 REST 响应类型（与 backend/app/api 返回结构对应） */

export interface ChapterDto {
  id: number
  index: number
  toc_title: string
  chapter_cfi: string
  toc_level: number
  word_count: number
}

export interface BookDto {
  id: number
  title: string
  author: string
  cover_path: string | null
  format: string
  status: 'unread' | 'reading' | 'finished'
  percent: number
  current_chapter_index: number | null
  metadata: Record<string, unknown>
  chapter_count: number
  chapters?: ChapterDto[]
  intent?: ReadingIntentDto | null
  latest_journal?: ChapterJournalDto | null
  report?: BookReportDto | null
}

export interface ReadingIntentDto {
  id: number
  book_id: number
  version: number
  motivation: string
  expected_gain: string
  interested_topics: string
  personal_questions: string
  emotional_context: string
  status: string
  created_at: string | null
}

export interface HighlightDto {
  id: number
  book_id: number
  chapter_id: number
  cfi_start: string
  cfi_end: string
  selected_text: string
  color: string
  note: string | null
  created_at: string | null
}

export interface NoteDto {
  id: number
  chapter_id: number
  cfi: string | null
  content: string
  created_at: string | null
  updated_at: string | null
}

export interface BookmarkDto {
  id: number
  chapter_id: number
  cfi: string
  created_at: string | null
}

export interface ChapterJournalDto {
  id: number
  book_id: number
  chapter_id: number
  version: number
  reading_seconds: number
  reader_feeling: string
  reader_understanding: string
  reader_questions: string
  ai_feedback: string
  author_position: Record<string, string>
  agreement_level: string
  disagreement: string
  misunderstanding: string
  changed_mind: string
  final_thought: string
  status: string
  created_at: string | null
  updated_at: string | null
}

export interface BookReportDto {
  id: number
  book_id: number
  version: number
  sections: Record<string, string>
  trajectory: Array<{ stage: string; title: string; content: string }>
  user_edits: Record<string, string>
  created_at: string | null
}

export interface ThoughtEntry {
  stage: string
  title: string
  content: string
}
