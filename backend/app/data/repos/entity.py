"""CharacterRepo / WorldEntryRepo / TimelineEventRepo：标准 CRUD + 变更事件。"""
from __future__ import annotations

from ..events import CHARACTER_CHANGED, WORLD_ENTRY_CHANGED
from ..models import Character, TimelineEvent, WorldEntry
from ..schemas import (
    CharacterCreate, CharacterDTO, CharacterPatch,
    TimelineEventCreate, TimelineEventDTO, TimelineEventPatch,
    WorldEntryCreate, WorldEntryDTO, WorldEntryPatch,
)
from .base import BaseRepo


class CharacterRepo(BaseRepo):
    model = Character
    dto = CharacterDTO

    def create(self, data: CharacterCreate) -> CharacterDTO:
        dto = super().create(data)
        self.uow.publish(CHARACTER_CHANGED, character_id=dto.id, op="create")
        return dto

    def update(self, character_id: int, patch: CharacterPatch) -> CharacterDTO:
        dto = super().update(character_id, patch)
        self.uow.publish(CHARACTER_CHANGED, character_id=character_id, op="update")
        return dto


class WorldEntryRepo(BaseRepo):
    model = WorldEntry
    dto = WorldEntryDTO

    def create(self, data: WorldEntryCreate) -> WorldEntryDTO:
        dto = super().create(data)
        self.uow.publish(WORLD_ENTRY_CHANGED, entry_id=dto.id, op="create")
        return dto

    def update(self, entry_id: int, patch: WorldEntryPatch) -> WorldEntryDTO:
        dto = super().update(entry_id, patch)
        self.uow.publish(WORLD_ENTRY_CHANGED, entry_id=entry_id, op="update")
        return dto


class TimelineEventRepo(BaseRepo):
    model = TimelineEvent
    dto = TimelineEventDTO
