"""SearchService：实体路 + 关键词路 + RRF 融合 + LLM 查询改写兜底（M2 SPEC §4/§5）。

契约（冻结，满足 M3 §6.2）：
    search(query, source_types, project_id, k=10, chapter_range=None) -> list[HitDTO]
    entities_of(chapter_id) -> list[str]
    index_source(source_type, source_id) / rebuild(project_id)
依赖倒置：rewriter 由 M3/M6 注入；不注入则跳过改写（纯实体+FTS 也能工作）。
"""
from __future__ import annotations

import logging
from collections.abc import Callable

from sqlalchemy import delete, func, select, text

from ..data.db import UnitOfWork
from ..data.models import Character, Chapter, Chunk, ChunkEntity, OutlineNode, WorldEntry
from .chunker import chunk_text, register_user_words, tokenize_for_fts

log = logging.getLogger("m2.search")

RRF_K = 60
FTS_CANDIDATE_N = 30
ENTITY_BONUS = 0.5  # 实体命中加权（融合排序时，架构 §5.5）

FTS_DDL = ("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts "
           "USING fts5(words)")


def ensure_fts_table(engine) -> None:
    """chunks_fts 为 FTS5 虚拟表（Alembic 自动生成不覆盖），启动时确保存在。"""
    with engine.begin() as conn:
        conn.execute(text(FTS_DDL))


