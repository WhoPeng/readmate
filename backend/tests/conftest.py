"""测试夹具：最小合法 EPUB 生成器 + 临时数据目录隔离。"""
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import DATA_DIR


def build_epub_bytes(
    title: str = "测试之书",
    author: str = "测试作者",
    chapter_titles: list[str] | None = None,
    include_nav: bool = True,
) -> bytes:
    """生成一个最小合法 EPUB（EPUB2 NCX + EPUB3 nav 双兼容），返回字节。"""
    chapter_titles = chapter_titles or ["第一章 开始", "第二章 发展", "第三章 结论"]
    n = len(chapter_titles)

    buffer = io.BytesIO()
    zf = zipfile.ZipFile(buffer, "w")
    # mimetype 必须第一个条目且不压缩（EPUB 标准）
    zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    zf.writestr(
        "META-INF/container.xml",
        """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""",
    )

    manifest_items = '\n'.join(
        f'<item id="ch{i}" href="chapter{i}.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(1, n + 1)
    )
    spine_items = '\n'.join(f'<itemref idref="ch{i}"/>' for i in range(1, n + 1))
    ncx_item = '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' if include_nav else ""
    spine_toc = 'toc="ncx"' if include_nav else ""

    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test-{title}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    {ncx_item}
    {manifest_items}
  </manifest>
  <spine {spine_toc}>
    {spine_items}
  </spine>
</package>"""
    zf.writestr("OEBPS/content.opf", opf)

    if include_nav:
        navpoints = '\n'.join(
            f'<navPoint id="np{i}" playOrder="{i}"><navLabel><text>{t}</text></navLabel>'
            f'<content src="chapter{i}.xhtml"/></navPoint>'
            for i, t in enumerate(chapter_titles, start=1)
        )
        ncx = f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:test"/></head>
  <docTitle><text>{title}</text></docTitle>
  <navMap>{navpoints}</navMap>
</ncx>"""
        zf.writestr("OEBPS/toc.ncx", ncx)

    for i, t in enumerate(chapter_titles, start=1):
        body = "".join(f"<p>第{i}章正文段落{j}：这是用于测试解析与阅读的内容。</p>" for j in range(1, 6))
        xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{t}</title></head>
<body><h1>{t}</h1>{body}</body></html>"""
        zf.writestr(f"OEBPS/chapter{i}.xhtml", xhtml)

    zf.close()
    return buffer.getvalue()


@pytest.fixture()
def minimal_epub() -> bytes:
    return build_epub_bytes()


@pytest.fixture()
def no_toc_epub() -> bytes:
    return build_epub_bytes(title="无目录之书", include_nav=False)


@pytest.fixture()
def broken_epub() -> bytes:
    return b"this is not a zip file"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """隔离数据目录 + 独立客户端（monkeypatch 模块级路径常量）。"""
    import app.config as cfg

    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path)
    monkeypatch.setattr(cfg, "BOOKS_DIR", tmp_path / "books")
    monkeypatch.setattr(cfg, "DB_PATH", tmp_path / "test.db")

    import app.infrastructure.db as dbm
    from app.main import app

    # 重建引擎指向临时库
    old_engine = dbm.engine
    dbm.engine = dbm._make_engine()
    dbm.SessionLocal.configure(bind=dbm.engine)

    with TestClient(app) as c:
        yield c

    # teardown：释放连接，避免 Windows 下 SQLite 文件句柄占用导致 tmp_path 清理失败
    dbm.engine.dispose()
    dbm.engine = old_engine
    dbm.SessionLocal.configure(bind=old_engine)
