"""SkillRepo：元数据 CRUD + 启用开关（正文内容在文件系统，M4 管）。"""
from __future__ import annotations

from ..models import Skill
from ..schemas import SkillCreate, SkillDTO
from .base import BaseRepo


class SkillRepo(BaseRepo):
    model = Skill
    dto = SkillDTO

    def set_enabled(self, skill_id: int, enabled: bool) -> SkillDTO:
        obj = self._require(skill_id)
        obj.enabled = enabled
        self.s.flush()
        self.log.info("Skill 启停 id=%s enabled=%s name=%s", skill_id, enabled, obj.name)
        return self._to_dto(obj)
