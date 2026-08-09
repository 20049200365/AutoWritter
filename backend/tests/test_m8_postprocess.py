"""M8 验收：F 系列（章节后处理，FakeProvider 驱动）。"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.agent.postprocess import PostProcessor
from app.agent.provider import FakeProvider
from app.data.db import UnitOfWork
from app.data.models import Chapter, Character, CharacterAppearance, ChunkEntity, Foreshadow
from app.data.repos import SessionRepo
from app.search.service import SearchService
from sqlalchemy import select


def _canned(pid, char_id, world_id):
    return {
        "请总结本章": "摘要：沈听澜赴试剑峰会，剑自鸣，全场寂静。",
        "抽取实体": json.dumps({"entities": [
            {"name": "沈听澜", "type": "char"},
            {"name": "无锋剑", "type": "item"}]}, ensure_ascii=False),
        "分析（relations）": json.dumps([{
            "label": "对抗", "detail": "北冥阁当众挑衅", "evidence": "原文第3段",
            "project_id": pid, "src_kind": "char", "src_id": char_id,
            "dst_kind": "world", "dst_id": world_id, "type": "对抗"}], ensure_ascii=False),
        "分析（foreshadows）": json.dumps([{
            "kind": "plant", "title": "剑灵来历", "detail": "剑鸣似有灵智",
            "evidence": "「剑在认人」"}], ensure_ascii=False),
        "分析（timeline）": "[]",
        "大纲对账": json.dumps({"level": "严重偏离", "points": ["主角未在峰会出手"]},
                               ensure_ascii=False),
    }


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c, app


def _seed(client):
    pid = client.post("/projects", json={"title": "无锋", "genre": "玄幻"}).json()["id"]
    char = client.post("/characters", json={"project_id": pid, "name": "沈听澜"}).json()
    world = client.post("/world-entries", json={"project_id": pid, "category": "势力",
                                                "name": "北冥阁", "content": "行事乖张。"}).json()
    beat = client.post("/outline", json={"project_id": pid, "title": "峰会出手"}).json()
    ch = client.post("/chapters", json={"project_id": pid, "title": "第一章"}).json()
    client.post(f"/chapters/{ch['id']}/commit",
                json={"text": "沈听澜握住无锋剑，剑鸣了一声。北冥阁的人在笑。"})
    client.patch(f"/chapters/{ch['id']}", json={"outline_node_id": beat["id"]})
    return pid, char, world, ch


def _run_postprocess(app, ch_id, canned):
    app.state.provider = FakeProvider(canned)
    return PostProcessor(app.state.session_factory, app.state.provider).run_for_chapter(ch_id)


# ---------- F1/F2/F3：触发完整 + 摘要 + 事实表直写 ----------

def test_summary_entities_and_jobs(env):
    client, app = env
    pid, char, world, ch = _seed(client)
    # 先建索引，实体共现才有块可写
    with UnitOfWork(app.state.session_factory) as uow:
        SearchService(uow).rebuild(pid)

    results = _run_postprocess(app, ch["id"], _canned(pid, char["id"], world["id"]))
    assert all(v == "done" for v in results.values()), results

    with UnitOfWork(app.state.session_factory) as uow:
        s = uow.session
        assert "沈听澜" in (s.get(Chapter, ch["id"]).summary or "")       # F2 摘要落库
        assert s.get(CharacterAppearance, (char["id"], ch["id"])) is not None  # F3 出场
        ents = list(s.scalars(select(ChunkEntity).where(ChunkEntity.entity_name == "沈听澜")))
        assert ents, "块×实体共现应写入"


# ---------- F4：推断只发建议，采纳才落库 ----------

def test_relation_suggestion_flow(env):
    client, app = env
    pid, char, world, ch = _seed(client)
    _run_postprocess(app, ch["id"], _canned(pid, char["id"], world["id"]))

    sessions = client.get(f"/projects/{pid}/sessions").json()
    sug_session = next(x for x in sessions if x["title"] == "AI 提议")
    pending = client.get("/suggestions", params={"session_id": sug_session["id"]}).json()
    types = {p["suggestion"]["type"] for p in pending}
    assert "relation_change" in types and "foreshadow_plant" in types and "outline_check" in types

    # 采纳前：relations 表为空
    assert client.get("/relations", params={"project_id": pid}).json() == []
    rel_msg = next(p for p in pending if p["suggestion"]["type"] == "relation_change")
    assert client.post(f"/suggestions/{rel_msg['id']}/approve").status_code == 204
    rels = client.get("/relations", params={"project_id": pid}).json()
    assert len(rels) == 1 and rels[0]["type"] == "对抗"       # 采纳后才落库


# ---------- F5：伏笔红线——后处理不碰 foreshadows 表 ----------

def test_foreshadow_table_untouched(env):
    client, app = env
    pid, char, world, ch = _seed(client)
    fsp = client.post("/foreshadows", json={"project_id": pid, "title": "旧伏笔",
                                            "description": "埋于第1章"}).json()
    before = client.get("/foreshadows", params={"project_id": pid}).json()
    _run_postprocess(app, ch["id"], _canned(pid, char["id"], world["id"]))
    after = client.get("/foreshadows", params={"project_id": pid}).json()
    assert before == after, "伏笔表不得被后处理变更（只发建议）"


# ---------- F6：单步失败不连坐 ----------

def test_step_failure_isolated(env):
    client, app = env
    pid, char, world, ch = _seed(client)

    class BrokenProvider(FakeProvider):
        def chat_sync(self, role, messages, temperature=0.7):
            if any("请总结本章" in str(m.get("content", "")) for m in messages):
                raise RuntimeError("模拟蒸馏服务故障")
            return super().chat_sync(role, messages, temperature)

    app.state.provider = BrokenProvider(_canned(pid, char["id"], world["id"]))
    results = PostProcessor(app.state.session_factory, app.state.provider).run_for_chapter(ch["id"])
    assert results["summary"] == "failed"
    assert results["entities"] == "done"                 # 失败步不阻塞其他步

    from app.data.models import PostprocessJob
    with UnitOfWork(app.state.session_factory) as uow:
        jobs = {j.step: j.status for j in uow.session.scalars(
            select(PostprocessJob).where(PostprocessJob.chapter_id == ch["id"]))}
    assert jobs["summary"] == "failed" and jobs["entities"] == "done"


# ---------- F8：大纲对账偏离 → 提醒建议 ----------

def test_timeline_alias_keys_normalized(env):
    """真模型键名不稳定（event/description）→ 归一化后建议卡片不得为空。"""
    client, app = env
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    ch = client.post("/chapters", json={"project_id": pid, "title": "一"}).json()
    client.post(f"/chapters/{ch['id']}/commit", json={"text": "沈听澜在剑台上挡下七剑。"})
    canned = {
        "请总结本章": "摘要。",
        "抽取实体": '{"entities":[]}',
        "分析（relations）": "[]",
        "分析（foreshadows）": "[]",
        "分析（timeline）": '[{"event":"剑台扬名","description":"沈听澜以剑鞘挡下七剑，满场皆惊"}]',
        "大纲对账": '{"level":"对齐","points":[]}',
    }
    _run_postprocess(app, ch["id"], canned)
    sessions = client.get(f"/projects/{pid}/sessions").json()
    sug = next(x for x in sessions if x["title"] == "AI 提议")
    pend = client.get("/suggestions", params={"session_id": sug["id"]}).json()
    tl = [p for p in pend if p["suggestion"]["type"] == "timeline_event"]
    assert tl and tl[0]["suggestion"]["title"] == "剑台扬名"
    assert "沈听澜" in (tl[0]["suggestion"]["detail"] or "")


def test_outline_check_suggestion(env):
    client, app = env
    pid, char, world, ch = _seed(client)
    _run_postprocess(app, ch["id"], _canned(pid, char["id"], world["id"]))
    sessions = client.get(f"/projects/{pid}/sessions").json()
    sug_session = next(x for x in sessions if x["title"] == "AI 提议")
    pending = client.get("/suggestions", params={"session_id": sug_session["id"]}).json()
    checks = [p for p in pending if p["suggestion"]["type"] == "outline_check"]
    assert checks and "严重偏离" in checks[0]["suggestion"]["title"]
    assert client.post(f"/suggestions/{checks[0]['id']}/approve").status_code == 204  # 提醒类采纳=已读
