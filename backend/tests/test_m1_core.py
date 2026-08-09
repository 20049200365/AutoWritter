"""M1 核心机制测试：字数口径（A3）、统计一致性（A7）、事件总线语义（A8 方向）。"""
from __future__ import annotations

import pytest

from app.data.db import UnitOfWork, make_engine, make_session_factory
from app.data.events import CHAPTER_ACCEPTED, EventBus
from app.data.models import (
    Base, Chapter, Character, ChatSession, Foreshadow, OutlineNode,
    Project, Relation, TimelineEvent, WorldEntry,
)
from app.data.stats import project_stats, word_count


# ---------- A3：字数口径与 Demo wordCount() 逐例一致 ----------

@pytest.mark.parametrize("text,expected", [
    ("", 0),
    (None, 0),
    ("你好", 2),
    ("Hello world", 2),
    ("你好world123", 3),          # 2 CJK + 1 拉丁词（world123 连写算一个）
    ("……！？，", 0),              # 纯标点
    ("第一章 风起，风未停。", 8),
    ("他说：Hello, World! 然后离开。", 8),  # 6 CJK + Hello/World 两词
    ("abc123 def", 2),
])
def test_word_count_matches_demo(text, expected):
    assert word_count(text) == expected


# ---------- 夹具 ----------

@pytest.fixture()
def uow_factory(tmp_path):
    engine = make_engine(tmp_path / "test.db")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _seed(session) -> int:
    """构造可断言的样本项目：2 章 / 2 人物 / 1 关系 / 3 伏笔 / 1 词条 / 1 事件 / 1 会话。"""
    p = Project(title="样本", genre="玄幻")
    session.add(p)
    session.flush()
    session.add_all([
        OutlineNode(project_id=p.id, level=1, sort=1, title="卷一", summary="概要"),
        OutlineNode(project_id=p.id, level=2, sort=1, title="篇章一"),
    ])
    session.flush()
    session.add_all([
        OutlineNode(project_id=p.id, level=3, sort=i, title=f"节拍{i}")
        for i in (1, 2, 3)
    ])  # plan = 3
    c1 = Chapter(project_id=p.id, seq=1, title="一", text="正文甲", word_count=word_count("正文甲"), sort=1)
    c2 = Chapter(project_id=p.id, seq=2, title="二", text="正文乙丙", word_count=word_count("正文乙丙"), sort=2)
    session.add_all([c1, c2])
    session.flush()
    a = Character(project_id=p.id, name="沈听澜")
    b = Character(project_id=p.id, name="北冥阁主")
    session.add_all([a, b])
    session.flush()
    session.add(Relation(project_id=p.id, src_kind="char", src_id=a.id,
                         dst_kind="char", dst_id=b.id, type="对抗"))
    session.add_all([
        Foreshadow(project_id=p.id, title="已收", state="已回收"),
        Foreshadow(project_id=p.id, title="悬空", state="悬空"),
        Foreshadow(project_id=p.id, title="在埋", state="已埋设"),
    ])
    session.add(WorldEntry(project_id=p.id, category="势力", name="听澜剑宗"))
    session.add(TimelineEvent(project_id=p.id, track="main", title="峰会"))
    session.add(ChatSession(project_id=p.id, title="会话"))
    return p.id


# ---------- A7：统计与查库逐项相等 ----------

def test_project_stats_matches_reality(uow_factory):
    with UnitOfWork(uow_factory) as uow:
        pid = _seed(uow.session)
    with UnitOfWork(uow_factory) as uow:
        s = project_stats(uow.session, pid)
    assert s == {
        "plan": 3, "written": 2, "words": 3 + 4,
        "chars": 2, "rels": 1,
        "fsp": 3, "fspDone": 1, "fspDangling": 1,
        "entries": 1, "events": 1, "sessions": 1,
        "gap": 1,
    }


def test_stats_soft_deleted_excluded(uow_factory):
    from datetime import datetime, timezone
    with UnitOfWork(uow_factory) as uow:
        pid = _seed(uow.session)
    with UnitOfWork(uow_factory) as uow:
        ch = uow.session.query(Chapter).filter_by(seq=2).one()
        ch.deleted_at = datetime.now(timezone.utc)
    with UnitOfWork(uow_factory) as uow:
        s = project_stats(uow.session, pid)
    assert s["written"] == 1 and s["words"] == 3


# ---------- A8 方向：事件 after-commit 派发 + 订阅者故障隔离 ----------

def test_events_dispatched_after_commit(uow_factory):
    bus = EventBus()
    seen: list[dict] = []
    dispatched_during_block: list[bool] = []

    def handler(payload):
        seen.append(payload)

    bus.subscribe(CHAPTER_ACCEPTED, handler)

    with UnitOfWork(uow_factory, bus=bus) as uow:
        uow.publish(CHAPTER_ACCEPTED, chapter_id=1, task_id=9)
        dispatched_during_block.append(len(seen) == 0)  # 事务内不得派发
    assert dispatched_during_block == [True]
    assert seen == [{"chapter_id": 1, "task_id": 9}]


def test_events_not_dispatched_on_rollback(uow_factory):
    bus = EventBus()
    seen = []
    bus.subscribe(CHAPTER_ACCEPTED, lambda p: seen.append(p))
    with pytest.raises(RuntimeError):
        with UnitOfWork(uow_factory, bus=bus) as uow:
            uow.publish(CHAPTER_ACCEPTED, chapter_id=1)
            raise RuntimeError("故意失败")
    assert seen == []


def test_subscriber_failure_isolated(uow_factory):
    bus = EventBus()
    good = []
    bus.subscribe(CHAPTER_ACCEPTED, lambda p: (_ for _ in ()).throw(ValueError("坏订阅者")))
    bus.subscribe(CHAPTER_ACCEPTED, lambda p: good.append(p))
    with UnitOfWork(uow_factory, bus=bus) as uow:
        uow.publish(CHAPTER_ACCEPTED, chapter_id=7)
    # 第一个订阅者抛错被隔离，第二个照常收到（A8：订阅方故障不拖累主流程）
    assert good == [{"chapter_id": 7}]
