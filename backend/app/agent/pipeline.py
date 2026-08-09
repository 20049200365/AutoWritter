"""单章生成流水线（M3 SPEC §3：两阶段生成，编排层为确定性流水线）。

状态机（对齐 M1 generation_tasks.status）：
装配中 → 细纲生成中 → 细纲确认中 → 扩写生成中 → 评审中 → 待决策 → 已接受/已驳回
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from ..data.db import UnitOfWork
from ..data.models import Chapter, GenerationTask
from ..data.repos import ChapterRepo, NotFound, StateConflict
from ..search.service import SearchService
from .assemble import Assembler, K_DEFAULT
from .provider import collect

log = logging.getLogger("m3.pipeline")

REVIEW_DIMENSIONS = ("情节连贯", "人物一致性", "伏笔照应", "节奏", "文风贴合")


def sse_event(name: str, data: dict) -> dict:
    """SSE 事件（M3 §5.1 契约）。"""
    return {"event": name, "data": data}


class ChapterPipeline:
    def __init__(self, session_factory, provider, settings,
                 skill_registry=None, preference_service=None) -> None:
        self.factory = session_factory
        self.provider = provider
        self.settings = settings
        self.skill_registry = skill_registry        # M4（注入 P0）
        self.preference_service = preference_service  # M5（注入 P0 + 事件记录）

    # ---------- 阶段 A：装配 + 细纲 ----------

    async def generate(self, chapter_id: int, instruction: str | None = None,
                       skip_plan: bool = False,
                       prior_full_k: int | None = None) -> AsyncIterator[dict]:
        k = prior_full_k or self.settings.prior_full_k or K_DEFAULT
        with UnitOfWork(self.factory) as uow:
            ch = uow.session.get(Chapter, chapter_id)
            if ch is None:
                raise NotFound(f"chapters#{chapter_id} 不存在")
            task = GenerationTask(project_id=ch.project_id, chapter_id=chapter_id,
                                  round=1, status="装配中")
            uow.session.add(task)
            uow.session.flush()
            task_id = task.id
        async for ev in self._generate_into(task_id, instruction, skip_plan, k):
            yield ev

    async def resume(self, task_id: int) -> AsyncIterator[dict]:
        """已驳回任务续跑：开新一轮（round 递增），复用同一生成主体（M3 §3.3）。"""
        new_id = self.next_round(task_id)
        async for ev in self._generate_into(new_id, None, False,
                                            self.settings.prior_full_k or K_DEFAULT):
            yield ev

    async def _generate_into(self, task_id: int, instruction: str | None,
                             skip_plan: bool, k: int) -> AsyncIterator[dict]:
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            ch = uow.session.get(Chapter, task.chapter_id)

            yield sse_event("progress", {"task_id": task_id, "stage": "装配"})
            skill_text = (self.skill_registry.render("draft", ch.project_id)
                          if self.skill_registry else "")
            pref_text = (self.preference_service.profile_text(ch.project_id)
                         if self.preference_service else "")
            assembled = Assembler(uow.session, SearchService(uow),
                                  skill_text=skill_text,
                                  preference_text=pref_text).assemble_for_chapter(
                ch.project_id, ch.id, self.settings.context_budget, k)
            task.context_snapshot = {"ledger": assembled["ledger"],
                                     "total_tokens": assembled["total_tokens"],
                                     "skills_injected": assembled["skills_injected"]}
            uow.session.flush()
            yield sse_event("context_ready", {"task_id": task_id,
                                              "ledger": assembled["ledger"],
                                              "skills": assembled["skills_injected"]})
            sections = assembled["sections"]

            if not skip_plan:
                task.status = "细纲生成中"
                uow.session.flush()
                yield sse_event("progress", {"task_id": task_id, "stage": "细纲"})
                plan = await collect(self.provider.chat("writer", self._plan_messages(
                    sections, ch, instruction)))
                task.plan = {"beats": plan}
                ch.plan = plan
                task.status = "细纲确认中"
                uow.session.flush()
                log.info("细纲产出 task=%s chapter=%s", task_id, ch.id)
                yield sse_event("plan_ready", {"task_id": task_id, "plan": plan})
                yield sse_event("done", {"task_id": task_id, "stage": "细纲确认中"})
                return

        # skip_plan：直接进入扩写
        async for ev in self._expand(task_id, instruction=instruction):
            yield ev

    # ---------- 确认细纲（M6 /tasks/{id}/confirm-plan）----------

    def confirm_plan(self, task_id: int, plan_edited: str | None = None) -> None:
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            if task.status != "细纲确认中":
                raise StateConflict(f"任务 {task_id} 不在细纲确认阶段（当前 {task.status}）")
            if plan_edited:
                task.plan = {"beats": plan_edited}
                ch = uow.session.get(Chapter, task.chapter_id)
                if ch is not None:
                    ch.plan = plan_edited
                log.info("细纲已人工修改 task=%s", task_id)
            uow.session.flush()

    # ---------- 阶段 B：扩写 + 评审 ----------

    async def expand(self, task_id: int, instruction: str | None = None) -> AsyncIterator[dict]:
        async for ev in self._expand(task_id, instruction=instruction):
            yield ev

    async def _expand(self, task_id: int, instruction) -> AsyncIterator[dict]:
        # -- 扩写：流式 --
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            ch = uow.session.get(Chapter, task.chapter_id)
            assembled = Assembler(uow.session, SearchService(uow)).assemble_for_chapter(
                ch.project_id, ch.id, self.settings.context_budget,
                self.settings.prior_full_k or K_DEFAULT)
            sections = assembled["sections"]
            plan_text = (task.plan or {}).get("beats", "")
            messages = self._expand_messages(sections, ch, plan_text, instruction,
                                             feedback=self._reject_feedback(task))
            task.status = "扩写生成中"
            uow.session.flush()

        yield sse_event("progress", {"task_id": task_id, "stage": "扩写"})
        draft_parts: list[str] = []
        async for ev in self.provider.chat("writer", messages):
            if ev["type"] == "delta":
                draft_parts.append(ev["text"])
                yield sse_event("token", {"task_id": task_id, "delta": ev["text"]})
        draft = "".join(draft_parts)

        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            task.draft_text = draft
            ChapterRepo(uow).commit_draft(task.chapter_id, draft, source="ai", task_id=task_id)
            task.status = "评审中"
            uow.session.flush()

        # -- 评审 --
        yield sse_event("progress", {"task_id": task_id, "stage": "评审"})
        review = await self._review(task_id, draft, plan_text)
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            task.review = review
            task.status = "待决策"
            uow.session.flush()
        log.info("评审完成 task=%s overall=%s", task_id, review.get("overall"))
        yield sse_event("review", {"task_id": task_id, "review": review})
        yield sse_event("done", {"task_id": task_id, "stage": "待决策"})

    async def _review(self, task_id: int, draft: str, plan_text: str) -> dict:
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            messages = [
                {"role": "system", "content":
                    "你是小说评审。输出 JSON：{\"scores\":{五维:0-10},\"overall\":0-10,"
                    "\"issues\":[{\"level\":\"高|中|低\",\"type\":\"\",\"detail\":\"\"}],"
                    "\"revision_suggestions\":[]}"},
                {"role": "user", "content": f"细纲：\n{plan_text}\n\n草稿：\n{draft}"},
            ]
        raw = await collect(self.provider.chat("reviewer", messages, temperature=0.2))
        review = self._parse_review(raw)
        if review is None:  # schema 失败自动重请一次（M3 §3.2）
            log.warning("评审输出不合契约，重请 task=%s", task_id)
            raw = await collect(self.provider.chat("reviewer", messages, temperature=0.2))
            review = self._parse_review(raw)
        if review is None:
            raise StateConflict(f"评审输出两次不合契约 task={task_id}")
        return review

    @staticmethod
    def _parse_review(raw: str) -> dict | None:
        try:
            start, end = raw.find("{"), raw.rfind("}")
            data = json.loads(raw[start:end + 1])
            scores = data.get("scores") or {}
            if not all(dim in scores for dim in REVIEW_DIMENSIONS):
                return None
            data.setdefault("overall",
                            round(sum(scores.values()) / len(scores), 1))
            data.setdefault("issues", [])
            data.setdefault("revision_suggestions", [])
            return data
        except (ValueError, AttributeError):
            return None

    # ---------- 决策（接受/驳回，伏笔红线不涉）----------

    def decide(self, task_id: int, decision: str,
               tags: list[str] | None = None, note: str | None = None) -> dict:
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            if task.status != "待决策":
                raise StateConflict(f"任务 {task_id} 不在待决策阶段（当前 {task.status}）")
            if decision == "accept":
                ChapterRepo(uow).accept(task.chapter_id, task_id=task_id)
                task.decision = "接受"
                task.status = "已接受"
                pid = task.project_id
                log.info("任务接受 task=%s chapter=%s", task_id, task.chapter_id)
            elif decision == "reject":
                task.decision = "驳回"
                task.status = "已驳回"
                task.reject_tags = tags or []
                task.reject_note = note
                pid = task.project_id
                log.info("任务驳回 task=%s tags=%s", task_id, tags)
            else:
                raise StateConflict(f"非法决策: {decision}")
            uow.session.flush()
        # 偏好学习：接受/驳回均记录事件（M5，事务外，不阻塞决策）
        if self.preference_service is not None:
            self.preference_service.record_decision(
                pid, "accept" if decision == "accept" else "reject",
                tags, note, task_id=task_id)
        with UnitOfWork(self.factory) as uow:
            task = self._task(uow, task_id)
            return {"task_id": task_id, "decision": task.decision, "status": task.status}

    # ---------- 驳回迭代：开新一轮（携反馈，M3 §3.3）----------

    def next_round(self, task_id: int) -> int:
        with UnitOfWork(self.factory) as uow:
            old = self._task(uow, task_id)
            if old.status != "已驳回":
                raise StateConflict("仅已驳回任务可开新轮")
            if old.round >= self.settings.max_rounds:
                raise StateConflict(f"已达最大轮数 {self.settings.max_rounds}，请人工介入")
            task = GenerationTask(project_id=old.project_id, chapter_id=old.chapter_id,
                                  round=old.round + 1, status="装配中")
            uow.session.add(task)
            uow.session.flush()
            return task.id

    # ---------- 内部 ----------

    def _task(self, uow: UnitOfWork, task_id: int) -> GenerationTask:
        task = uow.session.get(GenerationTask, task_id)
        if task is None:
            raise NotFound(f"generation_tasks#{task_id} 不存在")
        return task

    @staticmethod
    def _reject_feedback(task: GenerationTask) -> str:
        """重扩时的上轮反馈（同任务重扩场景由调用方传入旧任务）。"""
        return ""

    @staticmethod
    def _plan_messages(sections: dict, ch, instruction) -> list[dict]:
        ctx = "\n\n".join(f"## {k}\n{v}" for k, v in sections.items())
        return [
            {"role": "system", "content":
                "你是小说作者。只输出本章细纲：3~6 条情节节拍，每条一句。"
                "伏笔只提醒用户已标记的，不自主决定回收。"},
            {"role": "user", "content":
                f"{ctx}\n\n请为章节《{ch.title}》写细纲。"
                + (f"\n附加指令：{instruction}" if instruction else "")},
        ]

    @staticmethod
    def _expand_messages(sections: dict, ch, plan_text, instruction, feedback) -> list[dict]:
        ctx = "\n\n".join(f"## {k}\n{v}" for k, v in sections.items())
        user = (f"{ctx}\n\n已确认细纲：\n{plan_text}\n\n"
                f"请扩写章节《{ch.title}》正文，贴合细纲与前文语感。")
        if instruction:
            user += f"\n附加指令：{instruction}"
        if feedback:
            user += f"\n上轮驳回反馈，请针对性修改：{feedback}"
        return [{"role": "system", "content": "你是小说写手，直接输出正文。"},
                {"role": "user", "content": user}]
