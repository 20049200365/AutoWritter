"""M2 验收：C1~C11（实体路/关键词路/融合/改写/增量/专名/重建/性能/契约/无向量/日志）。"""
from __future__ import annotations

import logging
import time

import pytest
from fastapi.testclient import TestClient

from app.data.db import UnitOfWork
from app.search.chunker import chunk_text, tokenize_for_fts
from app.search.service import SearchService


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.main import create_app
    with TestClient(create_app()) as c:
        yield c


def _seed(client):
    """样本项目：1 人物 / 1 器物词条 / 2 章正文（事件驱动自动建索引）。"""
    pid = client.post("/projects", json={"title": "无锋", "genre": "玄幻"}).json()["id"]
    char = client.post("/characters", json={
        "project_id": pid, "name": "沈听澜", "aliases": ["澜"]}).json()
    entry = client.post("/world-entries", json={
        "project_id": pid, "category": "器物", "name": "无锋剑",
        "content": "铁胎古剑，认主需血契。"}).json()
    ch1 = client.post("/chapters", json={"project_id": pid, "title": "第一章"}).json()
    client.post(f"/chapters/{ch1['id']}/commit", json={
        "text": "沈听澜握住无锋剑的那一刻，雷声停了。\n铸剑的人说过，剑在认人。"})
    ch2 = client.post("/chapters", json={"project_id": pid, "title": "第二章"}).json()
    client.post(f"/chapters/{ch2['id']}/commit", json={
        "text": "山门的石阶很长，他一步一步走上去，风里没有声音。"})
    return pid, char, entry, ch1, ch2


def _link_entities(client, chapter_id, entities):
    with UnitOfWork(client.app.state.session_factory) as uow:
        SearchService(uow).set_chunk_entities("chapter", chapter_id, entities)


# ---------- C1：实体路命中 ----------

def test_entity_route_hits(client):
    pid, char, entry, ch1, ch2 = _seed(client)
    _link_entities(client, ch1["id"], [
        {"entity_type": "char", "entity_name": "沈听澜", "ord": 0},
        {"entity_type": "item", "entity_name": "无锋剑", "ord": 0}])
    hits = client.get(f"/projects/{pid}/search",
                      params={"query": "无锋剑认主", "types": "chapter"}).json()
    assert hits and hits[0]["matched_by"] == "entity"
    assert hits[0]["source_id"] == ch1["id"]


# ---------- C2：关键词路命中 ----------

def test_fts_route_hits(client):
    pid, *_rest, ch2 = _seed(client)
    hits = client.get(f"/projects/{pid}/search",
                      params={"query": "石阶", "types": "chapter"}).json()
    assert hits and any(h["source_id"] == ch2["id"] and h["matched_by"] == "fts"
                        for h in hits)


# ---------- C3：实体命中块排序优先 ----------

def test_entity_hits_rank_higher(client):
    pid, char, entry, ch1, ch2 = _seed(client)
    _link_entities(client, ch1["id"], [
        {"entity_type": "char", "entity_name": "沈听澜", "ord": 0}])
    hits = client.get(f"/projects/{pid}/search",
                      params={"query": "沈听澜走过石阶", "types": "chapter"}).json()
    assert hits[0]["source_id"] == ch1["id"] and hits[0]["matched_by"] == "entity"


# ---------- C4：LLM 查询改写（最多 1 次）----------

def test_rewrite_fallback(client):
    pid, *_ = _seed(client)
    calls = []

    def fake_rewriter(q):
        calls.append(q)
        return ["石阶", "山门"]

    with UnitOfWork(client.app.state.session_factory) as uow:
        svc = SearchService(uow, rewriter=fake_rewriter)
        hits = svc.search("主角上山那段描写", ["chapter"], pid)
    assert calls == ["主角上山那段描写"]   # 恰好改写一次（防套娃）
    assert any(h["text"] and "石阶" in h["text"] for h in hits)


# ---------- C5：增量一致（事件驱动）----------

def test_incremental_index(client):
    pid, *_rest, ch2 = _seed(client)
    client.post(f"/chapters/{ch2['id']}/commit", json={"text": "他在门前看见一扇青铜门。"})
    hits = client.get(f"/projects/{pid}/search",
                      params={"query": "青铜门", "types": "chapter"}).json()
    assert any("青铜门" in h["text"] for h in hits)

    client.delete(f"/chapters/{ch2['id']}")
    hits = client.get(f"/projects/{pid}/search",
                      params={"query": "青铜门", "types": "chapter"}).json()
    assert hits == []                                    # 删除后检索不再命中


