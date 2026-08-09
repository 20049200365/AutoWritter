"""P0 冒烟：19 张表建表 + 关键约束 + 配置/日志基建可导入（对齐 M1 SPEC A9 方向）。"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.data.db import make_engine, UnitOfWork, make_session_factory
from app.data import models
from app.data.models import (
    Base, Project, OutlineNode, Chapter, ChapterVersion, Character,
    CharacterAppearance, Relation, Foreshadow, WorldEntry, Skill,
    ChatSession, ChatMessage, Annotation, GenerationTask, PreferenceEvent,
    PreferenceProfile, TimelineEvent, Chunk, ChunkEntity, PostprocessJob,
)

EXPECTED_TABLES = {
    "projects", "outline_nodes", "chapters", "chapter_versions",
    "characters", "character_appearances", "relations", "foreshadows",
    "world_entries", "skills", "chat_sessions", "chat_messages",
    "annotations", "generation_tasks", "preference_events",
    "preference_profile", "timeline_events", "chunks", "chunk_entities",
    "postprocess_jobs",
}


@pytest.fixture()
def session(tmp_path):
    engine = make_engine(tmp_path / "test.db")
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine)
    with UnitOfWork(factory) as uow:
        yield uow.session


def test_all_tables_created(tmp_path):
    engine = make_engine(tmp_path / "t.db")
    Base.metadata.create_all(engine)
    names = set(inspect(engine).get_table_names())
    assert EXPECTED_TABLES <= names, f"缺表: {EXPECTED_TABLES - names}"


def test_wal_and_foreign_keys(tmp_path):
    engine = make_engine(tmp_path / "t.db")
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_project_crud_roundtrip(session):
    p = Project(title="无锋", genre="玄幻", tones=["热血", "克制"])
    session.add(p)
    session.flush()
    got = session.get(Project, p.id)
    assert got.title == "无锋" and got.phase == "筹备" and got.tones == ["热血", "克制"]


def test_chapter_seq_unique(session):
    p = Project(title="t", genre="悬疑")
    session.add(p)
    session.flush()
    session.add(Chapter(project_id=p.id, seq=1, title="一", sort=1))
    session.flush()
    session.add(Chapter(project_id=p.id, seq=1, title="重号", sort=2))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()  # SQLAlchemy 契约：flush 失败后会话已污染，须先回滚


def test_relation_polymorphic_endpoints(session):
    p = Project(title="t", genre="玄幻")
    session.add(p)
    session.flush()
    c = Character(project_id=p.id, name="沈听澜")
    w = WorldEntry(project_id=p.id, category="势力", name="听澜剑宗")
    session.add_all([c, w])
    session.flush()
    r = Relation(project_id=p.id, src_kind="char", src_id=c.id,
                 dst_kind="world", dst_id=w.id, type="隶属")
    session.add(r)
    session.flush()
    assert session.get(Relation, r.id).type == "隶属"


def test_config_and_logging_importable():
    from app.config import settings
    from app.logging_utils import setup_logging, text_digest
    assert settings.context_budget == 128_000
    assert settings.prior_full_k == 3
    assert text_digest("测试正文内容" * 10).startswith("len=")
