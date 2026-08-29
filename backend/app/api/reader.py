"""阅读器数据接口：进度 / 高亮 / 笔记 / 书签（CFI 锚点，FR-04~FR-08）。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db import get_db
from app.models.book import Book, Bookmark, Highlight, Note

router = APIRouter(tags=["reader"])


def _get_book_or_404(db: Session, book_id: int) -> Book:
    book = db.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="书籍不存在")
    return book


# ---------- 阅读进度（FR-04：自动保存，防抖由前端控制） ----------

class ProgressPayload(BaseModel):
    cfi: str
    chapter_index: int | None = None
    percent: float = 0.0


@router.put("/books/{book_id}/progress")
def api_save_progress(book_id: int, payload: ProgressPayload, db: Session = Depends(get_db)):
    book = _get_book_or_404(db, book_id)
    book.progress_cfi = payload.cfi
    if payload.chapter_index is not None:
        book.current_chapter_index = payload.chapter_index
    book.percent = max(0.0, min(100.0, payload.percent))
    book.status = "finished" if book.percent >= 99.5 else ("reading" if book.percent > 0 else book.status)
    db.commit()
    return {"ok": True}


# ---------- 高亮（FR-06：CFI 锚点持久化） ----------

class HighlightPayload(BaseModel):
    chapter_id: int
    cfi_start: str
    cfi_end: str
    selected_text: str = ""
    color: str = "yellow"
    note: str | None = None


@router.get("/books/{book_id}/highlights")
def api_list_highlights(book_id: int, db: Session = Depends(get_db)):
    rows = db.execute(
        select(Highlight).where(Highlight.book_id == book_id).order_by(Highlight.id)
    ).scalars().all()
    return [
        {
            "id": h.id, "book_id": h.book_id, "chapter_id": h.chapter_id,
            "cfi_start": h.cfi_start, "cfi_end": h.cfi_end,
            "selected_text": h.selected_text, "color": h.color, "note": h.note,
            "created_at": h.created_at.isoformat() if h.created_at else None,
        }
        for h in rows
    ]


@router.post("/books/{book_id}/highlights")
def api_create_highlight(book_id: int, payload: HighlightPayload, db: Session = Depends(get_db)):
    h = Highlight(
        book_id=book_id,
        chapter_id=payload.chapter_id,
        cfi_start=payload.cfi_start,
        cfi_end=payload.cfi_end,
        selected_text=payload.selected_text,
        color=payload.color,
        note=payload.note,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return {"id": h.id}


@router.put("/highlights/{highlight_id}")
def api_update_highlight(highlight_id: int, payload: HighlightPayload, db: Session = Depends(get_db)):
    h = db.get(Highlight, highlight_id)
    if h is None:
        raise HTTPException(status_code=404, detail="高亮不存在")
    h.cfi_start, h.cfi_end = payload.cfi_start, payload.cfi_end
    h.selected_text, h.color, h.note = payload.selected_text, payload.color, payload.note
    db.commit()
    return {"ok": True}


@router.delete("/highlights/{highlight_id}")
def api_delete_highlight(highlight_id: int, db: Session = Depends(get_db)):
    h = db.get(Highlight, highlight_id)
    if h is None:
        raise HTTPException(status_code=404, detail="高亮不存在")
    db.delete(h)
    db.commit()
    return {"ok": True}


# ---------- 笔记（FR-07） ----------

class NotePayload(BaseModel):
    chapter_id: int
    cfi: str | None = None
    content: str


@router.get("/books/{book_id}/notes")
def api_list_notes(book_id: int, db: Session = Depends(get_db)):
    rows = db.execute(select(Note).where(Note.book_id == book_id).order_by(Note.id)).scalars().all()
    return [
        {
            "id": n.id, "chapter_id": n.chapter_id, "cfi": n.cfi, "content": n.content,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        }
        for n in rows
    ]


@router.post("/books/{book_id}/notes")
def api_create_note(book_id: int, payload: NotePayload, db: Session = Depends(get_db)):
    n = Note(book_id=book_id, chapter_id=payload.chapter_id, cfi=payload.cfi, content=payload.content)
    db.add(n)
    db.commit()
    db.refresh(n)
    return {"id": n.id}


@router.put("/notes/{note_id}")
def api_update_note(note_id: int, payload: NotePayload, db: Session = Depends(get_db)):
    n = db.get(Note, note_id)
    if n is None:
        raise HTTPException(status_code=404, detail="笔记不存在")
    n.content = payload.content
    if payload.cfi is not None:
        n.cfi = payload.cfi
    db.commit()
    return {"ok": True}


@router.delete("/notes/{note_id}")
def api_delete_note(note_id: int, db: Session = Depends(get_db)):
    n = db.get(Note, note_id)
    if n is None:
        raise HTTPException(status_code=404, detail="笔记不存在")
    db.delete(n)
    db.commit()
    return {"ok": True}


# ---------- 书签（FR-08） ----------

class BookmarkPayload(BaseModel):
    chapter_id: int
    cfi: str


@router.get("/books/{book_id}/bookmarks")
def api_list_bookmarks(book_id: int, db: Session = Depends(get_db)):
    rows = db.execute(select(Bookmark).where(Bookmark.book_id == book_id).order_by(Bookmark.id)).scalars().all()
    return [
        {
            "id": b.id, "chapter_id": b.chapter_id, "cfi": b.cfi,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in rows
    ]


@router.post("/books/{book_id}/bookmarks")
def api_create_bookmark(book_id: int, payload: BookmarkPayload, db: Session = Depends(get_db)):
    b = Bookmark(book_id=book_id, chapter_id=payload.chapter_id, cfi=payload.cfi)
    db.add(b)
    db.commit()
    db.refresh(b)
    return {"id": b.id}


@router.delete("/bookmarks/{bookmark_id}")
def api_delete_bookmark(bookmark_id: int, db: Session = Depends(get_db)):
    b = db.get(Bookmark, bookmark_id)
    if b is None:
        raise HTTPException(status_code=404, detail="书签不存在")
    db.delete(b)
    db.commit()
    return {"ok": True}
