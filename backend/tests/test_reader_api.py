"""阅读器数据 API 测试（步骤 08/10 验收：FR-04~FR-08：进度/高亮/笔记/书签）。"""


def _import_book(client, epub_bytes) -> int:
    r = client.post("/api/books/import", files={"file": ("a.epub", epub_bytes, "application/epub+zip")})
    return r.json()["id"]


def _chapter_id(client, book_id, index=0) -> int:
    detail = client.get(f"/api/books/{book_id}").json()
    return detail["chapters"][index]["id"]


def test_progress_save_and_status(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    r = client.put(
        f"/api/books/{book_id}/progress",
        json={"cfi": "epubcfi(/6/4!/4/2)", "chapter_index": 1, "percent": 50.0},
    )
    assert r.status_code == 200
    detail = client.get(f"/api/books/{book_id}").json()
    assert detail["status"] == "reading"
    assert detail["percent"] == 50.0
    assert detail["current_chapter_index"] == 1


def test_progress_finish_when_100(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    client.put(f"/api/books/{book_id}/progress", json={"cfi": "x", "chapter_index": 2, "percent": 100.0})
    assert client.get(f"/api/books/{book_id}").json()["status"] == "finished"


def test_highlight_crud(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    ch_id = _chapter_id(client, book_id)

    r = client.post(
        f"/api/books/{book_id}/highlights",
        json={
            "chapter_id": ch_id,
            "cfi_start": "epubcfi(/6/4!/4/2/1:0)",
            "cfi_end": "epubcfi(/6/4!/4/2/1:10)",
            "selected_text": "第一章正文段落1",
            "color": "yellow",
            "note": "共鸣之处",
        },
    )
    assert r.status_code == 200
    hl_id = r.json()["id"]

    rows = client.get(f"/api/books/{book_id}/highlights").json()
    assert len(rows) == 1
    assert rows[0]["selected_text"] == "第一章正文段落1"
    assert rows[0]["note"] == "共鸣之处"

    # 更新
    r = client.put(
        f"/api/highlights/{hl_id}",
        json={"chapter_id": ch_id, "cfi_start": "a", "cfi_end": "b", "selected_text": "t", "color": "blue", "note": "改"},
    )
    assert r.status_code == 200
    assert client.get(f"/api/books/{book_id}/highlights").json()[0]["color"] == "blue"

    # 删除
    assert client.delete(f"/api/highlights/{hl_id}").status_code == 200
    assert client.get(f"/api/books/{book_id}/highlights").json() == []


def test_note_crud(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    ch_id = _chapter_id(client, book_id)

    r = client.post(f"/api/books/{book_id}/notes", json={"chapter_id": ch_id, "cfi": "epubcfi(/6/4!/4/2)", "content": "我的想法"})
    assert r.status_code == 200
    note_id = r.json()["id"]

    rows = client.get(f"/api/books/{book_id}/notes").json()
    assert len(rows) == 1 and rows[0]["content"] == "我的想法"

    assert client.put(f"/api/notes/{note_id}", json={"chapter_id": ch_id, "content": "更新后"}).status_code == 200
    assert client.get(f"/api/books/{book_id}/notes").json()[0]["content"] == "更新后"

    assert client.delete(f"/api/notes/{note_id}").status_code == 200
    assert client.get(f"/api/books/{book_id}/notes").json() == []


def test_bookmark_crud(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    ch_id = _chapter_id(client, book_id)

    r = client.post(f"/api/books/{book_id}/bookmarks", json={"chapter_id": ch_id, "cfi": "epubcfi(/6/4!/4/2)"})
    assert r.status_code == 200
    bm_id = r.json()["id"]

    assert len(client.get(f"/api/books/{book_id}/bookmarks").json()) == 1
    assert client.delete(f"/api/bookmarks/{bm_id}").status_code == 200
    assert client.get(f"/api/books/{book_id}/bookmarks").json() == []
