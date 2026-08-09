"""任务与生成路由（M6 SPEC §2.6）：薄层，查询/取消走 TaskQueryRepo。"""
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..agent.pipeline import ChapterPipeline
from ..data.repos import TaskQueryRepo
from ..api.deps import get_uow

router = APIRouter(tags=["tasks"])


class GenerateBody(BaseModel):
    instruction: str | None = None
    skip_plan: bool = False
    prior_full_k: int | None = None


class ConfirmPlanBody(BaseModel):
    plan_edited: str | None = None


class DecideBody(BaseModel):
    decision: str
    tags: list[str] | None = None
    note: str | None = None


def _pipeline(request: Request) -> ChapterPipeline:
    return ChapterPipeline(request.app.state.session_factory,
                           request.app.state.provider,
                           request.app.state.settings)


async def _sse(agen):
    async for ev in agen:
        yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"


@router.post("/chapters/{chapter_id}/generate")
async def generate(chapter_id: int, body: GenerateBody | None = None, request: Request = None):
    body = body or GenerateBody()
    return StreamingResponse(
        _sse(_pipeline(request).generate(chapter_id, body.instruction,
                                         body.skip_plan, body.prior_full_k)),
        media_type="text/event-stream")


@router.post("/tasks/{task_id}/confirm-plan")
async def confirm_plan(task_id: int, body: ConfirmPlanBody | None = None, request: Request = None):
    """确认/修改细纲后直接流式进入扩写+评审。"""
    pipe = _pipeline(request)
    pipe.confirm_plan(task_id, (body or ConfirmPlanBody()).plan_edited)
    return StreamingResponse(_sse(pipe.expand(task_id)), media_type="text/event-stream")


@router.post("/tasks/{task_id}/decide")
def decide(task_id: int, body: DecideBody, request: Request):
    return _pipeline(request).decide(task_id, body.decision, body.tags, body.note)


@router.post("/tasks/{task_id}/cancel")
def cancel(task_id: int, uow=Depends(get_uow)):
    return TaskQueryRepo(uow).cancel(task_id)


@router.post("/tasks/{task_id}/resume")
async def resume(task_id: int, request: Request, uow=Depends(get_uow)):
    """已驳回任务续跑：流开始前预校验（409 在响应头前返回，M6 D3）。"""
    TaskQueryRepo(uow).resumable(task_id, request.app.state.settings.max_rounds)
    return StreamingResponse(
        _sse(_pipeline(request).resume(task_id)), media_type="text/event-stream")


@router.get("/tasks")
def list_tasks(chapter_id: int | None = None, status: str | None = None, uow=Depends(get_uow)):
    return TaskQueryRepo(uow).list_tasks(chapter_id, status)


@router.get("/tasks/{task_id}")
def get_task(task_id: int, uow=Depends(get_uow)):
    return TaskQueryRepo(uow).get_dict(task_id)
