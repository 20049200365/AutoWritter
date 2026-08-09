"""M3 收尾验收：划选改写（B11）+ 对话 Agent 数据驱动（B6 方向）+ SSE 重连快照（B4 方向）。"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.agent.provider import FakeProvider


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


def parse_sse(text):
    events = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        ev = {}
        for line in block.splitlines():
            if line.startswith("event: "):
                ev["event"] = line[7:]
            elif line.startswith("data: "):
                ev["data"] = json.loads(line[6:])
        if ev:
            events.append(ev)
    return events


# ---------- B11：改写必须产出可见变化（含结构式兜底）----------

def test_rewrite_produces_visible_change(client):
    client.app.state.provider = FakeProvider({"原文": "他握紧了剑，剑身微微震颤。"})
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    ch = client.post("/chapters", json={"project_id": pid, "title": "一"}).json()
    client.post(f"/chapters/{ch['id']}/commit", json={"text": "他握紧了剑，剑身微微震颤。风很冷。"})

    r = client.post(f"/chapters/{ch['id']}/rewrite",
                    json={"start": 0, "end": 12, "op": "润色"})
    ev = parse_sse(r.text)
    done = next(e for e in ev if e["event"] == "done")
    assert done["data"]["result"] != done["data"]["original"].strip()
    assert any(e["event"] == "token" for e in ev)


def test_rewrite_fallback_when_model_echoes(client):
    """模型原样复读（空转）→ 结构式兜底仍保证可见变化（B11 红线）。"""
    class EchoProvider(FakeProvider):
        async def chat(self, role, messages, temperature=0.7):
            original = messages[-1]["content"].split("原文：\n")[-1]
            yield {"type": "delta", "text": original}   # 复读原文 = 无变化
            yield {"type": "done"}

    client.app.state.provider = EchoProvider({})
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    ch = client.post("/chapters", json={"project_id": pid, "title": "一"}).json()
    client.post(f"/chapters/{ch['id']}/commit",
                json={"text": "长风吹过断崖，带来了旧日的消息，也带来了杀意。"})
    r = client.post(f"/chapters/{ch['id']}/rewrite",
                    json={"start": 0, "end": 25, "op": "精简"})
    done = next(e for e in parse_sse(r.text) if e["event"] == "done")
    assert done["data"]["result"] != done["data"]["original"].strip(), "兜底必须产生变化"


# ---------- 对话 Agent：数据驱动 + 空项目引导 ----------

def test_chat_data_driven(client):
    client.app.state.provider = FakeProvider({}, fallback="（依据真实数据作答）")
    pid = client.post("/projects", json={"title": "无锋", "genre": "玄幻"}).json()["id"]
    client.post("/characters", json={"project_id": pid, "name": "沈听澜"})
    sid = client.post("/sessions", json={"project_id": pid, "title": "s"}).json()["id"]

    r = client.post(f"/sessions/{sid}/chat", json={"text": "项目现状如何？"})
    ev = parse_sse(r.text)
    tool = next(e for e in ev if e["event"] == "tool_result")
    assert "人物 1" in tool["data"]["result"]            # 统计来自真实数据
    msgs = client.get(f"/sessions/{sid}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]   # 双向落库


def test_chat_empty_project_guidance(client):
    client.app.state.provider = FakeProvider({}, fallback="建议先搭世界观与大纲。")
    pid = client.post("/projects", json={"title": "空白", "genre": "玄幻"}).json()["id"]
    sid = client.post("/sessions", json={"project_id": pid, "title": "s"}).json()["id"]
    r = client.post(f"/sessions/{sid}/chat", json={"text": "从哪开始？"})
    assert r.status_code == 200 and "token" in r.text


# ---------- SSE 重连快照 ----------

def test_task_stream_snapshot(client):
    client.app.state.provider = FakeProvider({"写细纲": "1. 开场"})
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    ch = client.post("/chapters", json={"project_id": pid, "title": "一"}).json()
    r = client.post(f"/chapters/{ch['id']}/generate", json={})
    task_id = parse_sse(r.text)[0]["data"]["task_id"]

    r2 = client.get(f"/tasks/{task_id}/stream")
    ev = parse_sse(r2.text)
    assert ev[0]["event"] == "snapshot"
    assert ev[0]["data"]["status"] == "细纲确认中"
    assert ev[0]["data"]["plan"] == "1. 开场"
