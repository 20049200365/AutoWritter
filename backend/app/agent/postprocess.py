"""章节后处理（M8）：章节接受后把新章消化进全书数据资产。

事实类直写（摘要、出场、块×实体共现）；推断类只发建议消息（关系/伏笔/时间线/大纲偏差），
用户采纳才落库（M1 SessionRepo 采纳机制）。伏笔红线：本模块不变更 foreshadows 表。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select

from ..data.db import UnitOfWork
from ..data.models import (
    Chapter, Character, CharacterAppearance, ChatSession, Chunk, GenerationTask,
    OutlineNode, PostprocessJob,
)
from ..data.repos import SessionRepo
from ..search.service import SearchService  # noqa: F401 - 预留 M2 联动入口

log = logging.getLogger("m8.postprocess")

STEPS = ("summary", "entities", "relations", "foreshadows", "timeline", "outline_check")


class PostProcessor:
    def __init__(self, session_factory, provider) -> None:
        self.factory = session_factory
        self.provider = provider

    # ---------- 入口（CHAPTER_ACCEPTED 事件订阅）----------

    def run_for_chapter(self, chapter_id: int, task_id: int | None = None) -> dict:
        results = {}
        for step in STEPS:
            with UnitOfWork(self.factory) as uow:
                job = PostprocessJob(
                    project_id=self._project_of(uow, chapter_id),
                    chapter_id=chapter_id, task_id=task_id,
                    step=step, status="running")
                uow.session.add(job)
                uow.session.flush()
            try:
                with UnitOfWork(self.factory) as uow:
                    getattr(self, f"_step_{step}")(uow, chapter_id)
                    self._finish(uow, chapter_id, step, "done")
                results[step] = "done"
                log.info("后处理完成 chapter=%s step=%s", chapter_id, step)
            except Exception as e:  # noqa: BLE001 - 单步失败不连坐（F6）
                with UnitOfWork(self.factory) as uow:
                    self._finish(uow, chapter_id, step, "failed", error=str(e))
                results[step] = "failed"
                log.error("后处理失败 chapter=%s step=%s err=%s", chapter_id, step, e)
        return results

    # ---------- 各步 ----------

    def _step_summary(self, uow: UnitOfWork, chapter_id: int) -> None:
        ch = self._chapter(uow, chapter_id)
        text = self.provider.chat_sync("distiller", [
            {"role": "system", "content": "你是摘要员。输出不超过 200 字的章节摘要，须提到主角名。"},
            {"role": "user", "content": f"请总结本章：\n{ch.text}"},
        ])
        ch.summary = text.strip()[:200]
        uow.session.flush()

    def _step_entities(self, uow: UnitOfWork, chapter_id: int) -> None:
        ch = self._chapter(uow, chapter_id)
        raw = self.provider.chat_sync("distiller", [
            {"role": "system", "content":
                "你是实体抽取员。输出 JSON：{\"entities\":[{\"name\":\"\",\"type\":\"char|place|item\"}]}"},
            {"role": "user", "content": f"抽取实体：\n{ch.text}"},
        ])
        data = _parse_json(raw) or {"entities": []}
        names = {e["name"] for e in data.get("entities", []) if e.get("name")}

        # 出场记录：仅对已建档人物（新人物走建议，不自动建档）
        chars = list(uow.session.scalars(select(Character).where(
            Character.project_id == ch.project_id, Character.deleted_at.is_(None))))
        for c in chars:
            if c.name in names and uow.session.get(CharacterAppearance, (c.id, chapter_id)) is None:
                uow.session.add(CharacterAppearance(character_id=c.id, chapter_id=chapter_id))

        # 块×实体共现：实体名出现在哪些块
        chunks = list(uow.session.scalars(select(Chunk).where(
            Chunk.source_type == "chapter", Chunk.source_id == chapter_id)))
        chunk_ids = [x.id for x in chunks]
        if chunk_ids:
            from ..data.models import ChunkEntity
            from sqlalchemy import delete
            uow.session.execute(delete(ChunkEntity).where(ChunkEntity.chunk_id.in_(chunk_ids)))
            for name in names:
                etype = next((e["type"] for e in data["entities"]
                              if e.get("name") == name and e.get("type") in ("char", "place", "item")),
                             "item")
                for ck in chunks:
                    if name in (ck.text or ""):
                        uow.session.add(ChunkEntity(chunk_id=ck.id, entity_type=etype,
                                                    entity_name=name))
        uow.session.flush()

    def _step_relations(self, uow: UnitOfWork, chapter_id: int) -> None:
        suggestions = self._analyze(uow, chapter_id, "relations")
        for s in suggestions:
            self._add_suggestion(uow, chapter_id, {
                "type": "relation_change", "title": f"新关系提议：{s.get('label', '')}",
                "detail": s.get("detail", ""), "evidence": s.get("evidence", ""),
                "target": {k: s[k] for k in ("project_id", "src_kind", "src_id",
                                             "dst_kind", "dst_id", "type") if k in s},
            })

    def _step_foreshadows(self, uow: UnitOfWork, chapter_id: int) -> None:
        """伏笔只发提议，不碰 foreshadows 表（红线 F5）。"""
        ch = self._chapter(uow, chapter_id)
        data = self._analyze(uow, chapter_id, "foreshadows")
        for s in data:
            self._add_suggestion(uow, chapter_id, {
                "type": "foreshadow_plant" if s.get("kind") == "plant" else "foreshadow_resolve",
                "title": s.get("title", "伏笔提议"),
                "detail": s.get("detail", ""), "evidence": s.get("evidence", ""),
                "target": {"project_id": ch.project_id, **{k: v for k, v in s.items()
                                                            if k in ("title", "description",
                                                                     "foreshadow_id", "chapter_id")}},
            })

    def _step_timeline(self, uow: UnitOfWork, chapter_id: int) -> None:
        ch = self._chapter(uow, chapter_id)
        for s in self._analyze(uow, chapter_id, "timeline"):
            self._add_suggestion(uow, chapter_id, {
                "type": "timeline_event", "title": s.get("title", "时间线事件"),
                "detail": s.get("detail", ""), "evidence": s.get("evidence", ""),
                "target": {"project_id": ch.project_id, "title": s.get("title", ""),
                           "track": s.get("track", "main"),
                           "time_label": s.get("time_label"),
                           "description": s.get("detail"), "chapter_id": chapter_id},
            })

    def _step_outline_check(self, uow: UnitOfWork, chapter_id: int) -> None:
        ch = self._chapter(uow, chapter_id)
        if ch.outline_node_id is None:
            return
        node = uow.session.get(OutlineNode, ch.outline_node_id)
        beat = node.summary or node.title if node else ""
        raw = self.provider.chat_sync("distiller", [
            {"role": "system", "content":
                "你是大纲对账员。输出 JSON：{\"level\":\"对齐|轻度偏差|严重偏离\",\"points\":[\"\"]}"},
            {"role": "user", "content": f"大纲对账。\n节拍：{beat}\n正文：{ch.text}"},
        ])
        data = _parse_json(raw) or {"level": "对齐", "points": []}
        if data.get("level") in ("轻度偏差", "严重偏离"):
            self._add_suggestion(uow, chapter_id, {
                "type": "outline_check",
                "title": f"大纲对账：{data['level']}",
                "detail": "；".join(data.get("points", [])),
                "evidence": f"节拍：{beat}",
                "target": {},  # 提醒类建议，采纳为已读（无写入动作）
            })

    # ---------- 内部 ----------

    def _analyze(self, uow: UnitOfWork, chapter_id: int, kind: str) -> list:
        ch = self._chapter(uow, chapter_id)
        raw = self.provider.chat_sync("distiller", [
            {"role": "system", "content":
                f"你是分析员，任务类型：分析建议/{kind}。输出 JSON 数组，无提议则输出 []。"},
            {"role": "user", "content": f"分析（{kind}）：\n{ch.text}"},
        ])
        data = _parse_json(raw)
        return data if isinstance(data, list) else []

    def _add_suggestion(self, uow: UnitOfWork, chapter_id: int, payload: dict) -> None:
        ch = self._chapter(uow, chapter_id)
        session = self._ensure_suggestion_session(uow, ch.project_id)
        SessionRepo(uow).add_suggestion(session.id, payload)

    def _ensure_suggestion_session(self, uow: UnitOfWork, project_id: int) -> ChatSession:
        row = uow.session.scalar(select(ChatSession).where(
            ChatSession.project_id == project_id,
            ChatSession.title == "AI 提议",
            ChatSession.deleted_at.is_(None)))
        if row is not None:
            return row
        s = ChatSession(project_id=project_id, title="AI 提议")
        uow.session.add(s)
        uow.session.flush()
        return s

    def _chapter(self, uow: UnitOfWork, chapter_id: int) -> Chapter:
        ch = uow.session.get(Chapter, chapter_id)
        if ch is None:
            raise ValueError(f"chapter#{chapter_id} 不存在")
        return ch

    def _project_of(self, uow: UnitOfWork, chapter_id: int) -> int:
        return self._chapter(uow, chapter_id).project_id

    def _finish(self, uow: UnitOfWork, chapter_id: int, step: str,
                status: str, error: str | None = None) -> None:
        job = uow.session.scalar(select(PostprocessJob).where(
            PostprocessJob.chapter_id == chapter_id, PostprocessJob.step == step)
            .order_by(PostprocessJob.id.desc()))
        if job is not None:
            job.status = status
            job.error = error
            uow.session.flush()


def _parse_json(raw: str):
    try:
        start, end = raw.find("{"), raw.rfind("}")
        s, e = raw.find("["), raw.rfind("]")
        if s != -1 and (start == -1 or s < start):
            return json.loads(raw[s:e + 1])
        if start != -1:
            return json.loads(raw[start:end + 1])
        return None
    except ValueError:
        return None
