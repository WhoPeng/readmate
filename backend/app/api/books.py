"""书籍接口：导入 / 列表 / 详情 / 删除 / 文件与封面下载。"""
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db import get_db
from app.models.book import Book
from app.services.book_service import BookImportError, delete_book, import_book
from app.services.journal_service import intent_to_dict, journal_to_dict, report_to_dict

router = APIRouter(tags=["books"])


def _book_dict(book: Book, chapters: bool = False) -> dict:
    data = {
        "id": book.id,
        "title": book.title,
        "author": book.author,
        "cover_path": book.cover_path,
        "format": book.format,
        "status": book.status,
        "percent": round(book.percent, 1),
        "progress_cfi": book.progress_cfi,
        "current_chapter_index": book.current_chapter_index,
        "metadata": json.loads(book.metadata_json or "{}"),
        "created_at": book.created_at.isoformat() if book.created_at else None,
        "chapter_count": len(book.chapters),
    }
    if chapters:
        data["chapters"] = [
            {
                "id": ch.id,
                "index": ch.index,
                "toc_title": ch.toc_title,
                "chapter_cfi": ch.chapter_cfi,
                "toc_level": ch.toc_level,
                "word_count": ch.word_count,
            }
            for ch in book.chapters
        ]
    return data


def _get_book_or_404(db: Session, book_id: int) -> Book:
    book = db.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="书籍不存在")
    return book


@router.post("/books/import")
async def api_import_book(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """导入 EPUB（FR-01）：校验 → 指纹去重 → 解析 → 入库。"""
    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件超过 200MB 限制")
    try:
        book = import_book(db, file.filename or "book.epub", content)
    except BookImportError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return _book_dict(book, chapters=True)


@router.get("/books")
def api_list_books(db: Session = Depends(get_db)):
    """书架列表，按最近导入倒序（FR-03）。"""
    books = db.execute(select(Book).order_by(Book.created_at.desc())).scalars().all()
    return [_book_dict(b) for b in books]


@router.get("/books/{book_id}")
def api_book_detail(book_id: int, db: Session = Depends(get_db)):
    """书籍详情：元数据 + 目录树 + 伴读状态（FR-03/FR-14/FR-18）。"""
    book = _get_book_or_404(db, book_id)
    result = _book_dict(book, chapters=True)
    result["intent"] = None
    result["latest_journal"] = None
    result["report"] = None
    from app.models.journal import BookReport, ChapterJournal, ReadingIntent

    intent = db.execute(
        select(ReadingIntent).where(ReadingIntent.book_id == book_id).order_by(ReadingIntent.version.desc())
    ).scalars().first()
    if intent:
        result["intent"] = intent_to_dict(intent)
    journal = db.execute(
        select(ChapterJournal).where(ChapterJournal.book_id == book_id).order_by(ChapterJournal.created_at.desc())
    ).scalars().first()
    if journal:
        result["latest_journal"] = journal_to_dict(journal)
    report = db.execute(
        select(BookReport).where(BookReport.book_id == book_id).order_by(BookReport.version.desc())
    ).scalars().first()
    if report:
        result["report"] = report_to_dict(report)
    return result


@router.delete("/books/{book_id}")
def api_delete_book(book_id: int, db: Session = Depends(get_db)):
    book = _get_book_or_404(db, book_id)
    delete_book(db, book)
    return {"ok": True}


@router.get("/books/{book_id}/file")
def api_book_file(book_id: int, db: Session = Depends(get_db)):
    """返回 EPUB 原文件（epub.js book.load 使用）。"""
    book = _get_book_or_404(db, book_id)
    return FileResponse(book.file_path, media_type="application/epub+zip", filename=f"{book.title}.epub")


@router.get("/books/{book_id}/cover")
def api_book_cover(book_id: int, db: Session = Depends(get_db)):
    book = _get_book_or_404(db, book_id)
    if not book.cover_path:
        raise HTTPException(status_code=404, detail="无封面")
    return FileResponse(book.cover_path, media_type="image/jpeg" if book.cover_path.endswith("jpg") else "image/png")


@router.get("/chapters/{chapter_id}/text")
def api_chapter_text(chapter_id: int, db: Session = Depends(get_db)):
    """按需提取章节纯文本（AI Context 用；正文不落库，渲染仍由 epub.js 完成）。"""
    from app.models.book import Chapter
    from app.services.book_service import extract_chapter_text

    chapter = db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=404, detail="章节不存在")
    book = db.get(Book, chapter.book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="书籍不存在")
    return {"chapter_id": chapter_id, "text": extract_chapter_text(book, chapter)}
