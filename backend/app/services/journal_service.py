"""Journal 服务：ReadingIntent / ChapterJournal / BookReport 的序列化与合并。"""
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.book import Book
from app.models.journal import BookReport, ChapterJournal, ReadingIntent


def intent_to_dict(intent: ReadingIntent) -> dict:
    return {
        "id": intent.id,
        "book_id": intent.book_id,
        "version": intent.version,
        "motivation": intent.motivation,
        "expected_gain": intent.expected_gain,
        "interested_topics": intent.interested_topics,
        "personal_questions": intent.personal_questions,
        "emotional_context": intent.emotional_context,
        "status": intent.status,
        "created_at": intent.created_at.isoformat() if intent.created_at else None,
    }


def journal_to_dict(j: ChapterJournal) -> dict:
    return {
        "id": j.id,
        "book_id": j.book_id,
        "chapter_id": j.chapter_id,
        "version": j.version,
        "reading_seconds": j.reading_seconds,
        "reader_feeling": j.reader_feeling,
        "reader_understanding": j.reader_understanding,
        "reader_questions": j.reader_questions,
        "ai_feedback": j.ai_feedback,
        "author_position": json.loads(j.author_position_json or "{}"),
        "agreement_level": j.agreement_level,
        "disagreement": j.disagreement,
        "misunderstanding": j.misunderstanding,
        "changed_mind": j.changed_mind,
        "final_thought": j.final_thought,
        "status": j.status,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
    }


def report_to_dict(r: BookReport) -> dict:
    return {
        "id": r.id,
        "book_id": r.book_id,
        "version": r.version,
        "sections": json.loads(r.sections_json or "{}"),
        "trajectory": json.loads(r.trajectory_json or "[]"),
        "user_edits": json.loads(r.user_edits_json or "{}"),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def get_latest_intent(db: Session, book_id: int) -> ReadingIntent | None:
    return db.execute(
        select(ReadingIntent).where(ReadingIntent.book_id == book_id).order_by(ReadingIntent.version.desc())
    ).scalars().first()


def get_latest_report(db: Session, book_id: int) -> BookReport | None:
    return db.execute(
        select(BookReport).where(BookReport.book_id == book_id).order_by(BookReport.version.desc())
    ).scalars().first()


def save_intent(db: Session, book_id: int, data: dict[str, Any]) -> ReadingIntent:
    """保存/更新 ReadingIntent；同版本更新，跨版本新建。"""
    latest = get_latest_intent(db, book_id)
    if latest is not None and latest.status != "completed":
        intent = latest
    elif latest is not None and data.get("version") and data["version"] == latest.version:
        intent = latest
    else:
        intent = ReadingIntent(book_id=book_id, version=(latest.version + 1) if latest else 1)
        db.add(intent)
    for field in ("motivation", "expected_gain", "interested_topics", "personal_questions", "emotional_context", "status"):
        if field in data:
            setattr(intent, field, data[field])
    db.commit()
    db.refresh(intent)
    return intent


def save_journal(db: Session, book_id: int, chapter_id: int, data: dict[str, Any]) -> ChapterJournal:
    """保存 ChapterJournal；同一章存在草稿则更新，否则新建（覆盖语义，FR-18）。"""
    existing = db.execute(
        select(ChapterJournal).where(
            ChapterJournal.book_id == book_id, ChapterJournal.chapter_id == chapter_id
        ).order_by(ChapterJournal.version.desc())
    ).scalars().first()
    if existing is not None:
        journal = existing
    else:
        journal = ChapterJournal(book_id=book_id, chapter_id=chapter_id, version=1)
        db.add(journal)
    for key, value in data.items():
        if key == "author_position" and isinstance(value, dict):
            setattr(journal, "author_position_json", json.dumps(value, ensure_ascii=False))
        elif hasattr(journal, key):
            setattr(journal, key, value)
    if "status" not in data:
        journal.status = "completed"
    db.commit()
    db.refresh(journal)
    return journal


def save_report(db: Session, book_id: int, data: dict[str, Any]) -> BookReport:
    latest = get_latest_report(db, book_id)
    report = latest if latest is not None else BookReport(book_id=book_id, version=1)
    if latest is None:
        db.add(report)
    if "sections" in data:
        report.sections_json = json.dumps(data["sections"], ensure_ascii=False)
    if "trajectory" in data:
        report.trajectory_json = json.dumps(data["trajectory"], ensure_ascii=False)
    if "user_edits" in data:
        report.user_edits_json = json.dumps(data["user_edits"], ensure_ascii=False)
    db.commit()
    db.refresh(report)
    return report


def aggregate_thoughts(db: Session, book_id: int) -> list[dict]:
    """思想轨迹聚合：阅读前(访谈) + 各章 Journal 最终想法（FR-19，数据来自真实记录）。"""
    intent = get_latest_intent(db, book_id)
    entries: list[dict] = []
    if intent and intent.motivation:
        entries.append({"stage": "before_reading", "title": "阅读前", "content": intent.motivation})
    journals = db.execute(
        select(ChapterJournal)
        .where(ChapterJournal.book_id == book_id)
        .order_by(ChapterJournal.created_at)
    ).scalars().all()
    for j in journals:
        if j.final_thought:
            entries.append({"stage": "after_discussion", "title": f"第{j.chapter_id}章反思后", "content": j.final_thought})
    report = get_latest_report(db, book_id)
    if report:
        sections = json.loads(report.sections_json or "{}")
        final = sections.get("reading_after_me") or sections.get("impact")
        if final:
            entries.append({"stage": "final", "title": "阅读后的我", "content": str(final)})
    return entries
