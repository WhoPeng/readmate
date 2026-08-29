"""备份导出/导入测试（步骤 20 / FR-23）。"""
import io
import zipfile


def test_export_import_roundtrip(client, minimal_epub):
    # 导入一本书并加一条笔记
    r = client.post("/api/books/import", files={"file": ("a.epub", minimal_epub, "application/epub+zip")})
    book_id = r.json()["id"]
    detail = client.get(f"/api/books/{book_id}").json()
    client.post(f"/api/books/{book_id}/notes", json={"chapter_id": detail["chapters"][0]["id"], "content": "备份前笔记"})

    # 导出
    export = client.get("/api/backup/export")
    assert export.status_code == 200
    assert export.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(export.content))
    assert "manifest.json" in zf.namelist()
    assert "readmate.db" in zf.namelist()
    assert any(n.startswith("books/") for n in zf.namelist())

    # 清空当前数据（模拟换机/清空）
    client.delete(f"/api/books/{book_id}")
    assert client.get("/api/books").json() == []

    # 导入备份恢复
    resp = client.post("/api/backup/import", files={"file": ("backup.zip", export.content, "application/zip")})
    assert resp.status_code == 200
    books = client.get("/api/books").json()
    assert len(books) == 1
    assert books[0]["title"] == "测试之书"
    restored_notes = client.get(f"/api/books/{books[0]['id']}/notes").json()
    assert restored_notes[0]["content"] == "备份前笔记"


def test_import_invalid_backup(client):
    resp = client.post("/api/backup/import", files={"file": ("bad.zip", b"not a zip", "application/zip")})
    assert resp.status_code == 400
