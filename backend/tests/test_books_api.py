"""书籍导入/列表/详情 API 测试（步骤 05/06 验收：FR-01/FR-02/FR-03）。"""


def test_import_book(client, minimal_epub):
    resp = client.post("/api/books/import", files={"file": ("test.epub", minimal_epub, "application/epub+zip")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "测试之书"
    assert data["author"] == "测试作者"
    assert data["format"] == "EPUB"
    assert data["status"] == "unread"
    assert data["chapter_count"] == 3
    assert len(data["chapters"]) == 3
    assert data["chapters"][0]["chapter_cfi"] == "chapter1.xhtml"


def test_import_duplicate_rejected(client, minimal_epub):
    files = {"file": ("a.epub", minimal_epub, "application/epub+zip")}
    assert client.post("/api/books/import", files=files).status_code == 200
    resp = client.post("/api/books/import", files={"file": ("b.epub", minimal_epub, "application/epub+zip")})
    assert resp.status_code == 400
    assert "已存在" in resp.json()["detail"]


def test_import_broken_rejected(client, broken_epub):
    resp = client.post("/api/books/import", files={"file": ("bad.epub", broken_epub, "application/epub+zip")})
    assert resp.status_code == 400
    assert "损坏" in resp.json()["detail"] or "无法解析" in resp.json()["detail"]


def test_import_no_toc_ok(client, no_toc_epub):
    resp = client.post("/api/books/import", files={"file": ("notoc.epub", no_toc_epub, "application/epub+zip")})
    assert resp.status_code == 200
    assert resp.json()["title"] == "无目录之书"


def test_list_books(client, minimal_epub, no_toc_epub):
    client.post("/api/books/import", files={"file": ("a.epub", minimal_epub, "application/epub+zip")})
    client.post("/api/books/import", files={"file": ("b.epub", no_toc_epub, "application/epub+zip")})
    resp = client.get("/api/books")
    assert resp.status_code == 200
    books = resp.json()
    assert len(books) == 2
    # 最近导入在前
    assert books[0]["title"] == "无目录之书"


def test_book_detail(client, minimal_epub):
    r = client.post("/api/books/import", files={"file": ("a.epub", minimal_epub, "application/epub+zip")})
    book_id = r.json()["id"]

    detail = client.get(f"/api/books/{book_id}").json()
    assert detail["title"] == "测试之书"
    assert len(detail["chapters"]) == 3
    assert detail["intent"] is None
    assert detail["report"] is None


def test_book_file_and_cover(client, minimal_epub):
    r = client.post("/api/books/import", files={"file": ("a.epub", minimal_epub, "application/epub+zip")})
    book_id = r.json()["id"]

    file_resp = client.get(f"/api/books/{book_id}/file")
    assert file_resp.status_code == 200
    assert file_resp.headers["content-type"].startswith("application/epub")

    cover_resp = client.get(f"/api/books/{book_id}/cover")
    assert cover_resp.status_code == 404  # 测试书无封面


def test_delete_book(client, minimal_epub):
    r = client.post("/api/books/import", files={"file": ("a.epub", minimal_epub, "application/epub+zip")})
    book_id = r.json()["id"]
    assert client.delete(f"/api/books/{book_id}").status_code == 200
    assert client.get(f"/api/books/{book_id}").status_code == 404
    assert client.get("/api/books").json() == []


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["database"] == "ok"
