"""M4 验收：G 系列（Skill 系统）+ M5 验收：H 系列（偏好学习）。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent.preference import PreferenceService
from app.agent.provider import FakeProvider
from app.agent.skills import SkillRegistry, parse_frontmatter, validate_package
from app.data.db import UnitOfWork


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from app.main import create_app
    with TestClient(create_app()) as c:
        yield c


# ================= M4：G 系列 =================

def test_g1_package_validation():
    meta_ok = {"name": "x", "inject_points": ["draft"]}
    assert validate_package(meta_ok) == []
    assert validate_package({"inject_points": ["draft"]})            # 缺 name
    assert validate_package({"name": "x"})                            # 缺注入点
    assert validate_package({"name": "x", "inject_points": ["魔法"]})  # 非法值
    meta, body = parse_frontmatter("---\nname: A\ninject_points: [draft, review]\n---\n正文")
    assert meta["name"] == "A" and meta["inject_points"] == ["draft", "review"] and body == "正文"


def test_g4_presets_bootstrapped(client):
    skills = client.get("/skills").json()
    names = {s["name"] for s in skills}
    assert {"玄幻网文", "情感", "悬疑"} <= names
    assert all(Path(s["filepath"]).exists() for s in skills)


def test_g2_g3_render_and_toggle(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    reg = client.app.state.skill_registry
    text = reg.render("draft", pid)
    assert "【Skill：玄幻网文】" in text and "【Skill：悬疑】" in text
    assert "【Skill：情感】" in text
    outline_text = reg.render("outline", pid)
    # 注入点过滤：只有悬疑声明了 outline
    assert "【Skill：悬疑】" in outline_text and "【Skill：玄幻网文】" not in outline_text

    # G3 热切换：停用后不再注入
    xh = next(s for s in client.get("/skills").json() if s["name"] == "玄幻网文")
    client.post(f"/skills/{xh['id']}/enable", json={"enabled": False})
    reg.reload(xh["id"])
    assert "【Skill：玄幻网文】" not in reg.render("draft", pid)


def test_g5_project_isolation(client):
    p1 = client.post("/projects", json={"title": "a", "genre": "玄幻"}).json()["id"]
    p2 = client.post("/projects", json={"title": "b", "genre": "玄幻"}).json()["id"]
    pkg = client.app.state.settings.skills_dir
    f = Path(pkg) / "私有技能"
    f.mkdir(exist_ok=True)
    (f / "skill.md").write_text("---\nname: 私有技能\ninject_points: [draft]\n---\n私有内容",
                                encoding="utf-8")
    client.post("/skills", json={"scope": "project", "project_id": p1,
                                 "name": "私有技能", "inject_points": ["draft"],
                                 "filepath": str(f / "skill.md")})
    reg = client.app.state.skill_registry
    assert "私有内容" in reg.render("draft", p1)
    assert "私有内容" not in reg.render("draft", p2)      # 项目隔离


def test_g6_edit_reload(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    reg = client.app.state.skill_registry
    xh = next(s for s in client.get("/skills").json() if s["name"] == "玄幻网文")
    p = Path(xh["filepath"])
    p.write_text(p.read_text(encoding="utf-8") + "\n新增条款：禁止系统流。", encoding="utf-8")
    reg.reload(xh["id"])
    assert "新增条款" in reg.render("draft", pid)


def test_skill_injected_into_pipeline_ledger(client):
    """M4→M3 联动：生成装配的账本含 Skill 注入段与名称（B12）。"""
    client.app.state.provider = FakeProvider({"写细纲": "1. 开场"})
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    ch = client.post("/chapters", json={"project_id": pid, "title": "一"}).json()
    r = client.post(f"/chapters/{ch['id']}/generate", json={})
    ev = [b for b in r.text.split("\n\n") if "context_ready" in b]
    assert ev and "玄幻网文" in ev[0]                 # 注入清单随事件可见


# ================= M5：H 系列 =================

DISTILL_OUT = json.dumps({"likes": ["短句"], "dislikes": ["大段独白"],
                          "rubric_weights": {"节奏": 1.2}}, ensure_ascii=False)


def _svc(client):
    return PreferenceService(client.app.state.session_factory,
                             FakeProvider({"蒸馏偏好": DISTILL_OUT}))


def test_h1_record_and_events_api(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    _svc(client).record_decision(pid, "reject", ["节奏问题"], "太慢")
    events = client.get(f"/preferences/{pid}/events").json()
    assert len(events) == 1 and events[0]["tags"] == ["节奏问题"]


def test_h2_distill_trigger(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    svc = _svc(client)
    for i in range(5):                                    # 第 5 条触发蒸馏
        svc.record_decision(pid, "reject", ["节奏问题"], f"反馈{i}")
    prof = client.get(f"/preferences/{pid}").json()
    assert "短句" in prof["likes"] and "大段独白" in prof["dislikes"]
    assert prof["version"] >= 2 and len(prof["snapshots"]) >= 1


def test_h3_manual_priority(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    client.put(f"/preferences/{pid}", json={"likes": ["手写偏好"]})
    svc = _svc(client)
    for i in range(5):
        svc.record_decision(pid, "accept")
    prof = client.get(f"/preferences/{pid}").json()
    assert prof["likes"] == ["手写偏好"] and prof["source"] == "manual"  # 蒸馏不覆盖


def test_h4_rollback(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    client.put(f"/preferences/{pid}", json={"likes": ["v1状态"]})       # version 2，快照记录 v1 前状态
    client.put(f"/preferences/{pid}", json={"likes": ["v2状态"]})       # version 3，快照记录 v2（含 v1状态）
    out = client.post(f"/preferences/{pid}/rollback", json={"version": 2}).json()
    assert out["likes"] == ["v1状态"]
    assert client.post(f"/preferences/{pid}/rollback",
                       json={"version": 99}).status_code == 404


def test_h5_hard_constraint_escalation(client):
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    svc = PreferenceService(client.app.state.session_factory)  # 无 provider，不蒸馏
    for _ in range(3):
        svc.record_decision(pid, "reject", ["节奏问题"], "慢")
    prof = client.get(f"/preferences/{pid}").json()
    assert any("节奏问题" in h for h in prof["hard_constraints"])


def test_h6_preference_injected_into_assembly(client):
    """M5→M3 联动：画像进装配 P0（账本含用户偏好段）。"""
    client.app.state.provider = FakeProvider({"写细纲": "1. 开场"})
    pid = client.post("/projects", json={"title": "t", "genre": "玄幻"}).json()["id"]
    client.put(f"/preferences/{pid}", json={"likes": ["短句"], "dislikes": ["长独白"]})
    # 替换回 Fake 以驱动生成
    client.app.state.provider = FakeProvider({"写细纲": "1. 开场"})
    client.app.state.preference_service.provider = client.app.state.provider
    ch = client.post("/chapters", json={"project_id": pid, "title": "一"}).json()
    r = client.post(f"/chapters/{ch['id']}/generate", json={})
    blocks = [b for b in r.text.split("\n\n") if "context_ready" in b]
    assert blocks and "用户偏好" in blocks[0]


def test_h7_fake_only(client):
    """H7：M5 测试全程 FakeProvider，零真实 API。"""
    svc = _svc(client)
    assert isinstance(svc.provider, FakeProvider)
