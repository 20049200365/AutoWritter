"""Pydantic DTO（M1 SPEC §2.3：跨模块唯一数据形态，ORM 实体不出包）。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BaseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- 项目 ----------

class ProjectCreate(BaseModel):
    title: str
    genre: str
    synopsis: str | None = None
    target_words: int | None = None
    pov: str | None = None
    tones: list[str] = []


class ProjectPatch(BaseModel):
    title: str | None = None
    genre: str | None = None
    synopsis: str | None = None
    target_words: int | None = None
    pov: str | None = None
    tones: list[str] | None = None
    phase: str | None = None


class ProjectDTO(BaseDTO):
    id: int
    title: str
    genre: str
    synopsis: str | None = None
    target_words: int | None = None
    pov: str | None = None
    tones: list[str] = []
    phase: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


# ---------- 大纲树 ----------

class OutlineCreate(BaseModel):
    project_id: int
    parent_id: int | None = None
    title: str
    summary: str | None = None
    status: str = "构思"
    tension: int | None = None
    sort: int | None = None  # 缺省追加到兄弟末尾


class OutlinePatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    status: str | None = None
    tension: int | None = None


class OutlineDTO(BaseDTO):
    id: int
    project_id: int
    parent_id: int | None = None
    level: int
    sort: int
    title: str
    summary: str | None = None
    status: str
    tension: int | None = None


# ---------- 章节 ----------

class ChapterCreate(BaseModel):
    project_id: int
    title: str
    seq: int | None = None  # 缺省追加末尾；指定=中间插入（自动重编后续）
    outline_node_id: int | None = None


class ChapterPatch(BaseModel):
    title: str | None = None
    status: str | None = None
    outline_node_id: int | None = None


class ChapterDTO(BaseDTO):
    id: int
    project_id: int
    outline_node_id: int | None = None
    seq: int
    title: str
    text: str = ""
    word_count: int = 0
    status: str
    summary: str | None = None
    plan: str | None = None
    deleted_at: datetime | None = None


# ---------- 伏笔 ----------

class ForeshadowCreate(BaseModel):
    project_id: int
    title: str
    description: str | None = None
    importance: int = 1
    planted_chapter_id: int | None = None
    planned_resolve_chapter_id: int | None = None  # 可空→悬空（A6）
    notes: str | None = None


class ForeshadowPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    importance: int | None = None
    planted_chapter_id: int | None = None
    planned_resolve_chapter_id: int | None = None
    state: str | None = None
    notes: str | None = None


class ForeshadowDTO(BaseDTO):
    id: int
    project_id: int
    title: str
    description: str | None = None
    importance: int
    planted_chapter_id: int | None = None
    planned_resolve_chapter_id: int | None = None
    actual_resolve_chapter_id: int | None = None
    state: str
    deleted_at: datetime | None = None


# ---------- 实体图边 ----------

class RelationCreate(BaseModel):
    project_id: int
    src_kind: str  # char|world
    src_id: int
    dst_kind: str
    dst_id: int
    type: str  # 自由文本
    label: str | None = None
    description: str | None = None
    since_chapter_id: int | None = None


class RelationDTO(BaseDTO):
    id: int
    project_id: int
    src_kind: str
    src_id: int
    dst_kind: str
    dst_id: int
    type: str
    label: str | None = None
    description: str | None = None
    status: str


# ---------- 人物 ----------

class CharacterCreate(BaseModel):
    project_id: int
    name: str
    aliases: list[str] = []
    gender: str | None = None
    role: str | None = None
    appearance: str | None = None
    surface_goal: str | None = None
    deep_need: str | None = None
    secret: str | None = None
    arc: str | None = None
    notes: str | None = None


class CharacterPatch(BaseModel):
    name: str | None = None
    aliases: list[str] | None = None
    gender: str | None = None
    role: str | None = None
    appearance: str | None = None
    surface_goal: str | None = None
    deep_need: str | None = None
    secret: str | None = None
    arc: str | None = None
    notes: str | None = None
    first_chapter_id: int | None = None


class CharacterDTO(BaseDTO):
    id: int
    project_id: int
    name: str
    aliases: list[str] = []
    gender: str | None = None
    role: str | None = None
    appearance: str | None = None
    surface_goal: str | None = None
    deep_need: str | None = None
    secret: str | None = None
    arc: str | None = None
    first_chapter_id: int | None = None
    deleted_at: datetime | None = None


# ---------- 世界观词条 ----------

class WorldEntryCreate(BaseModel):
    project_id: int
    category: str
    name: str
    content: str | None = None
    tags: list[str] = []


class WorldEntryPatch(BaseModel):
    category: str | None = None
    name: str | None = None
    content: str | None = None
    tags: list[str] | None = None


class WorldEntryDTO(BaseDTO):
    id: int
    project_id: int
    category: str
    name: str
    content: str | None = None
    tags: list[str] = []
    deleted_at: datetime | None = None


# ---------- Skill ----------

class SkillCreate(BaseModel):
    scope: str = "project"  # global|project
    project_id: int | None = None
    name: str
    genre: str | None = None
    inject_points: list[str] = []
    filepath: str


class SkillDTO(BaseDTO):
    id: int
    scope: str
    project_id: int | None = None
    name: str
    genre: str | None = None
    inject_points: list[str] = []
    enabled: bool
    filepath: str
    version: int


# ---------- 时间线事件 ----------

class TimelineEventCreate(BaseModel):
    project_id: int
    title: str
    track: str = "main"
    time_label: str | None = None
    description: str | None = None
    chapter_id: int | None = None
    sort: int = 0


class TimelineEventPatch(BaseModel):
    title: str | None = None
    track: str | None = None
    time_label: str | None = None
    description: str | None = None
    chapter_id: int | None = None
    sort: int | None = None


class TimelineEventDTO(BaseDTO):
    id: int
    project_id: int
    chapter_id: int | None = None
    track: str
    time_label: str | None = None
    title: str
    description: str | None = None
    sort: int
    deleted_at: datetime | None = None
