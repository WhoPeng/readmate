"""书籍域模型：Book / Chapter / Highlight / Note / Bookmark。

正文不落库：渲染由 epub.js 直接读 EPUB 原文件；
本章仅存书架级元数据、目录树与 CFI 定位锚点（设计文档第 4 节）。
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(512), index=True)
    author: Mapped[str] = mapped_column(String(256), default="未知作者")
    cover_path: Mapped[Optional[str]] = mapped_column(String(512))
    format: Mapped[str] = mapped_column(String(16), default="EPUB")
    file_path: Mapped[str] = mapped_column(String(1024))          # data/books/ 下的原文件副本
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)  # sha256，导入去重
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")     # 出版社/语言等原始元数据
    status: Mapped[str] = mapped_column(String(16), default="unread")  # unread / reading / finished
    progress_cfi: Mapped[Optional[str]] = mapped_column(Text)          # 阅读位置（epub.js CFI）
    current_chapter_index: Mapped[Optional[int]] = mapped_column(Integer)
    percent: Mapped[float] = mapped_column(Float, default=0.0)         # 0~100
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="Chapter.index"
    )
    highlights: Mapped[list["Highlight"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )
    notes: Mapped[list["Note"]] = relationship(back_populates="book", cascade="all, delete-orphan")
    bookmarks: Mapped[list["Bookmark"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    index: Mapped[int] = mapped_column(Integer)                  # spine 顺序
    toc_title: Mapped[str] = mapped_column(String(512))          # 目录标题
    chapter_cfi: Mapped[str] = mapped_column(Text)               # 章节定位（epub.js CFI / href）
    toc_level: Mapped[int] = mapped_column(Integer, default=1)   # 目录层级（嵌套目录）
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    book: Mapped["Book"] = relationship(back_populates="chapters")


class Highlight(Base):
    __tablename__ = "highlights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    cfi_start: Mapped[str] = mapped_column(Text)                 # epub.js CFI 锚点
    cfi_end: Mapped[str] = mapped_column(Text)
    selected_text: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(16), default="yellow")  # yellow/green/blue
    note: Mapped[Optional[str]] = mapped_column(Text)            # 绑定笔记
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    book: Mapped["Book"] = relationship(back_populates="highlights")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    cfi: Mapped[Optional[str]] = mapped_column(Text)             # 空 = 章内独立笔记
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    book: Mapped["Book"] = relationship(back_populates="notes")


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    cfi: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    book: Mapped["Book"] = relationship(back_populates="bookmarks")
