"""字数与统计聚合（M1 SPEC §5.16 / 验收 A3 / A7）。

字数口径对齐 Demo wordCount()：CJK 字符逐字计 + 连续拉丁词按词计。
统计全部实时聚合，禁止缓存双写（A7）。
"""
from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (
    Chapter,
    Character,
    ChatSession,
    Foreshadow,
    OutlineNode,
    Relation,
    TimelineEvent,
    WorldEntry,
)

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
LATIN_RE = re.compile(r"[A-Za-z0-9]+")


def word_count(text: str | None) -> int:
    """与 Demo wordCount() 逐例一致（A3）。"""
    if not text:
        return 0
    return len(CJK_RE.findall(text)) + len(LATIN_RE.findall(text))


def project_stats(session: Session, project_id: int) -> dict:
    """对齐 Demo projStats 的 11 个字段（A7：与查库结果逐项相等）。"""
    pid = project_id

    plan = session.scalar(
        select(func.count(OutlineNode.id)).where(
            OutlineNode.project_id == pid, OutlineNode.level == 3
        )
    ) or 0

    live_chapters = select(Chapter).where(
        Chapter.project_id == pid, Chapter.deleted_at.is_(None)
    )
    written = session.scalar(select(func.count()).select_from(live_chapters.subquery())) or 0
    words = session.scalar(select(func.sum(Chapter.word_count)).where(
        Chapter.project_id == pid, Chapter.deleted_at.is_(None)
    )) or 0

    chars = session.scalar(select(func.count(Character.id)).where(
        Character.project_id == pid, Character.deleted_at.is_(None)
    )) or 0
    rels = session.scalar(select(func.count(Relation.id)).where(
        Relation.project_id == pid
    )) or 0

    fsp_q = select(Foreshadow).where(
        Foreshadow.project_id == pid, Foreshadow.deleted_at.is_(None)
    )
    fsp = session.scalar(select(func.count()).select_from(fsp_q.subquery())) or 0
    fsp_done = session.scalar(select(func.count()).select_from(
        fsp_q.where(Foreshadow.state == "已回收").subquery())) or 0
    fsp_dangling = session.scalar(select(func.count()).select_from(
        fsp_q.where(Foreshadow.state == "悬空").subquery())) or 0

    entries = session.scalar(select(func.count(WorldEntry.id)).where(
        WorldEntry.project_id == pid, WorldEntry.deleted_at.is_(None)
    )) or 0
    events = session.scalar(select(func.count(TimelineEvent.id)).where(
        TimelineEvent.project_id == pid, TimelineEvent.deleted_at.is_(None)
    )) or 0
    sessions = session.scalar(select(func.count(ChatSession.id)).where(
        ChatSession.project_id == pid, ChatSession.deleted_at.is_(None)
    )) or 0

    return {
        "plan": plan,
        "written": written,
        "words": words,
        "chars": chars,
        "rels": rels,
        "fsp": fsp,
        "fspDone": fsp_done,
        "fspDangling": fsp_dangling,
        "entries": entries,
        "events": events,
        "sessions": sessions,
        "gap": max(0, plan - written),
    }
