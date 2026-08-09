"""实体与内容资产路由：人物/关系/伏笔/世界观/时间线（M6 SPEC §2.4）。

注意：本文件不用 `from __future__ import annotations`——_crud 闭包的
动态类型注解需要即时求值，否则 OpenAPI 生成时 ForwardRef 无法解析。
"""

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from ..data.repos import (
    CharacterRepo, ForeshadowRepo, RelationRepo, TimelineEventRepo, WorldEntryRepo,
)
from ..data.schemas import (
    CharacterCreate, CharacterDTO, CharacterPatch,
    ForeshadowCreate, ForeshadowDTO, ForeshadowPatch,
    RelationCreate, RelationDTO,
    TimelineEventCreate, TimelineEventDTO, TimelineEventPatch,
    WorldEntryCreate, WorldEntryDTO, WorldEntryPatch,
)
from .deps import get_uow


def _crud(router, repo_cls, dto_cls, create_cls, patch_cls, coll: str, item: str, tag: str):
    """标准 CRUD 同构生成（M6 §2.4），保持薄层：仅转发。"""

    @router.get(coll, response_model=list[dto_cls], name=f"list_{tag}")
    def _list(project_id: int | None = None, uow=Depends(get_uow)):
        return repo_cls(uow).list(project_id=project_id)

    @router.post(coll, response_model=dto_cls, status_code=201, name=f"create_{tag}")
    def _create(data: create_cls, uow=Depends(get_uow)):
        return repo_cls(uow).create(data)

    @router.get(item, response_model=dto_cls, name=f"get_{tag}")
    def _get(entity_id: int, uow=Depends(get_uow)):
        dto = repo_cls(uow).get(entity_id)
        if dto is None:
            from ..data.repos import NotFound
            raise NotFound(f"{tag}#{entity_id} 不存在")
        return dto

    @router.patch(item, response_model=dto_cls, name=f"update_{tag}")
    def _update(entity_id: int, patch: patch_cls, uow=Depends(get_uow)):
        return repo_cls(uow).update(entity_id, patch)

    @router.delete(item, status_code=204, name=f"delete_{tag}")
    def _delete(entity_id: int, uow=Depends(get_uow)):
        repo_cls(uow).delete(entity_id)


router = APIRouter()

_crud(router, CharacterRepo, CharacterDTO, CharacterCreate, CharacterPatch,
      "/characters", "/characters/{entity_id}", "characters")
_crud(router, WorldEntryRepo, WorldEntryDTO, WorldEntryCreate, WorldEntryPatch,
      "/world-entries", "/world-entries/{entity_id}", "world_entries")
_crud(router, TimelineEventRepo, TimelineEventDTO, TimelineEventCreate, TimelineEventPatch,
      "/timeline-events", "/timeline-events/{entity_id}", "timeline_events")

# ---- 关系（含子图查询；neighbors 必须先于 {entity_id} 路由注册，避免被路径参数吞掉）----

@router.get("/relations/neighbors")
def relation_neighbors(kind: str, entity_id: int, depth: int = 1, uow=Depends(get_uow)):
    return RelationRepo(uow).neighbors(kind, entity_id, depth)


_crud(router, RelationRepo, RelationDTO, RelationCreate, RelationDTO,
      "/relations", "/relations/{entity_id}", "relations")


# ---- 伏笔（四态操作，用户驱动）----
_crud(router, ForeshadowRepo, ForeshadowDTO, ForeshadowCreate, ForeshadowPatch,
      "/foreshadows", "/foreshadows/{entity_id}", "foreshadows")


class ResolveBody(BaseModel):
    chapter_id: int


@router.post("/foreshadows/{entity_id}/resolve", response_model=ForeshadowDTO)
def resolve_foreshadow(entity_id: int, body: ResolveBody, uow=Depends(get_uow)):
    return ForeshadowRepo(uow).resolve(entity_id, body.chapter_id)


@router.post("/foreshadows/{entity_id}/unresolve", response_model=ForeshadowDTO)
def unresolve_foreshadow(entity_id: int, uow=Depends(get_uow)):
    return ForeshadowRepo(uow).unresolve(entity_id)
