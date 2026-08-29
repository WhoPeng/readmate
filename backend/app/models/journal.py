"""伴读域模型：ReadingIntent / ChapterJournal / BookReport / AiMessage / ReaderThought。"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ReadingIntent(Base):
    """阅读前访谈产物（版本化，旧版保留）。"""
    __tablename__ = "reading_intents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    motivation: Mapped[str] = mapped_column(Text, default="")
    expected_gain: Mapped[str] = mapped_column(Text, default="")
    interested_topics: Mapped[str] = mapped_column(Text, default="")
    personal_questions: Mapped[str] = mapped_column(Text, default="")
    emotional_context: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="completed")  # in_progress/completed/skipped
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChapterJournal(Base):
    """每章反思完成后生成的章节阅读记录。"""
    __tablename__ = "chapter_journals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    reading_seconds: Mapped[int] = mapped_column(Integer, default=0)
    reader_feeling: Mapped[str] = mapped_column(Text, default="")
    reader_understanding: Mapped[str] = mapped_column(Text, default="")
    reader_questions: Mapped[str] = mapped_column(Text, default="")
    ai_feedback: Mapped[str] = mapped_column(Text, default="")
    author_position_json: Mapped[str] = mapped_column(Text, default="{}")  # 观点/论据/论证/隐含前提/结论
    agreement_level: Mapped[str] = mapped_column(String(16), default="")   # 一致/部分一致/理解偏差/合理分歧
    disagreement: Mapped[str] = mapped_column(Text, default="")
    misunderstanding: Mapped[str] = mapped_column(Text, default="")
    changed_mind: Mapped[str] = mapped_column(Text, default="")
    final_thought: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft / completed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BookReport(Base):
    """「我与这本书」全书报告（版本化，保留用户编辑）。"""
    __tablename__ = "book_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    sections_json: Mapped[str] = mapped_column(Text, default="{}")   # 10 项内容
    trajectory_json: Mapped[str] = mapped_column(Text, default="[]")  # 思想变化轨迹
    user_edits_json: Mapped[str] = mapped_column(Text, default="{}")   # 用户编辑覆盖
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AiMessage(Base):
    """AI 调用记录（可追踪，FR-24）。"""
    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_key: Mapped[str] = mapped_column(String(128), index=True)  # 场景:对象:版本
    role: Mapped[str] = mapped_column(String(16))                      # system/user/assistant
    content: Mapped[str] = mapped_column(Text)
    source_tag: Mapped[Optional[str]] = mapped_column(String(16))      # [BOOK]/[AI]/[READER]…
    provider: Mapped[str] = mapped_column(String(64), default="")
    model: Mapped[str] = mapped_column(String(128), default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ReaderThought(Base):
    """思想变化轨迹快照（阅读前 → 讨论后 → 最终）。"""
    __tablename__ = "reader_thoughts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(16))   # before_reading / after_discussion / final
    chapter_id: Mapped[Optional[int]] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
