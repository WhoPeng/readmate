"""伴读数据接口：ReadingIntent / ChapterJournal / BookReport / 思想轨迹 / AI 调用记录。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db import get_db
from app.models.book import Book, Chapter
from app.models.journal import AiMessage, BookReport, ChapterJournal, ReadingIntent
from app.services.journal_service import (
    aggregate_thoughts,
    intent_to_dict,
    journal_to_dict,
    report_to_dict,
    save_intent,
    save_journal,
    save_report,
)

router = APIRouter(tags=["journal"])


def _get_book_or_404(db: Session, book_id: int) -> Book:
    book = db.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="书籍不存在")
    return book


# ---------- ReadingIntent（FR-13/FR-14） ----------

class IntentPayload(BaseModel):
    motivation: str = ""
    expected_gain: str = ""
    interested_topics: str = ""
    personal_questions: str = ""
    emotional_context: str = ""
    status: str = "completed"


@router.post("/books/{book_id}/intent")
def api_save_intent(book_id: int, payload: IntentPayload, db: Session = Depends(get_db)):
    _get_book_or_404(db, book_id)
    intent = save_intent(db, book_id, payload.model_dump())
    return intent_to_dict(intent)


@router.get("/books/{book_id}/intent")
def api_get_intent(book_id: int, db: Session = Depends(get_db)):
    intent = db.execute(
        select(ReadingIntent).where(ReadingIntent.book_id == book_id).order_by(ReadingIntent.version.desc())
    ).scalars().first()
    return intent_to_dict(intent) if intent else None


# ---------- ChapterJournal（FR-18） ----------

class JournalPayload(BaseModel):
    chapter_id: int
    reading_seconds: int = 0
    reader_feeling: str = ""
    reader_understanding: str = ""
    reader_questions: str = ""
    ai_feedback: str = ""
    author_position: dict = {}
    agreement_level: str = ""
    disagreement: str = ""
    misunderstanding: str = ""
    changed_mind: str = ""
    final_thought: str = ""
    status: str = "completed"


@router.post("/books/{book_id}/journals")
def api_save_journal(book_id: int, payload: JournalPayload, db: Session = Depends(get_db)):
    _get_book_or_404(db, book_id)
    journal = save_journal(db, book_id, payload.chapter_id, payload.model_dump())
    return journal_to_dict(journal)


@router.get("/books/{book_id}/journals")
def api_list_journals(book_id: int, db: Session = Depends(get_db)):
    rows = db.execute(
        select(ChapterJournal).where(ChapterJournal.book_id == book_id).order_by(ChapterJournal.chapter_id)
    ).scalars().all()
    return [journal_to_dict(j) for j in rows]


@router.get("/journals/{journal_id}")
def api_get_journal(journal_id: int, db: Session = Depends(get_db)):
    j = db.get(ChapterJournal, journal_id)
    if j is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return journal_to_dict(j)


# ---------- BookReport（FR-21） ----------

class ReportPayload(BaseModel):
    sections: dict = {}
    trajectory: list = []
    user_edits: dict = {}


@router.post("/books/{book_id}/reports")
def api_save_report(book_id: int, payload: ReportPayload, db: Session = Depends(get_db)):
    _get_book_or_404(db, book_id)
    report = save_report(db, book_id, payload.model_dump())
    return report_to_dict(report)


@router.get("/books/{book_id}/reports")
def api_get_report(book_id: int, db: Session = Depends(get_db)):
    report = db.execute(
        select(BookReport).where(BookReport.book_id == book_id).order_by(BookReport.version.desc())
    ).scalars().first()
    return report_to_dict(report) if report else None


# ---------- 思想轨迹（FR-19） ----------

@router.get("/books/{book_id}/thoughts")
def api_get_thoughts(book_id: int, db: Session = Depends(get_db)):
    _get_book_or_404(db, book_id)
    return aggregate_thoughts(db, book_id)


# ---------- AI 调用记录（FR-24：由 Electron main 在每次调用后写入） ----------

class AiMessagePayload(BaseModel):
    session_key: str
    role: str
    content: str
    source_tag: str | None = None
    provider: str = ""
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0


@router.post("/ai/messages")
def api_record_ai_message(payload: AiMessagePayload, db: Session = Depends(get_db)):
    msg = AiMessage(**payload.model_dump())
    db.add(msg)
    db.commit()
    return {"id": msg.id}


@router.get("/ai/messages")
def api_list_ai_messages(session_key: str | None = None, limit: int = 50, db: Session = Depends(get_db)):
    query = select(AiMessage)
    if session_key:
        query = query.where(AiMessage.session_key == session_key)
    rows = db.execute(query.order_by(AiMessage.id.desc()).limit(min(limit, 200))).scalars().all()
    return [
        {
            "id": m.id, "session_key": m.session_key, "role": m.role, "content": m.content,
            "source_tag": m.source_tag, "provider": m.provider, "model": m.model,
            "prompt_tokens": m.prompt_tokens, "completion_tokens": m.completion_tokens,
            "latency_ms": m.latency_ms,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in rows
    ]
