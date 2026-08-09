"""ProjectRepo：项目 CRUD + 阶段切换。"""
from __future__ import annotations

from ..models import Project
from ..schemas import ProjectCreate, ProjectDTO, ProjectPatch
from .base import BaseRepo


class ProjectRepo(BaseRepo):
    model = Project
    dto = ProjectDTO

    def set_phase(self, project_id: int, phase: str) -> ProjectDTO:
        if phase not in ("筹备", "写作"):
            from .base import StateConflict
            raise StateConflict(f"非法阶段: {phase}")
        return self.update(project_id, ProjectPatch(phase=phase))
