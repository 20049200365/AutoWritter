"""章节路由（M6 SPEC §2.3）。"""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from ..data.repos import ChapterRepo
from ..data.schemas import ChapterCreate, ChapterDTO, ChapterPatch
from .deps import get_uow

router = APIRouter(tags=["chapters"])


class CommitBody(BaseModel):
    text: str
    source: str = "human"
    task_id: int | None = None


class AcceptBody(BaseModel):
    task_id: int | None = None


@router.get("/projects/{project_id}/chapters", response_model=list[ChapterDTO])
def list_chapters(project_id: int, uow=Depends(get_uow)):
    return ChapterRepo(uow).list(project_id=project_id)


@router.post("/chapters", response_model=ChapterDTO, status_code=201)
def create_chapter(data: ChapterCreate, uow=Depends(get_uow)):
    return ChapterRepo(uow).create(data)


@router.get("/chapters/{chapter_id}", response_model=ChapterDTO)
def get_chapter(chapter_id: int, uow=Depends(get_uow)):
    dto = ChapterRepo(uow).get(chapter_id)
    if dto is None:
        from ..data.repos import NotFound
        raise NotFound(f"chapters#{chapter_id} 不存在")
    return dto


@router.patch("/chapters/{chapter_id}", response_model=ChapterDTO)
def update_chapter(chapter_id: int, patch: ChapterPatch, uow=Depends(get_uow)):
    return ChapterRepo(uow).update(chapter_id, patch)


@router.delete("/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int, uow=Depends(get_uow)):
    ChapterRepo(uow).delete(chapter_id)


@router.post("/chapters/{chapter_id}/commit")
def commit_draft(chapter_id: int, body: CommitBody, uow=Depends(get_uow)):
    version = ChapterRepo(uow).commit_draft(chapter_id, body.text, body.source, body.task_id)
    return {"version": version}


@router.get("/chapters/{chapter_id}/versions")
def list_versions(chapter_id: int, version: int | None = None, uow=Depends(get_uow)):
    repo = ChapterRepo(uow)
    if version is not None:
        return {"version": version, "text": repo.version_text(chapter_id, version)}
    return repo.versions(chapter_id)


@router.post("/chapters/{chapter_id}/accept", response_model=ChapterDTO)
def accept_chapter(chapter_id: int, body: AcceptBody | None = None, uow=Depends(get_uow)):
    return ChapterRepo(uow).accept(chapter_id, task_id=body.task_id if body else None)
