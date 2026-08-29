"""备份接口（FR-23）：导出 = SQLite + 书籍目录打包为 zip；导入 = 恢复。

注意：AI Key 密文存于 SQLite（safeStorage 加密），导出不包含明文密钥。
"""
import io
import json
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import config
from app.infrastructure.db import get_db
from app.infrastructure.db import SessionLocal, engine, init_db
from app.models.book import Book

router = APIRouter(tags=["backup"])

BACKUP_META = {"app": "readmate", "version": "1"}


@router.post("/backup/export")
def api_export_backup(db: Session = Depends(get_db)):
    """导出备份文件（无明文密钥：仅数据库 + 书籍文件）。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(BACKUP_META))
        zf.write(config.DB_PATH, "readmate.db")
        if config.BOOKS_DIR.exists():
            for f in config.BOOKS_DIR.iterdir():
                if f.is_file():
                    zf.write(f, f"books/{f.name}")
    buffer.seek(0)
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=readmate-backup.zip"},
    )


@router.post("/backup/import")
async def api_import_backup(file: UploadFile = File(...)):
    """从备份 zip 恢复（会覆盖当前数据，前端需二次确认）。"""
    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="不是有效的备份文件") from exc

    if "manifest.json" not in zf.namelist():
        raise HTTPException(status_code=400, detail="备份文件缺少 manifest")
    if "readmate.db" not in zf.namelist():
        raise HTTPException(status_code=400, detail="备份文件缺少数据库")

    try:
        # 1) 先释放当前数据库连接（Windows 下文件被占用无法替换）
        _dispose_engine()
        # 2) 覆盖式恢复：清空 books 目录
        if config.BOOKS_DIR.exists():
            shutil.rmtree(config.BOOKS_DIR)
        config.BOOKS_DIR.mkdir(parents=True, exist_ok=True)
        # 3) 提取数据库（zip 内固定名 readmate.db → 重命名为实际 DB 文件名）
        zf.extract("readmate.db", config.DATA_DIR)
        extracted = config.DATA_DIR / "readmate.db"
        if extracted.resolve() != config.DB_PATH.resolve():
            extracted.replace(config.DB_PATH)
        # 4) 提取书籍文件
        for name in zf.namelist():
            if name.startswith("books/") and not name.endswith("/"):
                target = config.BOOKS_DIR / Path(name).name
                target.write_bytes(zf.read(name))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"恢复失败：{exc}") from exc
    finally:
        # 无论成败都重连数据库，避免应用进入无引擎状态
        _rebind_engine()
    return {"ok": True}


def _dispose_engine() -> None:
    """释放当前引擎连接（替换 db 文件前的文件锁解除）。"""
    from app.infrastructure import db as db_module

    db_module.engine.dispose()


def _rebind_engine() -> None:
    """备份导入后重建引擎连接（文件已替换）。"""
    from app.infrastructure import db as db_module

    db_module.engine.dispose()
    new_engine = db_module._make_engine()
    db_module.engine = new_engine
    db_module.SessionLocal.configure(bind=new_engine)
