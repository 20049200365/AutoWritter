"""M6 验收：D1 路由覆盖 / D2 DTO 契约 / D3 错误模型 / D5 网络面 / D7 启动 / D9 撤销联动。"""
from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


def _norm(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{id}", path)


# ---------- D1：路由覆盖与 spec §2 逐条一致 ----------

EXPECTED = {
    "/projects", "/projects/{id}", "/projects/{id}/restore", "/projects/{id}/stats",
    "/projects/{id}/outline", "/outline", "/outline/{id}", "/outline/{id}/move",
    "/projects/{id}/chapters", "/chapters", "/chapters/{id}", "/chapters/{id}/commit",
    "/chapters/{id}/versions", "/chapters/{id}/accept",
    "/characters", "/characters/{id}", "/relations", "/relations/{id}", "/relations/neighbors",
    "/foreshadows", "/foreshadows/{id}", "/foreshadows/{id}/resolve", "/foreshadows/{id}/unresolve",
    "/world-entries", "/world-entries/{id}", "/timeline-events", "/timeline-events/{id}",
    "/skills", "/skills/{id}", "/skills/{id}/enable",
    "/projects/{id}/sessions", "/sessions", "/sessions/{id}", "/sessions/{id}/messages",
    "/sessions/{id}/chat", "/chapters/{id}/generate", "/chapters/{id}/rewrite",
    "/tasks", "/tasks/{id}", "/tasks/{id}/confirm-plan", "/tasks/{id}/decide",
    "/tasks/{id}/cancel", "/tasks/{id}/resume", "/tasks/{id}/stream",
    "/suggestions", "/suggestions/{id}/approve", "/suggestions/{id}/dismiss",
    "/preferences/{id}", "/preferences/{id}/events", "/preferences/{id}/rollback",
    "/projects/{id}/search", "/health", "/config",
}


def test_route_coverage_matches_spec(client):
    # 对照 OpenAPI 文档（新版 FastAPI 惰性装载路由，app.routes 不可直接枚举；
    # 且 OpenAPI 本就是 M7 的接口契约，比对其路径更贴合 D1 本意）
    paths = set(client.get("/openapi.json").json()["paths"].keys())
    actual = {_norm(p) for p in paths}
    missing = EXPECTED - actual
    extra = actual - EXPECTED
    assert not missing, f"缺路由: {missing}"
    assert not extra, f"多路由: {extra}"


# ---------- D7：健康检查 + 配置不泄漏 key ----------

def test_health_and_config_no_secret_leak(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    cfg = client.get("/config")
    assert cfg.status_code == 200
    assert "sk-" not in cfg.text                    # key 永不暴露（架构 §3.4）
    assert "api_key" not in cfg.json()["llm"]


# ---------- D3：错误模型 ----------

def test_error_model_404(client):
    r = client.get("/projects/9999")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "not_found" and "message" in body and "details" in body


def test_error_model_409(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    v = client.post("/outline", json={"project_id": pid, "title": "卷"}).json()
    s = client.post("/outline", json={"project_id": pid, "parent_id": v["id"], "title": "篇"}).json()
    l3 = client.post("/outline", json={"project_id": pid, "parent_id": s["id"], "title": "节拍"}).json()
    r = client.post("/outline", json={"project_id": pid, "parent_id": l3["id"], "title": "非法"})
    assert r.status_code == 409 and r.json()["code"] == "state_conflict"


# ---------- D9：删除 → 撤销回原位 ----------

def test_delete_restore_roundtrip(client):
    ids = [client.post("/projects", json={"title": f"书{i}", "genre": "悬疑"}).json()["id"]
           for i in range(3)]
    client.delete(f"/projects/{ids[1]}")
    assert [p["id"] for p in client.get("/projects").json()] == [ids[0], ids[2]]
    client.post(f"/projects/{ids[1]}/restore")
    assert [p["id"] for p in client.get("/projects").json()] == ids  # 原位还原


# ---------- 章节全链路（CRUD → commit → versions → accept → stats）----------

def test_chapter_flow_and_stats(client):
    pid = client.post("/projects", json={"title": "无锋", "genre": "玄幻"}).json()["id"]
    ch = client.post("/chapters", json={"project_id": pid, "title": "第一章"}).json()
    r = client.post(f"/chapters/{ch['id']}/commit", json={"text": "剑未出鞘，风先动了。"})
    assert r.json()["version"] == 1
    versions = client.get(f"/chapters/{ch['id']}/versions").json()
    assert len(versions) == 1 and versions[0]["word_count"] == 8
    one = client.get(f"/chapters/{ch['id']}/versions", params={"version": 1}).json()
    assert one["text"] == "剑未出鞘，风先动了。"
    acc = client.post(f"/chapters/{ch['id']}/accept", json={})
    assert acc.json()["status"] == "定稿"
    stats = client.get(f"/projects/{pid}/stats").json()
    assert stats["written"] == 1 and stats["words"] == 8


# ---------- 建议消息：API 采纳/驳回 ----------

def test_suggestion_api_flow(client):
    pid = client.post("/projects", json={"title": "建议", "genre": "玄幻"}).json()["id"]
    sid = client.post("/sessions", json={"project_id": pid, "title": "AI 提议"}).json()["id"]

    # 模拟 M8 写入一条建议（M8 落地前用 Repo 直注）
    from app.data.db import UnitOfWork
    from app.data.repos import SessionRepo
    with UnitOfWork(client.app.state.session_factory) as uow:
        msg_id = SessionRepo(uow).add_suggestion(sid, {
            "type": "new_char", "title": "新人物：老铸剑师",
            "target": {"project_id": pid, "name": "老铸剑师"}})

    pending = client.get("/suggestions", params={"session_id": sid}).json()
    assert len(pending) == 1 and pending[0]["status"] == "pending"
    assert client.post(f"/suggestions/{msg_id}/approve").status_code == 204
    chars = client.get("/characters", params={"project_id": pid}).json()
    assert [c["name"] for c in chars] == ["老铸剑师"]       # 采纳后才落库
    # 重复采纳 → 409
    assert client.post(f"/suggestions/{msg_id}/approve").status_code == 409


# ---------- 占位端点：501 ----------

def test_stubs_return_501(client):
    r = client.get("/tasks")                       # M3 未落地，仍为占位端点
    assert r.status_code == 501 and r.json()["code"] == "not_implemented"


# ---------- D6 薄层：路由代码不得直连 ORM（静态检查）----------

def test_api_layer_does_not_import_models():
    from pathlib import Path
    api_dir = Path(__file__).resolve().parents[1] / "app" / "api"
    offenders = [p.name for p in api_dir.glob("*.py")
                 if "data.models" in p.read_text(encoding="utf-8")]
    assert offenders == [], f"路由层直连 ORM: {offenders}"
