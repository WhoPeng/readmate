"""伴读数据 API 测试（步骤 14~19 数据侧验收：FR-13/14/18/19/21/24）。"""


def _import_book(client, epub_bytes) -> int:
    r = client.post("/api/books/import", files={"file": ("a.epub", epub_bytes, "application/epub+zip")})
    return r.json()["id"]


def test_intent_save_get(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    payload = {
        "motivation": "想理解自己为什么拖延",
        "expected_gain": "对拖延原因的理解",
        "interested_topics": "行为、逃避、不确定性",
        "personal_questions": "为什么知道应该做，却还是不愿意开始？",
        "emotional_context": "焦虑",
    }
    r = client.post(f"/api/books/{book_id}/intent", json=payload)
    assert r.status_code == 200
    intent = r.json()
    assert intent["motivation"] == "想理解自己为什么拖延"
    assert intent["status"] == "completed"

    got = client.get(f"/api/books/{book_id}/intent").json()
    assert got["motivation"] == "想理解自己为什么拖延"

    detail = client.get(f"/api/books/{book_id}").json()
    assert detail["intent"]["motivation"] == "想理解自己为什么拖延"


def test_journal_save_update(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    ch = client.get(f"/api/books/{book_id}").json()["chapters"][0]
    ch_id = ch["id"]

    payload = {
        "chapter_id": ch_id,
        "reading_seconds": 600,
        "reader_feeling": "这一章让我很共鸣",
        "reader_understanding": "作者认为逃避源于不确定",
        "reader_questions": "逃避和拖延是一回事吗",
        "ai_feedback": "你的理解基本符合作者原意",
        "author_position": {"core_claim": "人在未知前会逃避", "evidence": ["实验", "案例"]},
        "agreement_level": "部分一致",
        "disagreement": "我不同意作者把责任全归个人",
        "misunderstanding": "",
        "changed_mind": "我开始认为拖延和逃避有关",
        "final_thought": "我仍认为环境因素同样重要",
    }
    r = client.post(f"/api/books/{book_id}/journals", json=payload)
    assert r.status_code == 200
    j = r.json()
    assert j["agreement_level"] == "部分一致"
    assert j["author_position"]["core_claim"] == "人在未知前会逃避"

    # 同章更新（覆盖语义）
    payload["final_thought"] = "修订后的最终想法"
    r2 = client.post(f"/api/books/{book_id}/journals", json=payload)
    assert r2.json()["id"] == j["id"]
    assert r2.json()["final_thought"] == "修订后的最终想法"

    rows = client.get(f"/api/books/{book_id}/journals").json()
    assert len(rows) == 1


def test_report_and_thoughts(client, minimal_epub):
    book_id = _import_book(client, minimal_epub)
    ch = client.get(f"/api/books/{book_id}").json()["chapters"][0]

    # 先有访谈与一章 Journal，才有真实轨迹数据
    client.post(
        f"/api/books/{book_id}/intent",
        json={"motivation": "想理解拖延", "expected_gain": "答案", "status": "completed"},
    )
    client.post(
        f"/api/books/{book_id}/journals",
        json={"chapter_id": ch["id"], "final_thought": "读完第一章我改变了看法", "status": "completed"},
    )

    sections = {
        "why_read": "想理解拖延",
        "before_me": "我认为拖延就是懒",
        "key_moments": ["第一章共鸣点"],
        "resonance": "逃避观点",
        "opposition": "过度心理归因",
        "misunderstandings": ["曾经以为拖延是懒"],
        "changed_mind": "拖延可能和逃避有关",
        "author_intent": "作者想解释逃避机制",
        "acceptance": "部分接受",
        "impact": "开始观察自己的逃避行为",
        "reading_after_me": "我成为一个更理解自己的人",
    }
    r = client.post(f"/api/books/{book_id}/reports", json={"sections": sections, "trajectory": []})
    assert r.status_code == 200
    assert r.json()["sections"]["impact"] == "开始观察自己的逃避行为"

    report = client.get(f"/api/books/{book_id}/reports").json()
    assert report["sections"]["why_read"] == "想理解拖延"

    thoughts = client.get(f"/api/books/{book_id}/thoughts").json()
    stages = [t["stage"] for t in thoughts]
    assert "before_reading" in stages
    assert "after_discussion" in stages
    assert "final" in stages  # 来自报告的 reading_after_me


def test_ai_messages_record(client):
    r = client.post(
        "/api/ai/messages",
        json={
            "session_key": "interview:1:1",
            "role": "assistant",
            "content": "是什么让你想读这本书？",
            "source_tag": "[AI]",
            "provider": "anthropic",
            "model": "claude-sonnet-4-5",
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "latency_ms": 800,
        },
    )
    assert r.status_code == 200
    rows = client.get("/api/ai/messages").json()
    assert len(rows) == 1
    assert rows[0]["session_key"] == "interview:1:1"
    assert rows[0]["source_tag"] == "[AI]"

    filtered = client.get("/api/ai/messages", params={"session_key": "interview:1:1"}).json()
    assert len(filtered) == 1
    assert client.get("/api/ai/messages", params={"session_key": "other"}).json() == []


def test_settings_crud(client):
    assert client.put("/api/settings/reader", json={"value_json": {"theme": "dark", "fontSize": 18}}).status_code == 200
    settings = client.get("/api/settings").json()
    assert settings["reader"]["theme"] == "dark"

    assert client.delete("/api/settings/reader").status_code == 200
    assert "reader" not in client.get("/api/settings").json()
