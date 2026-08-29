"""EPUB 解析器单元测试（步骤 04 验收：FR-01 元数据解析）。"""
from pathlib import Path

import pytest

from app.infrastructure.parsers.epub_meta import EpubParseError, parse_epub


def _write(tmp_path, name, data):
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_parse_standard_epub(tmp_path, minimal_epub):
    path = _write(tmp_path, "book.epub", minimal_epub)
    meta = parse_epub(path)

    assert meta.title == "测试之书"
    assert meta.author == "测试作者"
    assert len(meta.chapters) == 3
    assert meta.chapters[0].toc_title == "第一章 开始"
    assert meta.chapters[0].index == 0
    assert meta.chapters[0].href == "chapter1.xhtml"
    assert meta.chapters[0].word_count > 0
    assert meta.toc_tree[0]["title"] == "第一章 开始"
    assert len(meta.fingerprint) == 64  # sha256


def test_parse_without_toc(tmp_path, no_toc_epub):
    path = _write(tmp_path, "notoc.epub", no_toc_epub)
    meta = parse_epub(path)
    assert meta.title == "无目录之书"
    assert len(meta.chapters) == 3
    # 无 TOC 时按 spine 顺序生成章节标题
    assert "第1节" in meta.chapters[0].toc_title


def test_parse_broken_file_raises_structured_error(tmp_path, broken_epub):
    path = _write(tmp_path, "broken.epub", broken_epub)
    with pytest.raises(EpubParseError):
        parse_epub(path)


def test_parse_wrong_extension(tmp_path, minimal_epub):
    path = _write(tmp_path, "book.pdf", minimal_epub)
    with pytest.raises(EpubParseError, match="仅支持 EPUB"):
        parse_epub(path)


def test_parse_missing_file(tmp_path):
    with pytest.raises(EpubParseError, match="文件不存在"):
        parse_epub(tmp_path / "nope.epub")


def test_parse_invalid_xhtml_book(tmp_path):
    """章节 XHTML 有轻微不规范时应容错（民间 EPUB 常见）。"""
    import io
    import zipfile

    buffer = io.BytesIO()
    zf = zipfile.ZipFile(buffer, "w")
    zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    zf.writestr(
        "META-INF/container.xml",
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    )
    opf = """<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">x</dc:identifier><dc:title>容错书</dc:title></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="ch1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine toc="ncx"><itemref idref="ch1"/></spine></package>"""
    zf.writestr("OEBPS/content.opf", opf)
    zf.writestr("OEBPS/toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><navMap><navPoint id="n1" playOrder="1"><navLabel><text>c1</text></navLabel><content src="c1.xhtml"/></navPoint></navMap></ncx>')
    # 未闭合标签的"脏"HTML
    zf.writestr("OEBPS/c1.xhtml", '<html><body><p>未闭合<p>段落</body></html>')
    zf.close()
    buffer.seek(0)

    path = _write(tmp_path, "dirty.epub", buffer.getvalue())
    meta = parse_epub(path)  # 不应抛错
    assert meta.title == "容错书"
    assert len(meta.chapters) == 1
