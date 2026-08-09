"""Repository 层（M1 SPEC §4）：所有模块的唯一数据读写入口。"""
from .base import BaseRepo, NotFound, RepoError, StateConflict
from .chapter import ChapterRepo
from .entity import CharacterRepo, TimelineEventRepo, WorldEntryRepo
from .foreshadow import ForeshadowRepo
from .outline import OutlineRepo
from .project import ProjectRepo
from .relation import RelationRepo
from .session import SessionRepo
from .skill import SkillRepo

__all__ = [
    "BaseRepo", "RepoError", "NotFound", "StateConflict",
    "ProjectRepo", "OutlineRepo", "ChapterRepo", "ForeshadowRepo", "RelationRepo",
    "CharacterRepo", "WorldEntryRepo", "TimelineEventRepo", "SkillRepo", "SessionRepo",
]
