"""SQLAlchemy ORM 模型集合（与设计文档第 9 节 Schema 一致）。"""
from app.models.book import Book, Chapter, Highlight, Note, Bookmark
from app.models.journal import ReadingIntent, ChapterJournal, BookReport, AiMessage, ReaderThought
from app.models.memory import ReaderMemory
from app.models.setting import Setting

__all__ = [
    "Book", "Chapter", "Highlight", "Note", "Bookmark",
    "ReadingIntent", "ChapterJournal", "BookReport", "AiMessage", "ReaderThought",
    "ReaderMemory", "Setting",
]
