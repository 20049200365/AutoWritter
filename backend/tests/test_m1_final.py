"""M1 收尾验收：A10（模块隔离）/ A11（性能基线）/ A14（日志红线）+ 建议消息采纳流转。"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import pytest

from app.data.db import UnitOfWork, make_engine, make_session_factory
from app.data.models import Base, Chapter, Chunk, Project
from app.data.repos import ChapterRepo, SessionRepo, SkillRepo, CharacterRepo, StateConflict
from app.data.schemas import ChapterCreate, SkillCreate
from app.data.stats import project_stats

BACKEND = Path(__file__).resolve().parents[1] / "app"


@pytest.fixture()
def factory(tmp_path):
    engine = make_engine(tmp_path / "test.db")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


# ---------- A10：模块隔离——app.data 之外不得直接 import ORM 模型 ----------

def test_no_direct_model_import_outside_data_layer():
    offenders = []
    for py in BACKEND.rglob("*.py"):
        rel = py.relative_to(BACKEND)
        if rel.parts[0] == "data":
            continue  # data 包内部允许
        text = py.read_text(encoding="utf-8")
        if "from app.data.models import" in text or "from .data.models import" in text \
                or "app.data import models" in text:
            offenders.append(str(rel))
    assert offenders == [], f"违规直连 ORM: {offenders}"


# ---------- A11：性能基线——1000 章 + 10000 块 ----------

def test_perf_baseline_1000_chapters(factory):
    with UnitOfWork(factory) as uow:
        s = uow.session
        s.add(Project(id=1, title="长篇", genre="玄幻"))
        s.flush()
        s.add_all([
            Chapter(project_id=1, seq=i, title=f"第{i}章", text="正文" * 50,
                    word_count=100, sort=i, status="定稿")
            for i in range(1, 1001)
        ])
        s.add_all([
            Chunk(project_id=1, source_type="chapter", source_id=(i % 1000) + 1,
                  ord=i // 1000, text="块文本", tokens=100)
            for i in range(10000)
        ])
        s.flush()

    with UnitOfWork(factory) as uow:
        t0 = time.perf_counter()
        chapters = ChapterRepo(uow).list(project_id=1)
        t_list = time.perf_counter() - t0
        assert len(chapters) == 1000

        t0 = time.perf_counter()
        stats = project_stats(uow.session, 1)
        t_stats = time.perf_counter() - t0
        assert stats["written"] == 1000 and stats["words"] == 100_000

    assert t_list < 0.5, f"章节列表 {t_list:.3f}s 超标"
    assert t_stats < 0.1, f"统计 {t_stats:.3f}s 超标"


# ---------- A14：日志红线——写操作有 INFO 日志，正文不记全文 ----------

def test_logging_redlines(factory, caplog):
    long_text = "玄之又玄的很长正文内容" * 50  # 11 字/段 × 50 = 550 字
    with caplog.at_level(logging.INFO, logger="m1.repo.chapters"):
        with UnitOfWork(factory) as uow:
            p = Project(title="日志", genre="悬疑")
            uow.session.add(p)
            uow.session.flush()
            ch = ChapterRepo(uow).create(ChapterCreate(project_id=p.id, title="一"))
            ChapterRepo(uow).commit_draft(ch.id, long_text)

    joined = "".join(r.getMessage() for r in caplog.records)
    assert "提交草稿" in joined and "version=" in joined     # 关键操作有日志
    assert long_text[:60] not in joined                       # 全文绝不入日志
    assert "len=550" in joined                                # 只记 text_digest


# ---------- 建议消息：采纳才落库，重复采纳被拒（F4 同源的 M1 侧机制）----------

def test_suggestion_approve_flow(factory):
    with UnitOfWork(factory) as uow:
        s = uow.session
        s.add(Project(id=1, title="建议", genre="玄幻"))
        s.flush()
        session = __import__("app.data.models", fromlist=["ChatSession"]).ChatSession(project_id=1, title="AI 提议")
        s.add(session)
        s.flush()

        repo = SessionRepo(uow)
        msg_id = repo.add_suggestion(session.id, {
            "type": "new_char", "title": "新人物：老铸剑师",
            "detail": "第1章提及但未建档", "evidence": "「铸剑的人抬起头」",
            "target": {"project_id": 1, "name": "老铸剑师", "role": "配角"},
        })
        # 采纳前：人物表为空
        assert CharacterRepo(uow).list(project_id=1) == []
        repo.approve_suggestion(msg_id)
        # 采纳后：人物落库，状态 approved
        chars = CharacterRepo(uow).list(project_id=1)
        assert len(chars) == 1 and chars[0].name == "老铸剑师"
        assert repo.suggestions(session.id)[0]["status"] == "approved"
        with pytest.raises(StateConflict):          # 重复采纳被拒
            repo.approve_suggestion(msg_id)


def test_suggestion_dismiss(factory):
    with UnitOfWork(factory) as uow:
        s = uow.session
        s.add(Project(id=1, title="x", genre="玄幻"))
        s.flush()
        session = __import__("app.data.models", fromlist=["ChatSession"]).ChatSession(project_id=1, title="AI 提议")
        s.add(session)
        s.flush()
        repo = SessionRepo(uow)
        msg_id = repo.add_suggestion(session.id, {"type": "timeline_event", "title": "t",
                                                  "target": {"project_id": 1, "title": "峰会"}})
        repo.dismiss_suggestion(msg_id)
        assert repo.suggestions(session.id)[0]["status"] == "dismissed"


def test_skill_set_enabled(factory):
    with UnitOfWork(factory) as uow:
        skill = SkillRepo(uow).create(SkillCreate(
            name="玄幻网文", filepath="skills/玄幻网文/skill.md", inject_points=["draft"]))
        assert skill.enabled is True
        dto = SkillRepo(uow).set_enabled(skill.id, False)
        assert dto.enabled is False
