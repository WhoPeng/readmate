"""全局路径与常量配置。

以"项目根目录"为基准计算路径，保证无论从 backend/ 还是 electron 拉起，路径一致。
"""
from pathlib import Path

# backend/app/config.py 的父目录的父目录 = 项目根
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
BOOKS_DIR = DATA_DIR / "books"
DB_PATH = DATA_DIR / "readmate.db"
APP_VERSION = "0.1.0"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
