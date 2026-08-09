"""ORM 模型：全量 19 张实体表（M1 SPEC §3 字段级对照）。

约定：主键 INTEGER AUTOINCREMENT；时间戳 UTC（SQLite 存 ISO 文本）；
软删除用 deleted_at；json 列读写经 Pydantic（Repository 层）。
chunks_fts 为 FTS5 虚拟表，由迁移脚本建立（M2 维护写入）。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ---------- 3.1 项目与大纲 ----------

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str]
    genre: Mapped[str]
    synopsis: Mapped[str | None] = mapped_column(Text)
    target_words: Mapped[int | None] = mapped_column(Integer)
    pov: Mapped[str | None] = mapped_column(String)
    tones: Mapped[list] = mapped_column(JSON, default=list)
    phase: Mapped[str] = mapped_column(String, default="筹备")  # 筹备|写作
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class OutlineNode(Base):
    __tablename__ = "outline_nodes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("outline_nodes.id"))
    level: Mapped[int] = mapped_column(Integer)  # 1卷 2篇章 3摘要，写入校验 ≤3
    sort: Mapped[int] = mapped_column(Integer)
    title: Mapped[str]
    summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="构思")  # 构思|大纲|定稿
    tension: Mapped[int | None] = mapped_column(Integer)  # 1..10
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ---------- 3.2 章节与版本 ----------

class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("project_id", "seq", name="uq_chapter_project_seq"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    outline_node_id: Mapped[int | None] = mapped_column(ForeignKey("outline_nodes.id"))  # 可空=超纲章
    seq: Mapped[int] = mapped_column(Integer)
    title: Mapped[str]
    text: Mapped[str] = mapped_column(Text, default="")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="构思")  # 构思|大纲|草稿|待修|定稿
    sort: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str | None] = mapped_column(Text)  # 章摘要，M8 写入
    plan: Mapped[str | None] = mapped_column(Text)  # 本章细纲：AI 生成 + 人工确认
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChapterVersion(Base):
    __tablename__ = "chapter_versions"
    __table_args__ = (UniqueConstraint("chapter_id", "version", name="uq_version_per_chapter"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String, default="human")  # ai|human|mixed
    task_id: Mapped[int | None] = mapped_column(ForeignKey("generation_tasks.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- 3.3 人物与实体图 ----------

class Character(Base):
    __tablename__ = "characters"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_char_project_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str]
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    gender: Mapped[str | None] = mapped_column(String)
    role: Mapped[str | None] = mapped_column(String)
    appearance: Mapped[str | None] = mapped_column(Text)   # 外在形象
    surface_goal: Mapped[str | None] = mapped_column(Text)  # 想要什么
    deep_need: Mapped[str | None] = mapped_column(Text)     # 真正需要什么
    secret: Mapped[str | None] = mapped_column(Text)        # 深层秘密
    arc: Mapped[str | None] = mapped_column(Text)           # 人物弧光
    notes: Mapped[str | None] = mapped_column(Text)
    first_chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))  # M8 回填
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CharacterAppearance(Base):
    __tablename__ = "character_appearances"
    __table_args__ = (
        UniqueConstraint("character_id", "chapter_id", name="uq_appearance"),
    )

    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"), primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), primary_key=True)


class Relation(Base):
    """实体图边表：多态端点（char→characters.id，world→world_entries.id）。"""

    __tablename__ = "relations"
    __table_args__ = (
        Index("ix_relation_src", "src_kind", "src_id"),
        Index("ix_relation_dst", "dst_kind", "dst_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    src_kind: Mapped[str] = mapped_column(String)  # char|world
    src_id: Mapped[int] = mapped_column(Integer)
    dst_kind: Mapped[str] = mapped_column(String)  # char|world
    dst_id: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)  # 自由文本，不枚举
    label: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text)
    since_chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    status: Mapped[str] = mapped_column(String, default="active")  # active|历史
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ---------- 3.4 伏笔与世界观 ----------

class Foreshadow(Base):
    __tablename__ = "foreshadows"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str]
    description: Mapped[str | None] = mapped_column(Text)
    importance: Mapped[int] = mapped_column(Integer, default=1)  # 1..3
    planted_chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    planned_resolve_chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))  # 可空→悬空
    actual_resolve_chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    state: Mapped[str] = mapped_column(String, default="已埋设")  # 已埋设|部分揭示|已回收|悬空
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorldEntry(Base):
    __tablename__ = "world_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    category: Mapped[str] = mapped_column(String)  # 地理|势力|力量体系|器物|名词|习俗|档案
    name: Mapped[str]
    content: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------- 3.5 Skill 与会话 ----------

class Skill(Base):
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("scope", "project_id", "name", name="uq_skill_scope_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String)  # global|project
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))  # global 时 null
    name: Mapped[str]
    genre: Mapped[str | None] = mapped_column(String)
    inject_points: Mapped[list] = mapped_column(JSON, default=list)  # world/outline/draft/review 子集
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    filepath: Mapped[str] = mapped_column(String)  # 指向 skills/ 目录 md 包
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String)  # user|assistant
    content: Mapped[str | None] = mapped_column(Text)
    thinking: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[list | None] = mapped_column(JSON)
    refs: Mapped[list | None] = mapped_column(JSON)
    seq: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # AI 后处理建议复用本表（已决策，不单设建议队列表）
    suggestion: Mapped[dict | None] = mapped_column(JSON)  # {type,title,detail,evidence,target}
    suggestion_status: Mapped[str | None] = mapped_column(String)  # pending|approved|dismissed


# ---------- 3.6 批注、任务与偏好 ----------

class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    target_type: Mapped[str] = mapped_column(String)  # chapter|outline|world
    target_id: Mapped[int] = mapped_column(Integer)
    anchor_start: Mapped[int | None] = mapped_column(Integer)
    anchor_end: Mapped[int | None] = mapped_column(Integer)
    quoted: Mapped[str | None] = mapped_column(Text)  # 锚点漂移兜底快照
    text: Mapped[str] = mapped_column(Text)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("chat_sessions.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GenerationTask(Base):
    __tablename__ = "generation_tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), index=True)
    round: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String, default="装配中")
    # 装配中|细纲生成中|细纲确认中|扩写生成中|评审中|待决策|已接受|已驳回|失败
    plan: Mapped[dict | None] = mapped_column(JSON)               # 本轮细纲快照
    context_snapshot: Mapped[dict | None] = mapped_column(JSON)   # 上下文账本
    draft_text: Mapped[str | None] = mapped_column(Text)
    review: Mapped[dict | None] = mapped_column(JSON)             # 评审契约（架构 §6.3）
    decision: Mapped[str] = mapped_column(String, default="待定")  # 待定|接受|驳回
    reject_tags: Mapped[list | None] = mapped_column(JSON)
    reject_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PreferenceEvent(Base):
    __tablename__ = "preference_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("generation_tasks.id"))
    action: Mapped[str] = mapped_column(String)  # accept|reject
    tags: Mapped[list | None] = mapped_column(JSON)
    feedback: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PreferenceProfile(Base):
    __tablename__ = "preference_profile"

    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    likes: Mapped[list] = mapped_column(JSON, default=list)
    dislikes: Mapped[list] = mapped_column(JSON, default=list)
    hard_constraints: Mapped[list] = mapped_column(JSON, default=list)
    style_sample_ids: Mapped[list] = mapped_column(JSON, default=list)  # chapter_versions.id
    rubric_weights: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String, default="auto")  # auto|manual
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    snapshots: Mapped[list] = mapped_column(JSON, default=list)  # 历史版本快照，支持回滚


# ---------- 3.7 时间线、索引表与后处理队列 ----------

class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    track: Mapped[str] = mapped_column(String)  # main|char:<id>|foreshadow
    time_label: Mapped[str | None] = mapped_column(String)
    title: Mapped[str]
    description: Mapped[str | None] = mapped_column(Text)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", "ord", name="uq_chunk_source_ord"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    source_type: Mapped[str] = mapped_column(String)  # chapter|world|outline|char
    source_id: Mapped[int] = mapped_column(Integer)
    ord: Mapped[int] = mapped_column(Integer)
    text: Mapped[str | None] = mapped_column(Text)
    tokens: Mapped[int | None] = mapped_column(Integer)
    entities: Mapped[list] = mapped_column(JSON, default=list)


class ChunkEntity(Base):
    __tablename__ = "chunk_entities"
    __table_args__ = (Index("ix_chunk_entity_name", "entity_name"),)

    chunk_id: Mapped[int] = mapped_column(ForeignKey("chunks.id"), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String, primary_key=True)  # char|place|item
    entity_name: Mapped[str] = mapped_column(String, primary_key=True)


class PostprocessJob(Base):
    __tablename__ = "postprocess_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("generation_tasks.id"))
    step: Mapped[str] = mapped_column(String)  # summary|entities|relations|foreshadows|timeline|outline_check
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|running|done|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
