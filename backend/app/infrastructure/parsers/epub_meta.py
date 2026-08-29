"""EPUB 元数据/目录解析（ebooklib）。

职责边界（设计文档第 4 节）：
- 只做书架级元数据 + 目录树 + 章节清单（标题/定位/词数）；
- 正文渲染由前端 epub.js 直接读 EPUB 原文件，此处不做正文抽取与入库。
"""
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from ebooklib import ITEM_COVER, ITEM_DOCUMENT, epub

_TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class ChapterMeta:
    """单章元数据（对应 chapters 表一行）。"""
    index: int
    toc_title: str
    href: str          # spine 中文档路径（epub.js 章节定位依据）
    toc_level: int
    word_count: int


@dataclass
class BookMeta:
    """整书解析结果（对应 books 表 + chapters 表）。"""
    title: str
    author: str
    cover_bytes: bytes | None
    metadata: dict
    chapters: list[ChapterMeta] = field(default_factory=list)
    toc_tree: list[dict] = field(default_factory=list)  # 嵌套目录树
    fingerprint: str = ""


class EpubParseError(Exception):
    """解析失败的结构化错误（前端显示中文提示）。"""


def _clean_title(raw: str) -> str:
    return re.sub(r"\s+", " ", raw or "").strip() or "未命名书籍"


def _extract_author(book: epub.EpubBook) -> str:
    for value in book.get_metadata("DC", "creator"):
        if value:
            return str(value[0]).strip()
    return "未知作者"


def _extract_cover(book: epub.EpubBook) -> bytes | None:
    """按三种常见方式找封面：manifest cover 类型 → OPF cover 元数据 → cover-image property。"""
    for item in book.get_items_of_type(ITEM_COVER):
        return item.get_content()
    for meta in book.get_metadata("OPF", "cover"):
        item = book.get_item_with_id(meta[0])
        if item is not None:
            return item.get_content()
    for item in book.get_items():
        if "cover-image" in (getattr(item, "properties", "") or ""):
            return item.get_content()
    return None


def _count_words(html: str) -> int:
    text = _TAG_RE.sub(" ", html)
    return len(text.split())


def _flatten_toc(toc, items: list, level: int = 1):
    """递归展开 EPUB TOC（epub.Link 或嵌套 tuple），同时生成层级信息。"""
    for entry in toc:
        if isinstance(entry, (list, tuple)):
            # 嵌套小节：heading + children
            for child in entry:
                _flatten_toc([child], items, level + 1)
        elif isinstance(entry, epub.Link):
            items.append({"title": entry.title or "未命名", "href": entry.href, "level": level})


def parse_epub(path: str | Path) -> BookMeta:
    """解析 EPUB 文件为 BookMeta；失败抛 EpubParseError（带中文原因）。"""
    path = Path(path)
    if not path.exists():
        raise EpubParseError("文件不存在")
    if not path.name.lower().endswith(".epub"):
        raise EpubParseError("仅支持 EPUB 格式")

    try:
        book = epub.read_epub(str(path))
    except Exception as exc:
        raise EpubParseError(f"EPUB 文件损坏或无法解析：{exc}") from exc

    title = _clean_title(str(book.title or ""))

    # 章节清单：按 spine 顺序（与 epub.js 渲染顺序一致）
    chapters: list[ChapterMeta] = []
    toc_items: list[dict] = []
    _flatten_toc(book.toc, toc_items)
    href_to_title = {i["href"]: i["title"] for i in toc_items}

    spine_index = 0
    for idref, _linear in book.spine:
        item = book.get_item_with_id(idref)
        if item is None or item.get_type() != ITEM_DOCUMENT:
            continue
        href = item.get_name()
        toc_title = href_to_title.get(href) or _clean_title(title) + f" 第{spine_index + 1}节"
        word_count = _count_words(item.get_content().decode("utf-8", errors="replace"))
        level = next((i["level"] for i in toc_items if i["href"] == href), 1)
        chapters.append(
            ChapterMeta(index=spine_index, toc_title=toc_title, href=href, toc_level=level, word_count=word_count)
        )
        spine_index += 1

    if not chapters:
        raise EpubParseError("未解析到任何章节，文件可能不是标准 EPUB")

    # 指纹：整文件 sha256（导入去重用）
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)

    metadata = {
        "language": [str(v[0]) for v in book.get_metadata("DC", "language")] if book.get_metadata("DC", "language") else [],
        "publisher": [str(v[0]) for v in book.get_metadata("DC", "publisher")] if book.get_metadata("DC", "publisher") else [],
        "description": str(book.get_metadata("DC", "description")[0][0]) if book.get_metadata("DC", "description") else "",
    }

    return BookMeta(
        title=title,
        author=_extract_author(book),
        cover_bytes=_extract_cover(book),
        metadata={k: v for k, v in metadata.items() if v},
        chapters=chapters,
        toc_tree=toc_items,
        fingerprint=digest.hexdigest(),
    )
