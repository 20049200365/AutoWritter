"""SessionRepo：会话/消息 CRUD + AI 建议消息的采纳/驳回（M1 SPEC §4.2）。

建议消息 = chat_messages 带 suggestion 标记（已决策，不单设队列表）。
采纳 = 事务内应用 payload 对应写入（M8 §4 流转）；AI 永不直接落库创作推断。
"""
from __future__ import annotations

from sqlalchemy import select

from ..models import Character, ChatMessage, ChatSession, Foreshadow, Relation, TimelineEvent
from .base import BaseRepo, NotFound, StateConflict


class SessionRepo(BaseRepo):
    model = ChatSession
    dto = None  # 会话 DTO 由 M6 装配层定义（本模块暂不冻结）

    # ---- 会话/消息查询（供 M6 路由，避免路由层直连 ORM）----
    def sessions(self, project_id: int) -> list[dict]:
        rows = self.s.scalars(
            select(ChatSession).where(ChatSession.project_id == project_id,
                                      ChatSession.deleted_at.is_(None))
            .order_by(ChatSession.id))
        return [{"id": r.id, "project_id": r.project_id, "title": r.title,
                 "created_at": r.created_at, "updated_at": r.updated_at} for r in rows]

    def create_session(self, project_id: int, title: str | None = None) -> dict:
        obj = ChatSession(project_id=project_id, title=title)
        self.s.add(obj)
        self.s.flush()
        self.log.info("创建会话 id=%s project=%s", obj.id, project_id)
        return {"id": obj.id, "project_id": obj.project_id, "title": obj.title}

    def messages(self, session_id: int) -> list[dict]:
        rows = self.s.scalars(
            select(ChatMessage).where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.seq))
        return [{"id": m.id, "role": m.role, "content": m.content, "seq": m.seq,
                 "thinking": m.thinking, "tool_calls": m.tool_calls, "refs": m.refs,
                 "suggestion": m.suggestion, "suggestion_status": m.suggestion_status,
                 "created_at": m.created_at} for m in rows]

    # ---- 建议消息 ----
    def add_suggestion(self, session_id: int, payload: dict, seq: int | None = None) -> int:
        """M8 写入建议消息。payload = {type,title,detail,evidence,target}。"""
        if seq is None:
            seq = (self.s.scalar(
                select(ChatMessage.seq).where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.seq.desc()).limit(1)) or 0) + 1
        msg = ChatMessage(session_id=session_id, role="assistant", seq=seq,
                          content=payload.get("title", ""),
                          suggestion=payload, suggestion_status="pending")
        self.s.add(msg)
        self.s.flush()
        self.log.info("建议消息落位 session=%s msg=%s type=%s",
                      session_id, msg.id, payload.get("type"))
        return msg.id

    def suggestions(self, session_id: int, status: str | None = None) -> list[dict]:
        q = select(ChatMessage).where(
            ChatMessage.session_id == session_id,
            ChatMessage.suggestion.is_not(None))
        if status:
            q = q.where(ChatMessage.suggestion_status == status)
        rows = self.s.scalars(q.order_by(ChatMessage.id))
        return [{"id": m.id, "suggestion": m.suggestion, "status": m.suggestion_status}
                for m in rows]

    def approve_suggestion(self, message_id: int) -> None:
        """采纳：事务内应用 payload（M6 /suggestions/{id}/approve）。"""
        msg = self.s.get(ChatMessage, message_id)
        if msg is None or msg.suggestion is None:
            raise NotFound(f"建议消息 #{message_id} 不存在")
        if msg.suggestion_status != "pending":
            raise StateConflict("建议已处理，不可重复采纳")
        self._apply_payload(msg.suggestion)
        msg.suggestion_status = "approved"
        self.s.flush()
        self.log.info("建议采纳 msg=%s type=%s", message_id, msg.suggestion.get("type"))

    def dismiss_suggestion(self, message_id: int) -> None:
        msg = self.s.get(ChatMessage, message_id)
        if msg is None or msg.suggestion is None:
            raise NotFound(f"建议消息 #{message_id} 不存在")
        msg.suggestion_status = "dismissed"
        self.s.flush()
        self.log.info("建议驳回 msg=%s", message_id)

    # ---- payload 应用（类型分发）----
    def _apply_payload(self, suggestion: dict) -> None:
        stype = suggestion.get("type")
        target = suggestion.get("target") or {}
        if stype == "new_char":
            self.s.add(Character(**target))
        elif stype == "relation_change":
            self.s.add(Relation(**target))
        elif stype == "foreshadow_plant":
            fields = dict(target)
            if fields.get("planned_resolve_chapter_id") is None:
                fields["state"] = "悬空"
            self.s.add(Foreshadow(**fields))
        elif stype == "foreshadow_resolve":
            # 采纳回收提议 = 用户指定回收章（不直接标已回收，红线）
            fsp = self.s.get(Foreshadow, target["foreshadow_id"])
            if fsp is None:
                raise NotFound(f"伏笔 #{target['foreshadow_id']} 不存在")
            fsp.planned_resolve_chapter_id = target["chapter_id"]
            if fsp.state == "悬空":
                fsp.state = "已埋设"
        elif stype == "timeline_event":
            self.s.add(TimelineEvent(**target))
        else:
            raise StateConflict(f"未知建议类型: {stype}")
