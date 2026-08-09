"""M1 Repository 层验收：A1（CRUD）/ A2（撤销）/ A4（大纲+章号）/ A5（版本）/ A6（伏笔）/ A13（实体图）。"""
from __future__ import annotations

import time

import pytest

from app.data.db import UnitOfWork, make_engine, make_session_factory
from app.data.models import Base, Character, WorldEntry
from app.data.repos import (
    ChapterRepo, ForeshadowRepo, NotFound, OutlineRepo, ProjectRepo,
    RelationRepo, StateConflict,
)
from app.data.schemas import (
    ChapterCreate, ForeshadowCreate, OutlineCreate, ProjectCreate, RelationCreate,
)


@pytest.fixture()
def factory(tmp_path):
    engine = make_engine(tmp_path / "test.db")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _mk_project(uow, title="测试") -> int:
    return ProjectRepo(uow).create(ProjectCreate(title=title, genre="玄幻")).id


# ---------- A1/A2：CRUD + 软删除撤销回原位 ----------

def test_project_crud_and_soft_delete(factory):
    with UnitOfWork(factory) as uow:
        repo = ProjectRepo(uow)
        ids = [_mk_project(uow, f"书{i}") for i in range(3)]
        assert [p.title for p in repo.list()] == ["书0", "书1", "书2"]

        repo.delete(ids[1])                      # 软删中间那本
        assert [p.title for p in repo.list()] == ["书0", "书2"]
        repo.restore(ids[1])                     # 5 秒内撤销
        assert [p.title for p in repo.list()] == ["书0", "书1", "书2"]  # 原位恢复


def test_purge_expired(factory):
    with UnitOfWork(factory) as uow:
        repo = ProjectRepo(uow)
        pid = _mk_project(uow)
        repo.delete(pid)
    time.sleep(0.05)
    with UnitOfWork(factory) as uow:
        repo = ProjectRepo(uow)
        assert repo.purge_expired(seconds=0.01) == 1   # 过期物理清理
        assert repo.get(pid, ) is None
        assert len(repo.list(include_deleted=True)) == 0


# ---------- A4：大纲树三级上限 + 重排 + 级联删除 ----------

