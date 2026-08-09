"""大纲树路由（M6 SPEC §2.2）。"""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from ..data.repos import OutlineRepo
from ..data.schemas import OutlineCreate, OutlineDTO, OutlinePatch
from .deps import get_uow

router = APIRouter(tags=["outline"])


class MoveBody(BaseModel):
    parent_id: int | None = None
    sort: int = 1


@router.get("/projects/{project_id}/outline", response_model=list[OutlineDTO])
def get_outline(project_id: int, uow=Depends(get_uow)):
    return OutlineRepo(uow).subtree(project_id)


@router.post("/outline", response_model=OutlineDTO, status_code=201)
def create_node(data: OutlineCreate, uow=Depends(get_uow)):
    return OutlineRepo(uow).create(data)


@router.patch("/outline/{node_id}", response_model=OutlineDTO)
def update_node(node_id: int, patch: OutlinePatch, uow=Depends(get_uow)):
    return OutlineRepo(uow).update(node_id, patch)


@router.delete("/outline/{node_id}", status_code=204)
def delete_node(node_id: int, uow=Depends(get_uow)):
    OutlineRepo(uow).delete(node_id)


@router.post("/outline/{node_id}/move", response_model=OutlineDTO)
def move_node(node_id: int, body: MoveBody, uow=Depends(get_uow)):
    return OutlineRepo(uow).move(node_id, body.parent_id, body.sort)