# ---------- C6：专名保护 ----------

def test_user_word_not_split(client):
    _seed(client)   # 人物创建事件触发词典注册
    tokens = tokenize_for_fts("沈听澜握着剑").split()
    assert "沈听澜" in tokens                             # 不被切成 沈/听/澜


# ---------- C7：重建幂等 ----------

def test_rebuild_idempotent(client):
    pid, *_rest, ch1 = _seed(client)
    factory = client.app.state.session_factory

    def run_and_search():
        with UnitOfWork(factory) as uow:
            SearchService(uow).rebuild(pid)
        with UnitOfWork(factory) as uow:
            return SearchService(uow).search("无锋剑", ["chapter", "world"], pid)

    first = run_and_search()
    second = run_and_search()
    assert [(h["source_type"], h["source_id"], h["ord"]) for h in first] == \
           [(h["source_type"], h["source_id"], h["ord"]) for h in second]


# ---------- C8：性能基线（10000 块单次检索 < 200ms）----------

def test_search_performance(client):
    pid, *_ = _seed(client)
    from sqlalchemy import text as _t
    with UnitOfWork(client.app.state.session_factory) as uow:
        s = uow.session
        rows = [{"pid": pid, "st": "chapter", "sid": i % 500 + 10, "ord": i // 500,
                 "text": f"块文本{i}号剑光照水", "tokens": 50, "entities": "[]"}
                for i in range(10000)]
        s.execute(_t("INSERT INTO chunks (project_id, source_type, source_id, ord, text, tokens, entities) "
                     "VALUES (:pid, :st, :sid, :ord, :text, :tokens, :entities)"), rows)
        s.flush()
        pairs = [(r[0], tokenize_for_fts(r[1])) for r in s.execute(_t(
            "SELECT id, text FROM chunks WHERE project_id=:p AND source_id >= 10"), {"p": pid})]
        s.connection().connection.executemany(
            "INSERT INTO chunks_fts(rowid, words) VALUES (?, ?)", pairs)
        s.flush()

    with UnitOfWork(client.app.state.session_factory) as uow:
        svc = SearchService(uow)
        t0 = time.perf_counter()
        svc.search("剑光照水", ["chapter"], pid, k=10)
        elapsed = time.perf_counter() - t0
    assert elapsed < 0.2, f"检索 {elapsed:.3f}s 超标"


# ---------- C9：入参过滤生效 ----------

def test_filters(client):
    pid, *_rest, ch1 = _seed(client)
    _link_entities(client, ch1["id"], [
        {"entity_type": "item", "entity_name": "无锋剑", "ord": 0}])
    world_only = client.get(f"/projects/{pid}/search",
                            params={"query": "无锋剑", "types": "world"}).json()
    assert world_only and all(h["source_type"] == "world" for h in world_only)

    ranged = client.get(f"/projects/{pid}/search", params={
        "query": "无锋剑", "types": "chapter"}).json()  # 默认全范围
    assert any(h["source_id"] == ch1["id"] for h in ranged)


# ---------- C10：无向量（静态检查）----------

def test_no_vector_dependency():
    from pathlib import Path
    backend = Path(__file__).resolve().parents[1]
    req = (backend / "requirements.txt").read_text(encoding="utf-8").lower()
    banned = ["qdrant", "chroma", "faiss", "sqlite-vec", "sentence-transformers", "embedding"]
    assert not any(b in req for b in banned)
    for py in (backend / "app" / "search").glob("*.py"):
        assert "embedding" not in py.read_text(encoding="utf-8").lower()


# ---------- C11：日志带关联 ID ----------

def test_search_logging(client):
    pid, *_ = _seed(client)
    captured: list[str] = []

    class _Collector(logging.Handler):
        def emit(self, record):
            captured.append(record.getMessage())

    handler = _Collector()
    logger = logging.getLogger("m2.search")
    logger.addHandler(handler)
    old_level = logger.level
    logger.setLevel(logging.DEBUG)
    try:
        with UnitOfWork(client.app.state.session_factory) as uow:
            SearchService(uow).search("石阶", ["chapter"], pid)
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)
    assert any(f"project={pid}" in m for m in captured), captured


# ---------- 切块器单测（§2 策略）----------

def test_chunker_rules():
    paras = ["甲" * 300, "乙" * 300, "丙" * 50]
    blocks = chunk_text("\n".join(paras))
    assert blocks[0] == "甲" * 300
    assert blocks[1].startswith("乙" * 300) and "丙" * 50 in blocks[1]  # 尾块并入
    assert all(len(b) <= 600 for b in chunk_text("丁" * 1500))
