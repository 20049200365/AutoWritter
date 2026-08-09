"""偏好学习（M5）：事件 → 蒸馏 → 画像 → 注入（架构 §2.3、M5 SPEC）。

规则：手动修正优先（source=manual 时蒸馏不覆盖）；版本化+快照回滚；
同标签连续驳回 ≥3 次升级为硬约束；蒸馏经 distiller 角色（可注入 Fake）。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import func, select

from ..data.db import UnitOfWork
from ..data.models import PreferenceEvent, PreferenceProfile, Project
from ..data.repos import NotFound

log = logging.getLogger("m5.preference")

DISTILL_EVERY = 5
HARD_CONSTRAINT_STREAK = 3


class PreferenceService:
    def __init__(self, session_factory, provider=None) -> None:
        self.factory = session_factory
        self.provider = provider

    # ---------- 事件层 ----------

    def record_decision(self, project_id: int, action: str,
                        tags: list[str] | None = None, feedback: str | None = None,
                        task_id: int | None = None) -> None:
        with UnitOfWork(self.factory) as uow:
            uow.session.add(PreferenceEvent(project_id=project_id, task_id=task_id,
                                            action=action, tags=tags or [],
                                            feedback=feedback))
            uow.session.flush()
            self._ensure_profile(uow, project_id)
            count = uow.session.scalar(select(func.count(PreferenceEvent.id)).where(
                PreferenceEvent.project_id == project_id)) or 0
        log.info("偏好事件 project=%s action=%s tags=%s 累计=%d", project_id, action, tags, count)
        self._check_hard_constraint(project_id, tags or [])
        if count % DISTILL_EVERY == 0:
            self._distill(project_id)

    # ---------- 画像层 ----------

    def get_profile(self, project_id: int) -> dict:
        with UnitOfWork(self.factory) as uow:
            p = self._ensure_profile(uow, project_id)
            uow.session.flush()
            return self._to_dict(p)

    def list_events(self, project_id: int) -> list[dict]:
        with UnitOfWork(self.factory) as uow:
            rows = uow.session.scalars(select(PreferenceEvent).where(
                PreferenceEvent.project_id == project_id).order_by(PreferenceEvent.id))
            return [{"id": e.id, "action": e.action, "tags": e.tags,
                     "feedback": e.feedback, "created_at": e.created_at} for e in rows]

    def update_manual(self, project_id: int, patch: dict) -> dict:
        with UnitOfWork(self.factory) as uow:
            p = self._ensure_profile(uow, project_id)
            self._snapshot(p)
            for key in ("likes", "dislikes", "hard_constraints", "rubric_weights",
                        "style_sample_ids"):
                if key in patch:
                    setattr(p, key, patch[key])
            p.source = "manual"
            p.version += 1
            uow.session.flush()
            log.info("画像手动修正 project=%s version=%d", project_id, p.version)
            return self._to_dict(p)

    def rollback(self, project_id: int, version: int) -> dict:
        with UnitOfWork(self.factory) as uow:
            p = self._ensure_profile(uow, project_id)
            snap = next((s for s in (p.snapshots or []) if s.get("version") == version), None)
            if snap is None:
                raise NotFound(f"画像版本 {version} 不存在")
            for key in ("likes", "dislikes", "hard_constraints", "rubric_weights"):
                setattr(p, key, snap.get(key))
            p.version += 1
            p.source = snap.get("source", "auto")
            uow.session.flush()
            log.info("画像回滚 project=%s → v%d", project_id, version)
            return self._to_dict(p)

    def profile_text(self, project_id: int) -> str:
        """写手 prompt 的 P0 偏好段（M3 装配）。"""
        prof = self.get_profile(project_id)
        lines = []
        if prof["likes"]:
            lines.append("喜欢：" + "；".join(prof["likes"]))
        if prof["dislikes"]:
            lines.append("避免：" + "；".join(prof["dislikes"]))
        if prof["hard_constraints"]:
            lines.append("【硬约束】" + "；".join(prof["hard_constraints"]))
        return "\n".join(lines)

    # ---------- 蒸馏 ----------

    def _distill(self, project_id: int) -> None:
        if self.provider is None:
            log.warning("无 provider，跳过蒸馏 project=%s", project_id)
            return
        with UnitOfWork(self.factory) as uow:
            events = list(uow.session.scalars(select(PreferenceEvent).where(
                PreferenceEvent.project_id == project_id)
                .order_by(PreferenceEvent.id.desc()).limit(DISTILL_EVERY)))
            digest = "\n".join(
                f"- {e.action} tags={e.tags} feedback={e.feedback or ''}" for e in events)
        raw = self.provider.chat_sync("distiller", [
            {"role": "system", "content":
                "你是偏好蒸馏员。输出 JSON：{\"likes\":[],\"dislikes\":[],\"rubric_weights\":{}}"},
            {"role": "user", "content": f"蒸馏偏好。事件：\n{digest}"},
        ])
        try:
            data = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])
        except ValueError:
            log.warning("蒸馏输出不合 JSON，跳过 project=%s", project_id)
            return
        with UnitOfWork(self.factory) as uow:
            p = self._ensure_profile(uow, project_id)
            if p.source == "manual":          # 手动优先：蒸馏不覆盖（H3）
                log.info("画像为手动维护，蒸馏仅记录不覆盖 project=%s", project_id)
                uow.session.flush()
                return
            self._snapshot(p)
            for key in ("likes", "dislikes"):
                merged = list(dict.fromkeys((p.__dict__.get(key) or []) + (data.get(key) or [])))
                setattr(p, key, merged)
            if data.get("rubric_weights"):
                p.rubric_weights = {**p.rubric_weights, **data["rubric_weights"]}
            p.version += 1
            p.source = "auto"
            uow.session.flush()
        log.info("画像蒸馏完成 project=%s version=%d", project_id, p.version + 1)

    def _check_hard_constraint(self, project_id: int, tags: list[str]) -> None:
        """同标签连续驳回 ≥3 次 → 升级硬约束（M5 SPEC §3.1）。"""
        if not tags:
            return
        with UnitOfWork(self.factory) as uow:
            recent = list(uow.session.scalars(select(PreferenceEvent).where(
                PreferenceEvent.project_id == project_id,
                PreferenceEvent.action == "reject")
                .order_by(PreferenceEvent.id.desc()).limit(HARD_CONSTRAINT_STREAK)))
            if len(recent) < HARD_CONSTRAINT_STREAK:
                return
            for tag in tags:
                if all(tag in (e.tags or []) for e in recent):
                    p = self._ensure_profile(uow, project_id)
                    item = f"连续{HARD_CONSTRAINT_STREAK}次驳回「{tag}」，必须针对性处理"
                    if item not in (p.hard_constraints or []):
                        self._snapshot(p)
                        p.hard_constraints = (p.hard_constraints or []) + [item]
                        p.version += 1
                        log.info("硬约束升级 project=%s tag=%s", project_id, tag)
            uow.session.flush()

    # ---------- 内部 ----------

    def _ensure_profile(self, uow: UnitOfWork, project_id: int) -> PreferenceProfile:
        if uow.session.get(Project, project_id) is None:
            raise NotFound(f"projects#{project_id} 不存在")
        p = uow.session.get(PreferenceProfile, project_id)
        if p is None:
            p = PreferenceProfile(project_id=project_id, likes=[], dislikes=[],
                                  hard_constraints=[], style_sample_ids=[],
                                  rubric_weights={}, snapshots=[], source="auto")
            uow.session.add(p)
            uow.session.flush()
        return p

    @staticmethod
    def _snapshot(p: PreferenceProfile) -> None:
        p.snapshots = (p.snapshots or []) + [{
            "version": p.version, "likes": p.likes, "dislikes": p.dislikes,
            "hard_constraints": p.hard_constraints, "rubric_weights": p.rubric_weights,
            "source": p.source}]

    @staticmethod
    def _to_dict(p: PreferenceProfile) -> dict:
        return {"project_id": p.project_id, "version": p.version, "likes": p.likes,
                "dislikes": p.dislikes, "hard_constraints": p.hard_constraints,
                "style_sample_ids": p.style_sample_ids, "rubric_weights": p.rubric_weights,
                "source": p.source, "snapshots": p.snapshots or []}
