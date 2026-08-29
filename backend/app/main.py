"""伴读 ReadMate 后端入口（FastAPI，数据与解析层）。

启动：uvicorn app.main:app --host 127.0.0.1 --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import backup, books, journal, reader, settings
from app.config import APP_VERSION, ensure_dirs
from app.infrastructure.db import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_dirs()
    init_db()
    yield


app = FastAPI(title="ReadMate Backend", version=APP_VERSION, lifespan=lifespan)

# 单机应用：Electron renderer 与 Vite dev server 均来自本地，放开 CORS（仅监听 127.0.0.1）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(books.router, prefix="/api")
app.include_router(reader.router, prefix="/api")
app.include_router(journal.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(backup.router, prefix="/api")


@app.get("/api/health")
def api_health():
    from sqlalchemy import text

    from app.infrastructure.db import engine

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"app": "readmate-backend", "version": APP_VERSION, "database": "ok" if db_ok else "error"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
