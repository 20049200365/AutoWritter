"""ForeshadowRepo：伏笔四态流转（M1 SPEC §4.2 / A6）。

红线（架构决策）：回收由用户驱动；此处只提供用户操作的落库方法，
AI 的回收提议走建议消息（M8），不经由本 Repo 自动执行。
"""
from __future__ import annotations

from ..models import Foreshadow
from ..schemas import ForeshadowCreate, ForeshadowDTO, ForeshadowPatch
from .base import BaseRepo


class ForeshadowRepo(BaseRepo):
    model = Foreshadow
    dto = ForeshadowDTO

    def create(self, data: ForeshadowCreate) -> ForeshadowDTO:
        fields = data.model_dump()
        # 无计划回收章 → 自动落「悬空」（A6）
        if fields.get("planned_resolve_chapter_id") is None:
            fields["state"] = "悬空"
        obj = Foreshadow(**fields)
        self.s.add(obj)
        self.s.flush()
        self.log.info("创建伏笔 id=%s state=%s title=%s", obj.id, obj.state, obj.title)
        return self._to_dto(obj)

    def resolve(self, fsp_id: int, chapter_id: int) -> ForeshadowDTO:
        """用户标记回收（resolve 路由，M6 /foreshadows/{id}/resolve）。"""
        obj = self._require(fsp_id)
        obj.state = "已回收"
        obj.actual_resolve_chapter_id = chapter_id
        self.s.flush()
        self.log.info("伏笔回收 id=%s 于 chapter=%s", fsp_id, chapter_id)
        return self._to_dto(obj)

    def unresolve(self, fsp_id: int) -> ForeshadowDTO:
        """撤销回收：state 按规则回落（A6）。"""
        obj = self._require(fsp_id)
        obj.actual_resolve_chapter_id = None
        obj.state = "悬空" if obj.planned_resolve_chapter_id is None else "已埋设"
        self.s.flush()
        self.log.info("撤销伏笔回收 id=%s → %s", fsp_id, obj.state)
        return self._to_dto(obj)

    def recalc_state(self, fsp_id: int) -> ForeshadowDTO:
        obj = self._require(fsp_id)
        if obj.state != "已回收" and obj.planned_resolve_chapter_id is None:
            obj.state = "悬空"
            self.s.flush()
        return self._to_dto(obj)

    def update(self, fsp_id: int, patch: ForeshadowPatch) -> ForeshadowDTO:
        dto = super().update(fsp_id, patch)
        # 修改计划回收章后重算悬空态
        if patch.planned_resolve_chapter_id is None and "planned_resolve_chapter_id" in patch.model_fields_set:
            dto = self.recalc_state(fsp_id)
        return dto
