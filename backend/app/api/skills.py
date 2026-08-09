"""Skill 路由（M6 SPEC §2.5）。"""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from ..data.repos import NotFound, SkillRepo
from ..data.schemas import SkillCreate, SkillDTO
from .deps import get_uow

router = APIRouter(tags=["skills"])


class EnableBody(BaseModel):
    enabled: bool


@router.get("/skills", response_model=list[SkillDTO])
def list_skills(scope: str | None = None, uow=Depends(get_uow)):
    skills = SkillRepo(uow).list()
    return [s for s in skills if scope is None or s.scope == scope]


@router.post("/skills", response_model=SkillDTO, status_code=201)
def create_skill(data: SkillCreate, uow=Depends(get_uow)):
    return SkillRepo(uow).create(data)


@router.get("/skills/{skill_id}", response_model=SkillDTO)
def get_skill(skill_id: int, uow=Depends(get_uow)):
    dto = SkillRepo(uow).get(skill_id)
    if dto is None:
        raise NotFound(f"skills#{skill_id} 不存在")
    return dto


@router.put("/skills/{skill_id}", response_model=SkillDTO)
def update_skill(skill_id: int, data: SkillCreate, uow=Depends(get_uow)):
    # 全量更新：M4 包校验接入前的简化实现
    from ..data.schemas import SkillCreate as _SC  # noqa: F401
    repo = SkillRepo(uow)
    repo._require(skill_id)
    return repo.update(skill_id, data)


@router.delete("/skills/{skill_id}", status_code=204)
def delete_skill(skill_id: int, uow=Depends(get_uow)):
    SkillRepo(uow).delete(skill_id)


@router.post("/skills/{skill_id}/enable", response_model=SkillDTO)
def enable_skill(skill_id: int, body: EnableBody, uow=Depends(get_uow)):
    return SkillRepo(uow).set_enabled(skill_id, body.enabled)
