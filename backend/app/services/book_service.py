"""书籍导入服务：文件管理 + 元数据解析 + 入库（books/chapters）。"""
import json
import re
import shutil
import uuid
from pathlib import Path

from ebooklib import ITEM_DOCUMENT, epub
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.infrastructure.parsers.epub_meta import EpubParseError, parse_epub
from app.models.book import Book, Chapter

_TAG_RE = re.compile(r"<[^>]+>")


def extract_chapter_text(book: Book, chapter: Chapter, max_chars: int = 8000) -> str:
    """按需从 EPUB 原文件提取章节纯文本（AI Context 用，正文不落库）。

    max_chars 截断上限（默认 8000 字符 ≈ 2k tokens，超长章节防爆上下文）。
    """
    try:
        epub_book = epub.read_epub(book.file_path)
    except Exception:
        return ""
    for item in epub_book.get_items_of_type(ITEM_DOCUMENT):
        if item.get_name() == chapter.chapter_cfi:
            html = item.get_content().decode("utf-8", errors="replace")
            text = re.sub(r"\s+", " ", _TAG_RE.sub(" ", html)).strip()
            if len(text) > max_chars:
                text = text[:max_chars] + "…（已截断）"
            return text
    return ""

COVER_FILENAME = "cover{ext}"


class BookImportError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _store_upload(upload_bytes: bytes, suffix: str) -> Path:
    """把上传的 EPUB 存为 data/books/<uuid>.epub，返回路径。"""
    config.BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix.lower()}"
    target = config.BOOKS_DIR / name
    target.write_bytes(upload_bytes)
    return target


def _save_cover(book_id: int, cover_bytes: bytes | None) -> str | None:
    """封面存为 data/books/<book_id>_cover.<ext>，返回相对文件名。"""
    if not cover_bytes:
        return None
    ext = "jpg" if cover_bytes[:3] == b"\xff\xd8\xff" else "png"
    name = f"{book_id}_cover.{ext}"
    (config.BOOKS_DIR / name).write_bytes(cover_bytes)
    return name


def import_book(db: Session, filename: str, upload_bytes: bytes) -> Book:
    """导入流程：指纹去重 → 存文件 → 解析元数据 → 入库。

    Raises: BookImportError（中文可读原因，对应 FR-01 验收）。
    """
    suffix = Path(filename).suffix or ".epub"
    file_path = _store_upload(upload_bytes, suffix)

    try:
        meta = parse_epub(file_path)
    except EpubParseError as exc:
        file_path.unlink(missing_ok=True)
        raise BookImportError(exc.args[0]) from exc

    existing = db.execute(select(Book).where(Book.fingerprint == meta.fingerprint)).scalar_one_or_none()
    if existing is not None:
        file_path.unlink(missing_ok=True)
        raise BookImportError(f"已存在该书《{existing.title}》，无需重复导入")

    book = Book(
        title=meta.title,
        author=meta.author,
        format="EPUB",
        file_path=str(file_path),
        fingerprint=meta.fingerprint,
        metadata_json=json.dumps(meta.metadata, ensure_ascii=False),
    )
    db.add(book)
    db.flush()  # 拿到 book.id 用于封面命名

    book.cover_path = _save_cover(book.id, meta.cover_bytes)

    for ch in meta.chapters:
        db.add(
            Chapter(
                book_id=book.id,
                index=ch.index,
                toc_title=ch.toc_title,
                chapter_cfi=ch.href,  # 章节级定位 = spine href（epub.js 依据）
                toc_level=ch.toc_level,
                word_count=ch.word_count,
            )
        )
    db.commit()
    db.refresh(book)
    return book


def delete_book(db: Session, book: Book) -> None:
    """删除书籍及其文件（级联删除章节/标注/记录）。"""
    for path in (Path(book.file_path), *([Path(BOOKS_DIR / book.cover_path)] if book.cover_path else [])):
        path.unlink(missing_ok=True)
    db.delete(book)
    db.commit()
