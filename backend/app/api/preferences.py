"""偏好路由（M6 SPEC §2.7）：薄层，全部走 PreferenceService。"""
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["preferences"])


class ProfilePatch(BaseModel):
    likes: list[str] | None = None
    dislikes: list[str] | None = None
    hard_constraints: list[str] | None = None
    rubric_weights: dict | None = None
    style_sample_ids: list[int] | None = None


class RollbackBody(BaseModel):
    version: int


@router.get("/preferences/{project_id}")
def get_profile(project_id: int, request: Request):
    return request.app.state.preference_service.get_profile(project_id)


@router.put("/preferences/{project_id}")
def update_profile(project_id: int, patch: ProfilePatch, request: Request):
    return request.app.state.preference_service.update_manual(
        project_id, patch.model_dump(exclude_none=True))


@router.get("/preferences/{project_id}/events")
def list_events(project_id: int, request: Request):
    return request.app.state.preference_service.list_events(project_id)


@router.post("/preferences/{project_id}/rollback")
def rollback(project_id: int, body: RollbackBody, request: Request):
    return request.app.state.preference_service.rollback(project_id, body.version)