def test_outline_level_limit(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        repo = OutlineRepo(uow)
        vol = repo.create(OutlineCreate(project_id=pid, title="卷一"))
        sec = repo.create(OutlineCreate(project_id=pid, parent_id=vol.id, title="篇章一"))
        repo.create(OutlineCreate(project_id=pid, parent_id=sec.id, title="节拍一"))
        leaf = repo.subtree(pid)[-1]
        with pytest.raises(StateConflict):          # 第 4 级被拒
            repo.create(OutlineCreate(project_id=pid, parent_id=leaf.id, title="非法"))


def test_outline_insert_reorders_siblings(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        repo = OutlineRepo(uow)
        a = repo.create(OutlineCreate(project_id=pid, title="A"))
        b = repo.create(OutlineCreate(project_id=pid, title="B"))
        c = repo.create(OutlineCreate(project_id=pid, title="C"))
        repo.move(c.id, None, 1)                     # C 插到最前
        assert [n.title for n in repo.subtree(pid)] == ["C", "A", "B"]
        assert [n.sort for n in repo.subtree(pid)] == [1, 2, 3]


def test_outline_cascade_delete(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        repo = OutlineRepo(uow)
        vol = repo.create(OutlineCreate(project_id=pid, title="卷一"))
        sec = repo.create(OutlineCreate(project_id=pid, parent_id=vol.id, title="篇章"))
        repo.create(OutlineCreate(project_id=pid, parent_id=sec.id, title="节拍"))
        repo.delete(vol.id)
        assert repo.subtree(pid) == []               # 子树全灭


# ---------- A4：章节中间插入重编章号 ----------

def test_chapter_insert_renumbers(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        repo = ChapterRepo(uow)
        for i in range(1, 5):
            repo.create(ChapterCreate(project_id=pid, title=f"第{i}章"))
        repo.create(ChapterCreate(project_id=pid, title="插入章", seq=3))
        seqs = [c.seq for c in sorted(repo.list(pid), key=lambda c: c.seq)]
        titles = [c.title for c in sorted(repo.list(pid), key=lambda c: c.seq)]
        assert seqs == [1, 2, 3, 4, 5]
        assert titles[2] == "插入章" and titles[3] == "第3章"  # 后续顺延


def test_chapter_seq_gap_rejected(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        repo = ChapterRepo(uow)
        repo.create(ChapterCreate(project_id=pid, title="第1章"))
        with pytest.raises(StateConflict):
            repo.create(ChapterCreate(project_id=pid, title="跳号", seq=5))


# ---------- A5：版本留档连续 + 历史可读 ----------

def test_commit_draft_versions(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        ch = ChapterRepo(uow).create(ChapterCreate(project_id=pid, title="一"))
        repo = ChapterRepo(uow)
        v1 = repo.commit_draft(ch.id, "第一版正文", source="ai")
        v2 = repo.commit_draft(ch.id, "第二版正文改写", source="human")
        v3 = repo.commit_draft(ch.id, "第三版定稿文本", source="mixed")
        assert (v1, v2, v3) == (1, 2, 3)
        assert repo.version_text(ch.id, 1) == "第一版正文"
        assert repo.get(ch.id).word_count == 7       # 第三版定稿文本 = 7 个汉字
        assert repo.get(ch.id).status == "草稿"


def test_accept_sets_final_and_requires_text(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        repo = ChapterRepo(uow)
        ch = repo.create(ChapterCreate(project_id=pid, title="空章"))
        with pytest.raises(StateConflict):
            repo.accept(ch.id)                       # 空正文不得定稿
        repo.commit_draft(ch.id, "正文内容")
        dto = repo.accept(ch.id, task_id=99)
        assert dto.status == "定稿"


# ---------- A6：伏笔四态流转 ----------

def test_foreshadow_state_machine(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        ch = ChapterRepo(uow).create(ChapterCreate(project_id=pid, title="一"))
        repo = ForeshadowRepo(uow)

        dangling = repo.create(ForeshadowCreate(project_id=pid, title="无回收计划"))
        assert dangling.state == "悬空"              # 无 planned → 悬空

        planted = repo.create(ForeshadowCreate(
            project_id=pid, title="剑灵", planned_resolve_chapter_id=ch.id))
        assert planted.state != "悬空"

        resolved = repo.resolve(planted.id, ch.id)
        assert resolved.state == "已回收" and resolved.actual_resolve_chapter_id == ch.id

        unresolved = repo.unresolve(planted.id)
        assert unresolved.state == "已埋设" and unresolved.actual_resolve_chapter_id is None

        assert repo.unresolve(dangling.id).state == "悬空"


# ---------- A13：实体图端点校验 + 子图 ----------

def test_relation_endpoint_validation(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        uow.session.add(Character(project_id=pid, name="沈听澜"))
        uow.session.add(WorldEntry(project_id=pid, category="势力", name="听澜剑宗"))
        uow.session.flush()
        repo = RelationRepo(uow)
        ok = repo.create(RelationCreate(
            project_id=pid, src_kind="char", src_id=1,
            dst_kind="world", dst_id=1, type="隶属"))
        assert ok.type == "隶属"
        with pytest.raises(NotFound):                # 不存在的端点被拒
            repo.create(RelationCreate(
                project_id=pid, src_kind="char", src_id=999,
                dst_kind="world", dst_id=1, type="敌对"))


def test_relation_neighbors(factory):
    with UnitOfWork(factory) as uow:
        pid = _mk_project(uow)
        s = uow.session
        s.add_all([Character(project_id=pid, name="甲"),
                   Character(project_id=pid, name="乙"),
                   Character(project_id=pid, name="丙")])
        s.flush()
        repo = RelationRepo(uow)
        repo.create(RelationCreate(project_id=pid, src_kind="char", src_id=1,
                                   dst_kind="char", dst_id=2, type="师徒"))
        repo.create(RelationCreate(project_id=pid, src_kind="char", src_id=2,
                                   dst_kind="char", dst_id=3, type="对抗"))
        g1 = repo.neighbors("char", 1, depth=1)
        assert len(g1["edges"]) == 1 and len(g1["nodes"]) == 2
        g2 = repo.neighbors("char", 1, depth=2)
        assert len(g2["edges"]) == 2 and len(g2["nodes"]) == 3  # 两跳拿到丙
