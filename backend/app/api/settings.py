"""设置接口：AI 配置（Key 加密后存）/ UI 偏好，key-value（FR-11/FR-05）。"""
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.infrastructure.db import get_db
from app.models.setting import Setting

router = APIRouter(tags=["settings"])


class SettingPayload(BaseModel):
    value_json: dict


@router.get("/settings")
def api_get_settings(db: Session = Depends(get_db)):
    rows = db.query(Setting).all()
    return {s.key: json.loads(s.value_json) for s in rows}


@router.put("/settings/{key}")
def api_put_setting(key: str, payload: SettingPayload, db: Session = Depends(get_db)):
    row = db.get(Setting, key)
    if row is None:
        row = Setting(key=key)
        db.add(row)
    row.value_json = json.dumps(payload.value_json, ensure_ascii=False)
    db.commit()
    return {"ok": True}


@router.delete("/settings/{key}")
def api_delete_setting(key: str, db: Session = Depends(get_db)):
    row = db.get(Setting, key)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True}
