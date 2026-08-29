"""SQLAlchemy 引擎与 Session 管理。

注意：路径通过 `app.config` 模块属性延迟读取（而非 from-import 值拷贝），
保证测试/备份恢复时可以 monkeypatch 或重建引擎指向其他数据库。
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app import config


class Base(DeclarativeBase):
    pass


def _make_engine():
    config.ensure_dirs()
    # SQLite 单机应用：check_same_thread=False 便于 FastAPI 线程池使用
    return create_engine(
        f"sqlite:///{config.DB_PATH}",
        connect_args={"check_same_thread": False},
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """建表（MVP 阶段用 metadata.create_all，引入 Alembic 前够用）。"""
    from app.models import book, journal, memory, setting  # noqa: F401  确保模型已注册

    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI 依赖：请求级 Session。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
