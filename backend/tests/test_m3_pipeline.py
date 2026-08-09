"""M3 验收：B 系列（FakeProvider 驱动，零真实 API，B10）。"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.agent.assemble import Assembler
from app.agent.provider import FakeProvider
from app.data.db import UnitOfWork
from app.search.service import SearchService

VALID_REVIEW = json.dumps({
    "scores": {"情节连贯": 8, "人物一致性": 7, "伏笔照应": 9, "节奏": 6, "文风贴合": 8},
    "overall": 7.6, "issues": [{"level": "中", "type": "节奏", "detail": "中段略平"}],
    "revision_suggestions": ["压缩中段对话"]}, ensure_ascii=False)

CANNED = {
    "写细纲": "1. 峰会开场，剑未出鞘\n2. 北冥阁挑衅\n3. 剑自鸣，全场寂静",
    "请扩写章节": "正文草稿：剑鸣了。满堂皆惊，沈听澜按住剑柄，没有拔。",
    "你是小说评审": VALID_REVIEW,
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.main import create_app
    app = create_app()
    app.state.provider = FakeProvider(dict(CANNED))   # B10：全程假模型
    with TestClient(app) as c:
        yield c


def parse_sse(text: str) -> list[dict]:
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


def _seed(client, chapters=1):
    pid = client.post("/projects", json={"title": "无锋", "genre": "玄幻"}).json()["id"]
    vol = client.post("/outline", json={"project_id": pid, "title": "卷一",
                                        "summary": "剑出断雷崖"}).json()
    beat = client.post("/outline", json={"project_id": pid, "parent_id": vol["id"],
                                         "title": "沈听澜赴试剑峰会"}).json()
    ids = []
    for i in range(1, chapters + 1):
        ch = client.post("/chapters", json={"project_id": pid, "title": f"第{i}章"}).json()
        if i < chapters:
            client.post(f"/chapters/{ch['id']}/commit", json={"text": f"第{i}章的前文内容。"})
        ids.append(ch["id"])
    client.patch(f"/chapters/{ids[-1]}", json={"outline_node_id": beat["id"]})
    return pid, ids


# ---------- 两阶段主流程：generate → plan_ready → confirm → 扩写 → 评审 ----------

def test_two_stage_flow(client):
    pid, ids = _seed(client, chapters=2)
    ch_id = ids[-1]

    r = client.post(f"/chapters/{ch_id}/generate", json={})
    events = parse_sse(r.text)
    names = [e["event"] for e in events]
    assert "context_ready" in names and "plan_ready" in names and names[-1] == "done"
    task_id = events[0]["data"]["task_id"]
    ledger = next(e["data"]["ledger"] for e in events if e["event"] == "context_ready")
    assert ledger and all({"layer", "name", "tokens", "status"} <= set(i) for i in ledger)

    task = client.get(f"/tasks/{task_id}").json()
    assert task["status"] == "细纲确认中" and "峰会" in task["plan"]["beats"]

    # 确认细纲（带人工修改）→ 扩写流式 → 评审
    r2 = client.post(f"/tasks/{task_id}/confirm-plan",
                     json={"plan_edited": "1. 开场\n2. 挑衅\n3. 剑鸣（改：不拔剑）"})
    ev2 = parse_sse(r2.text)
    names2 = [e["event"] for e in ev2]
    assert names2.count("token") > 1                       # 流式逐段
    assert "review" in names2 and names2[-1] == "done"
    review = next(e["data"]["review"] for e in ev2 if e["event"] == "review")
    assert set(review["scores"]) == {"情节连贯", "人物一致性", "伏笔照应", "节奏", "文风贴合"}

    task = client.get(f"/tasks/{task_id}").json()
    assert task["status"] == "待决策" and task["draft_text"].startswith("正文草稿")
    ch = client.get(f"/chapters/{ch_id}").json()
    assert ch["word_count"] > 0 and ch["plan"].startswith("1. 开场")  # 人工修改版落库


# ---------- 接受：定稿 + 事件触发（M8 入口）----------

def test_accept_finalizes(client):
    pid, ids = _seed(client)
    r = client.post(f"/chapters/{ids[0]}/generate", json={"skip_plan": True})
    ev = parse_sse(r.text)
    task_id = ev[0]["data"]["task_id"]
    assert ev[-1]["event"] == "done"                        # skip_plan 直达待决策

    out = client.post(f"/tasks/{task_id}/decide", json={"decision": "accept"}).json()
    assert out["status"] == "已接受"
    assert client.get(f"/chapters/{ids[0]}").json()["status"] == "定稿"


# ---------- B9：驳回迭代 + 轮次上限 ----------

def test_reject_and_round_limit(client):
    client.app.state.settings.max_rounds = 2
    pid, ids = _seed(client)
    r = client.post(f"/chapters/{ids[0]}/generate", json={"skip_plan": True})
    task_id = parse_sse(r.text)[0]["data"]["task_id"]

    out = client.post(f"/tasks/{task_id}/decide", json={
        "decision": "reject", "tags": ["情节方向不对"], "note": "主角不该退让"}).json()
    assert out["status"] == "已驳回"
    task = client.get(f"/tasks/{task_id}").json()
    assert task["reject_tags"] == ["情节方向不对"] and task["reject_note"] == "主角不该退让"

    r2 = client.post(f"/tasks/{task_id}/resume")            # 第 2 轮（完整流程，停在细纲确认）
    ev2 = parse_sse(r2.text)
    task2_id = ev2[0]["data"]["task_id"]
    assert client.get(f"/tasks/{task2_id}").json()["round"] == 2
    assert ev2[-1]["event"] == "done" and any(e["event"] == "plan_ready" for e in ev2)

    client.post(f"/tasks/{task2_id}/confirm-plan", json={})  # 扩写+评审 → 待决策
    client.post(f"/tasks/{task2_id}/decide", json={"decision": "reject", "tags": ["节奏问题"]})
    assert client.post(f"/tasks/{task2_id}/resume").status_code == 409  # 达上限（流前预校验）


# ---------- B7：评审 schema 失败自动重请 ----------

def test_review_retry_on_bad_json(client):
    client.app.state.provider = FakeProvider({
        "写细纲": "1. 开场",
        "请扩写章节": "正文。",
        "你是小说评审": ["这不是JSON", VALID_REVIEW],   # 第一次坏 → 重请 → 第二次好
    })
    pid, ids = _seed(client)
    r = client.post(f"/chapters/{ids[0]}/generate", json={"skip_plan": True})
    ev = parse_sse(r.text)
    assert any(e["event"] == "review" for e in ev)          # 重请后成功
    calls = [c for c in client.app.state.provider.calls if c["role"] == "reviewer"]
    assert len(calls) == 2


# ---------- B2：预算压缩（P4 → P3，P0~P2 不动）----------

def test_budget_compression(client):
    pid = client.post("/projects", json={"title": "无锋", "genre": "玄幻"}).json()["id"]
    client.post("/characters", json={"project_id": pid, "name": "沈听澜"})
    vol = client.post("/outline", json={"project_id": pid, "title": "卷一"}).json()
    beat = client.post("/outline", json={"project_id": pid, "parent_id": vol["id"],
                                         "title": "沈听澜赴试剑峰会"}).json()
    ch1 = client.post("/chapters", json={"project_id": pid, "title": "第1章"}).json()
    client.post(f"/chapters/{ch1['id']}/commit", json={"text": "沈听澜磨剑，剑光如霜。"})
    ch2 = client.post("/chapters", json={"project_id": pid, "title": "第2章"}).json()
    client.patch(f"/chapters/{ch2['id']}", json={"outline_node_id": beat["id"]})
    client.post("/world-entries", json={"project_id": pid, "category": "势力",
                                        "name": "听澜剑宗",
                                        "content": "听澜剑宗由沈听澜所创，门规森严。"})
    with UnitOfWork(client.app.state.session_factory) as uow:
        svc = SearchService(uow)
        svc.rebuild(pid)
        result = Assembler(uow.session, svc).assemble_for_chapter(
            pid, ch2["id"], budget=60, prior_full_k=1)       # 极小预算逼出压缩
    statuses = {i["name"]: i["status"] for i in result["ledger"]}
    assert statuses.get("前K章全文") == "装入"               # 必装层不压缩
    dropped = [n for n, s in statuses.items() if s == "压缩丢弃"]
    assert dropped, f"选装层应被压缩丢弃，实际账本：{statuses}"


# ---------- B10：零真实 API ----------

def test_fake_provider_only(client):
    provider = client.app.state.provider
    pid, ids = _seed(client)
    client.post(f"/chapters/{ids[0]}/generate", json={"skip_plan": True})
    assert isinstance(provider, FakeProvider) and provider.calls
    assert all(c["role"] in ("writer", "reviewer", "distiller") for c in provider.calls)
