"""会话与建议消息路由（M6 SPEC §2.6/§2.7 的建议部分）。薄层：只调 SessionRepo。"""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from ..data.repos import SessionRepo
from .deps import get_uow

router = APIRouter(tags=["sessions"])


class SessionCreate(BaseModel):
    project_id: int
    title: str | None = None


@router.get("/projects/{project_id}/sessions")
def list_sessions(project_id: int, uow=Depends(get_uow)):
    return SessionRepo(uow).sessions(project_id)


@router.post("/sessions", status_code=201)
def create_session(data: SessionCreate, uow=Depends(get_uow)):
    return SessionRepo(uow).create_session(data.project_id, data.title)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, uow=Depends(get_uow)):
    SessionRepo(uow).delete(session_id)


@router.get("/sessions/{session_id}/messages")
def list_messages(session_id: int, uow=Depends(get_uow)):
    return SessionRepo(uow).messages(session_id)


# ---- 建议消息（M8 产出，用户裁决）----

@router.get("/suggestions")
def list_suggestions(session_id: int, status: str | None = None, uow=Depends(get_uow)):
    return SessionRepo(uow).suggestions(session_id, status)


@router.post("/suggestions/{message_id}/approve", status_code=204)
def approve_suggestion(message_id: int, uow=Depends(get_uow)):
    SessionRepo(uow).approve_suggestion(message_id)


@router.post("/suggestions/{message_id}/dismiss", status_code=204)
def dismiss_suggestion(message_id: int, uow=Depends(get_uow)):
    SessionRepo(uow).dismiss_suggestion(message_id)
