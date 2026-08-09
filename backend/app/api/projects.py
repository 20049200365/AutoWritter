"""项目与统计路由（M6 SPEC §2.1）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..data.repos import ProjectRepo
from ..data.schemas import ProjectCreate, ProjectDTO, ProjectPatch
from ..data.stats import project_stats
from .deps import get_uow

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=list[ProjectDTO])
def list_projects(include_deleted: bool = False, uow=Depends(get_uow)):
    return ProjectRepo(uow).list(include_deleted=include_deleted)


@router.post("/projects", response_model=ProjectDTO, status_code=201)
def create_project(data: ProjectCreate, uow=Depends(get_uow)):
    return ProjectRepo(uow).create(data)


@router.get("/projects/{project_id}", response_model=ProjectDTO)
def get_project(project_id: int, uow=Depends(get_uow)):
    repo = ProjectRepo(uow)
    dto = repo.get(project_id)
    if dto is None:
        from ..data.repos import NotFound
        raise NotFound(f"projects#{project_id} 不存在")
    return dto


@router.patch("/projects/{project_id}", response_model=ProjectDTO)
def update_project(project_id: int, patch: ProjectPatch, uow=Depends(get_uow)):
    return ProjectRepo(uow).update(project_id, patch)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, uow=Depends(get_uow)):
    ProjectRepo(uow).delete(project_id)


@router.post("/projects/{project_id}/restore", response_model=ProjectDTO)
def restore_project(project_id: int, uow=Depends(get_uow)):
    return ProjectRepo(uow).restore(project_id)


@router.get("/projects/{project_id}/stats")
def project_stats_route(project_id: int, uow=Depends(get_uow)):
    return project_stats(uow.session, project_id)
