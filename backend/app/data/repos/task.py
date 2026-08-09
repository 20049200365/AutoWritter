"""TaskQueryRepo：生成任务的查询与取消（保持 M6 路由薄层）。"""
from __future__ import annotations

from sqlalchemy import select

from ..models import GenerationTask
from .base import BaseRepo, StateConflict


class TaskQueryRepo(BaseRepo):
    model = GenerationTask
    dto = None  # 任务 DTO 直接以 dict 输出（M6 §2.6）

    def list_tasks(self, chapter_id: int | None = None, status: str | None = None) -> list[dict]:
        q = select(GenerationTask)
        if chapter_id is not None:
            q = q.where(GenerationTask.chapter_id == chapter_id)
        if status:
            q = q.where(GenerationTask.status == status)
        rows = self.s.scalars(q.order_by(GenerationTask.id))
        return [{"id": t.id, "chapter_id": t.chapter_id, "round": t.round,
                 "status": t.status, "decision": t.decision, "created_at": t.created_at}
                for t in rows]

    def get_dict(self, task_id: int) -> dict:
        t = self._require(task_id)
        return {"id": t.id, "chapter_id": t.chapter_id, "round": t.round,
                "status": t.status, "decision": t.decision, "plan": t.plan,
                "context_snapshot": t.context_snapshot, "draft_text": t.draft_text,
                "review": t.review, "reject_tags": t.reject_tags, "reject_note": t.reject_note}

    def cancel(self, task_id: int) -> dict:
        t = self._require(task_id)
        t.status = "失败"
        self.s.flush()
        self.log.info("任务取消 task=%s", task_id)
        return {"task_id": task_id, "status": "失败（已取消）"}

    def resumable(self, task_id: int, max_rounds: int) -> None:
        """流开始前的预校验（避免流式响应中途抛错，M6 D3）。"""
        t = self._require(task_id)
        if t.status != "已驳回":
            raise StateConflict(f"任务 {task_id} 非已驳回状态（当前 {t.status}），不可续跑")
        if t.round >= max_rounds:
            raise StateConflict(f"已达最大轮数 {max_rounds}，请人工介入")
