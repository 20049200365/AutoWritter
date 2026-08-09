"""检索路由（M6 SPEC §2.8，替换占位端点）。"""
from fastapi import APIRouter, Depends

from ..data.db import UnitOfWork
from ..search.service import SearchService
from ..api.deps import get_uow

router = APIRouter(tags=["search"])


@router.get("/projects/{project_id}/search")
def search(project_id: int, query: str,
           types: str = "chapter,world,outline,char",
           k: int = 10, uow: UnitOfWork = Depends(get_uow)):
    # rewriter 待 M3 落地后注入；当前纯实体+FTS（M2 §4：不注入也能工作）
    svc = SearchService(uow)
    return svc.search(query, [t for t in types.split(",") if t], project_id, k=k)
