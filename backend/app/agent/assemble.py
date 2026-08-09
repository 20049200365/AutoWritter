"""上下文装配器（M3 SPEC §2.4/§2.5：贪心预算法，P0~P4 分层）。

预算是软上限（架构 §5.3）：必装层（P0/P1/P2 前 K 章）不压缩；
选装层超预算时从 P4 向 P3 倒序减量；账本逐条记录（context_snapshot）。
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from ..data.models import Chapter, Character, Foreshadow, OutlineNode, Relation
from ..data.stats import word_count

log = logging.getLogger("m3.assemble")

K_DEFAULT = 3


def _est_tokens(text: str) -> int:
    return word_count(text or "")


class Assembler:
    def __init__(self, session, search_service, skill_text: str = "",
                 preference_text: str = "") -> None:
        self.s = session
        self.search = search_service
        self.skill_text = skill_text          # M4 render('draft') 的产物
        self.preference_text = preference_text  # M5 画像段

    # ---------- 章节生成装配（P0~P4）----------

    def assemble_for_chapter(self, project_id: int, chapter_id: int,
                             budget: int, prior_full_k: int = K_DEFAULT) -> dict:
        ledger: list[dict] = []
        sections: dict[str, str] = {}

        def add(layer: str, name: str, text: str, compressible: bool):
            if not text:
                return
            tokens = _est_tokens(text)
            ledger.append({"layer": layer, "name": name, "tokens": tokens,
                           "status": "装入", "compressible": compressible})
            sections[name] = text

        ch = self.s.get(Chapter, chapter_id)
        if ch is None:
            raise ValueError(f"chapter#{chapter_id} 不存在")

        # ---- P0：偏好 + Skill（必装）----
        add("P0", "用户偏好", self.preference_text, False)
        add("P0", "Skill注入", self.skill_text, False)
        p0_skill_names = [self.skill_text.split("【Skill：")[1].split("】")[0]] \
            if "【Skill：" in self.skill_text else []

        # ---- P1：本章定位 + 衔接锚点 + 更早章摘要（必装）----
        add("P1", "本章定位", self._outline_path(ch), False)
        prev = self._prev_chapters(project_id, ch.seq, 1)
        if prev:
            add("P1", "前章结尾", prev[0].text[-1500:], False)
        summaries = self._summaries_beyond_k(project_id, ch.seq, prior_full_k)
        if summaries:
            add("P1", "更早章摘要", summaries, False)

        # ---- P2：前 K 章全文（必装不裁剪）+ 伏笔 + 人物 + 关系子图 ----
        full_texts = "\n\n".join(
            f"【第{c.seq}章 {c.title}】\n{c.text}"
            for c in self._prev_chapters(project_id, ch.seq, prior_full_k) if c.text)
        add("P2", "前K章全文", full_texts, False)
        add("P2", "活跃伏笔", self._foreshadows(project_id, ch.seq), False)
        involved = self._involved_characters(project_id, ch)
        if involved:
            add("P2", "人物与关系", involved, False)

        # ---- P3/P4：选装层（检索，可压缩）----
        query = self._chapter_query(project_id, ch)
        world_hits = self.search.search(query, ["world"], project_id, k=8) if query else []
        add("P3", "相关世界观", "\n".join(h["text"] for h in world_hits), True)

        earlier_hits = (self.search.search(
            query, ["chapter"], project_id, k=10,
            chapter_range=(1, max(1, ch.seq - prior_full_k - 1))) if query else [])
        add("P4", "更早相关原文", "\n".join(h["text"] for h in earlier_hits), True)

        # ---- 超限压缩：P4 → P3（P0~P2 不动，架构 §5.3）----
        total = sum(item["tokens"] for item in ledger)
        compressed = []
        if total > budget:
            for layer in ("P4", "P3"):
                if total <= budget:
                    break
                for item in ledger:
                    if item["layer"] == layer and item["status"] == "装入":
                        item["status"] = "压缩丢弃"
                        sections.pop(item["name"], None)
                        total -= item["tokens"]
                        compressed.append(item["name"])
        if total > budget:
            log.warning("必装层已超预算 project=%s total=%d budget=%d（提示调小 K）",
                        project_id, total, budget)

        log.info("装配完成 project=%s chapter=%s 材料=%d 压缩=%s tokens=%d/%d",
                 project_id, chapter_id, len(ledger), compressed, total, budget)
        return {
            "sections": sections,
            "ledger": [{k: v for k, v in item.items() if k != "compressible"}
                       for item in ledger],
            "total_tokens": total,
            "skills_injected": p0_skill_names,
            "involved_entities": self._involved_names(project_id, ch),
        }

    # ---------- 素材提取 ----------

    def _outline_path(self, ch: Chapter) -> str:
        if ch.outline_node_id is None:
            return f"章节：{ch.title}（未挂载大纲）"
        node = self.s.get(OutlineNode, ch.outline_node_id)
        parts = []
        while node is not None:
            parts.append(f"{node.title}：{node.summary or ''}".rstrip("："))
            node = self.s.get(OutlineNode, node.parent_id) if node.parent_id else None
        parts.reverse()
        return " → ".join(p for p in parts if p)

    def _prev_chapters(self, project_id: int, seq: int, k: int) -> list:
        if k <= 0:
            return []
        rows = self.s.scalars(
            select(Chapter).where(Chapter.project_id == project_id,
                                  Chapter.deleted_at.is_(None),
                                  Chapter.seq < seq)
            .order_by(Chapter.seq.desc()).limit(k))
        return list(reversed(list(rows)))

    def _summaries_beyond_k(self, project_id: int, seq: int, k: int) -> str:
        rows = self.s.scalars(
            select(Chapter).where(Chapter.project_id == project_id,
                                  Chapter.deleted_at.is_(None),
                                  Chapter.seq < seq - k,
                                  Chapter.summary.is_not(None))
            .order_by(Chapter.seq))
        lines = [f"CH.{c.seq:02d}《{c.title}》：{c.summary}" for c in rows]
        return "\n".join(lines)

    def _foreshadows(self, project_id: int, seq: int) -> str:
        rows = self.s.scalars(select(Foreshadow).where(
            Foreshadow.project_id == project_id,
            Foreshadow.deleted_at.is_(None),
            Foreshadow.state != "已回收"))
        lines = []
        for f in rows:
            mark = "【用户指定本章回收】" if f.planned_resolve_chapter_id == seq else ""
            lines.append(f"- 《{f.title}》[{f.state}]{mark} {f.description or ''}")
        return "\n".join(lines)

    def _involved_characters(self, project_id: int, ch: Chapter) -> str:
        names = self._involved_names(project_id, ch)
        if not names:
            return ""
        chars = list(self.s.scalars(select(Character).where(
            Character.project_id == project_id,
            Character.deleted_at.is_(None))))
        lines = []
        for c in chars:
            if c.name in names or any(a in names for a in (c.aliases or [])):
                rels = self.s.scalars(select(Relation).where(
                    (Relation.project_id == project_id) &
                    ((Relation.src_kind == "char") & (Relation.src_id == c.id))))
                rel_str = "；".join(f"{r.type}" for r in rels)
                lines.append(f"- {c.name}（{c.role or '角色'}）想要：{c.surface_goal or '?'}；"
                             f"秘密：{c.secret or '无'}；关系：{rel_str or '无'}")
        return "\n".join(lines)

    def _involved_names(self, project_id: int, ch: Chapter) -> list[str]:
        """以大纲节拍/章题做子串匹配识别本章涉及实体（M3 装配 P2）。"""
        beat = self._outline_path(ch) if ch.outline_node_id else ch.title
        names = []
        for c in self.s.scalars(select(Character).where(
                Character.project_id == project_id, Character.deleted_at.is_(None))):
            if c.name in beat or any(a and a in beat for a in (c.aliases or [])):
                names.append(c.name)
        from ..data.models import WorldEntry
        for w in self.s.scalars(select(WorldEntry).where(
                WorldEntry.project_id == project_id, WorldEntry.deleted_at.is_(None))):
            if w.name in beat:
                names.append(w.name)
        return names

    def _chapter_query(self, project_id: int, ch: Chapter) -> str:
        names = self._involved_names(project_id, ch)
        beat = self._outline_path(ch) if ch.outline_node_id else ch.title
        return " ".join(names + [beat])