class SearchService:
    def __init__(self, uow: UnitOfWork,
                 rewriter: Callable[[str], list[str]] | None = None) -> None:
        self.uow = uow
        self.s = uow.session
        assert self.s is not None
        self.rewriter = rewriter

    # ================= 索引维护 =================

    def index_source(self, source_type: str, source_id: int) -> int:
        """单源重建索引（先删旧块再写新块），返回块数。"""
        old_ids = list(self.s.scalars(select(Chunk.id).where(
            Chunk.source_type == source_type, Chunk.source_id == source_id)))
        if old_ids:
            self.s.execute(delete(ChunkEntity).where(ChunkEntity.chunk_id.in_(old_ids)))
            for oid in old_ids:  # FTS 行以 chunk id 为 rowid
                self.s.execute(text("DELETE FROM chunks_fts WHERE rowid=:rid"), {"rid": oid})
            self.s.execute(delete(Chunk).where(Chunk.id.in_(old_ids)))
            self.s.flush()

        text_ = self._source_text(source_type, source_id)
        if text_ is None:
            return 0
        project_id = self._source_project(source_type, source_id)
        blocks = chunk_text(text_) if source_type == "chapter" else [text_]
        for ord_, block in enumerate(blocks):
            chunk = Chunk(project_id=project_id, source_type=source_type,
                          source_id=source_id, ord=ord_, text=block,
                          tokens=len(block))
            self.s.add(chunk)
            self.s.flush()
            self.s.execute(text("INSERT INTO chunks_fts(rowid, words) VALUES (:rid, :w)"),
                           {"rid": chunk.id, "w": tokenize_for_fts(block)})
        self.s.flush()
        log.debug("索引更新 source=%s:%s 块数=%d project=%s", source_type, source_id, len(blocks), project_id)
        return len(blocks)

    def remove_source(self, source_type: str, source_id: int) -> None:
        old_ids = list(self.s.scalars(select(Chunk.id).where(
            Chunk.source_type == source_type, Chunk.source_id == source_id)))
        if not old_ids:
            return
        self.s.execute(delete(ChunkEntity).where(ChunkEntity.chunk_id.in_(old_ids)))
        for oid in old_ids:
            self.s.execute(text("DELETE FROM chunks_fts WHERE rowid=:rid"), {"rid": oid})
        self.s.execute(delete(Chunk).where(Chunk.id.in_(old_ids)))
        self.s.flush()
        log.debug("索引删除 source=%s:%s", source_type, source_id)

    def rebuild(self, project_id: int) -> dict:
        """全量重建（M2 SPEC §3.4）：幂等，可重复执行。"""
        self.s.execute(delete(ChunkEntity).where(ChunkEntity.chunk_id.in_(
            select(Chunk.id).where(Chunk.project_id == project_id))))
        chunk_ids = list(self.s.scalars(select(Chunk.id).where(Chunk.project_id == project_id)))
        for cid in chunk_ids:
            self.s.execute(text("DELETE FROM chunks_fts WHERE rowid=:rid"), {"rid": cid})
        self.s.execute(delete(Chunk).where(Chunk.project_id == project_id))
        self.s.flush()

        self.refresh_user_words(project_id)
        count = 0
        for cid in self._ids(Chapter, project_id):
            count += self.index_source("chapter", cid)
        for eid in self._ids(WorldEntry, project_id):
            count += self.index_source("world", eid)
        for nid in self._ids(OutlineNode, project_id):
            count += self.index_source("outline", nid)
        for pid in self._ids(Character, project_id):
            count += self.index_source("char", pid)
        log.info("索引重建完成 project=%s 块数=%d", project_id, count)
        return {"project_id": project_id, "chunks": count}

    def refresh_user_words(self, project_id: int) -> None:
        names: list[str] = []
        for c in self.s.scalars(select(Character).where(
                Character.project_id == project_id, Character.deleted_at.is_(None))):
            names.append(c.name)
            names.extend(c.aliases or [])
        for w in self.s.scalars(select(WorldEntry).where(
                WorldEntry.project_id == project_id, WorldEntry.deleted_at.is_(None))):
            names.append(w.name)
        register_user_words(names)

    def refresh_user_words_from_chapter(self, chapter_id: int) -> None:
        pid = self.s.scalar(select(Chapter.project_id).where(Chapter.id == chapter_id))
        if pid is not None:
            self.refresh_user_words(pid)

    def refresh_user_words_from_entry(self, entry_id: int) -> None:
        pid = self.s.scalar(select(WorldEntry.project_id).where(WorldEntry.id == entry_id))
        if pid is not None:
            self.refresh_user_words(pid)

    def refresh_user_words_from_character(self, character_id: int) -> None:
        pid = self.s.scalar(select(Character.project_id).where(Character.id == character_id))
        if pid is not None:
            self.refresh_user_words(pid)

    # ================= 检索 =================

    def search(self, query: str, source_types: list[str], project_id: int,
               k: int = 10, chapter_range: tuple[int, int] | None = None) -> list[dict]:
        hits = self._search_once(query, source_types, project_id, k * 3, chapter_range)
        # 改写兜底：无实体命中且关键词路疲软 → LLM 改写重查（最多 1 次，C4）
        need_rewrite = (self.rewriter is not None
                        and not any(h["matched_by"] == "entity" for h in hits)
                        and (not hits or hits[0]["score"] < 0.02))
        if need_rewrite:
            rewrites = (self.rewriter(query) or [])[:3]
            log.info("查询改写触发 project=%s query=%r → %s", project_id, query, rewrites)
            merged = {self._key(h): h for h in hits}
            for rq in rewrites:
                for h in self._search_once(rq, source_types, project_id, k * 2, chapter_range):
                    key = self._key(h)
                    if key in merged:
                        merged[key]["score"] += h["score"]
                    else:
                        h["matched_by"] = "rewrite"
                        merged[key] = h
            hits = sorted(merged.values(), key=lambda h: -h["score"])
        log.info("检索 project=%s query=%r types=%s 命中=%d", project_id, query, source_types, len(hits[:k]))
        return hits[:k]

    def entities_of(self, chapter_id: int) -> list[str]:
        rows = self.s.execute(
            select(ChunkEntity.entity_name).distinct()
            .where(ChunkEntity.chunk_id.in_(
                select(Chunk.id).where(Chunk.source_type == "chapter",
                                       Chunk.source_id == chapter_id))))
        return [r[0] for r in rows]

    def set_chunk_entities(self, source_type: str, source_id: int,
                           entities: list[dict]) -> None:
        """块×实体共现写入入口（M8 实体抽取后调用；架构 §5.4 第 4 步）。

        entities: [{"entity_type": char|place|item, "entity_name": ..., "ord": 块序号}]
        """
        chunk_ids = {c.ord: c.id for c in self.s.scalars(select(Chunk).where(
            Chunk.source_type == source_type, Chunk.source_id == source_id))}
        self.s.execute(delete(ChunkEntity).where(ChunkEntity.chunk_id.in_(chunk_ids.values())))
        for ent in entities:
            cid = chunk_ids.get(ent.get("ord", 0))
            if cid is None:
                continue
            self.s.add(ChunkEntity(chunk_id=cid, entity_type=ent["entity_type"],
                                   entity_name=ent["entity_name"]))
        self.s.flush()
        log.debug("实体共现更新 source=%s:%s 条数=%d", source_type, source_id, len(entities))

    # ================= 内部 =================

    @staticmethod
    def _key(h: dict) -> tuple:
        return (h["source_type"], h["source_id"], h["ord"])

    def _search_once(self, query, source_types, project_id, k, chapter_range) -> list[dict]:
        entity_names = self._extract_entities(query, project_id)
        entity_chunk_ids = set()
        if entity_names:
            rows = self.s.execute(
                select(ChunkEntity.chunk_id, func.count())
                .where(ChunkEntity.entity_name.in_(entity_names))
                .group_by(ChunkEntity.chunk_id))
            entity_chunk_ids = {cid for cid, _ in rows}

        fts_ranked = self._fts_search(query, source_types, project_id, chapter_range)

        # RRF 融合：两路名次 → 1/(k+rank)；实体命中额外加权（架构 §5.5）
        entity_rank = {cid: i for i, cid in enumerate(sorted(entity_chunk_ids))}
        scores: dict[int, float] = {}
        matched: dict[int, str] = {}
        for cid in entity_chunk_ids:
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + entity_rank[cid]) + ENTITY_BONUS
            matched[cid] = "entity"
        for rank, (cid, _bm25) in enumerate(fts_ranked):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank)
            matched.setdefault(cid, "fts")

        ordered = sorted(scores.items(), key=lambda kv: -kv[1])[:k]
        hits = []
        for cid, score in ordered:
            chunk = self.s.get(Chunk, cid)
            if chunk is None or chunk.source_type not in source_types:
                continue
            if chapter_range and chunk.source_type == "chapter":
                seq = self.s.scalar(select(Chapter.seq).where(Chapter.id == chunk.source_id))
                if seq is None or not (chapter_range[0] <= seq <= chapter_range[1]):
                    continue
            hits.append({"source_type": chunk.source_type, "source_id": chunk.source_id,
                         "ord": chunk.ord, "text": chunk.text, "score": round(score, 6),
                         "matched_by": matched[cid]})
        return hits

    def _fts_search(self, query, source_types, project_id, chapter_range) -> list[tuple[int, float]]:
        tokenized = tokenize_for_fts(query).strip()
        if not tokenized:
            return []
        match_expr = " OR ".join(f'"{t}"' for t in tokenized.split() if t)
        rows = self.s.execute(text(
            "SELECT f.rowid AS cid, bm25(chunks_fts) AS r "
            "FROM chunks_fts f JOIN chunks c ON c.id = f.rowid "
            "WHERE chunks_fts MATCH :q AND c.project_id = :pid "
            "ORDER BY r LIMIT :n"),
            {"q": match_expr, "pid": project_id, "n": FTS_CANDIDATE_N})
        return [(int(r[0]), float(r[1])) for r in rows]

    def _extract_entities(self, query: str, project_id: int) -> list[str]:
        """专名提取：query 与人物名/别名/词条名做子串匹配（M2 §4 第 1 步）。"""
        names: list[str] = []
        for c in self.s.scalars(select(Character).where(
                Character.project_id == project_id, Character.deleted_at.is_(None))):
            names.append(c.name)
            names.extend(c.aliases or [])
        for w in self.s.scalars(select(WorldEntry.name).where(
                WorldEntry.project_id == project_id, WorldEntry.deleted_at.is_(None))):
            names.append(w)
        return [n for n in dict.fromkeys(names) if n and n in query]

    # ---- 源文本/项目/ID 辅助 ----

    def _ids(self, model, project_id: int) -> list[int]:
        col_deleted = getattr(model, "deleted_at", None)
        q = select(model.id).where(model.project_id == project_id)
        if col_deleted is not None:
            q = q.where(col_deleted.is_(None))
        return list(self.s.scalars(q))

    def _source_project(self, source_type: str, source_id: int) -> int:
        model = {"chapter": Chapter, "world": WorldEntry,
                 "outline": OutlineNode, "char": Character}[source_type]
        pid = self.s.scalar(select(model.project_id).where(model.id == source_id))
        if pid is None:
            from ..data.repos import NotFound
            raise NotFound(f"{source_type}#{source_id} 不存在")
        return pid

    def _source_text(self, source_type: str, source_id: int) -> str | None:
        if source_type == "chapter":
            return self.s.scalar(select(Chapter.text).where(Chapter.id == source_id)) or None
        if source_type == "world":
            w = self.s.get(WorldEntry, source_id)
            return f"{w.name}：{w.content}" if w and w.content else (w.name if w else None)
        if source_type == "outline":
            n = self.s.get(OutlineNode, source_id)
            return f"{n.title}：{n.summary}" if n and n.summary else (n.title if n else None)
        if source_type == "char":
            c = self.s.get(Character, source_id)
            if c is None:
                return None
            parts = [f"人物：{c.name}", c.role, c.appearance, c.surface_goal, c.secret]
            return "；".join(p for p in parts if p)
        return None
