# M1 数据与领域层 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：无 ｜ 被依赖：M2 M3 M4 M5 M6 M8
> 职责：SQLAlchemy 模型、Alembic 迁移、Repository CRUD、软删除/撤销窗口、字数统计、统计聚合、领域事件
> 对外契约：◆ Repository 接口 + Pydantic Schema + 领域事件清单（P0 冻结项）

---

## 1. 目标与边界

### 1.1 目标
1. 承载架构 SPEC §4 的全部数据模型，提供字段级定义与迁移脚本
2. 为所有模块提供**唯一**的数据读写入口（Repository 层），任何模块不直接写 SQL
3. 落实全局规则：所有内容可读写（含 AI 产物）、字数口径唯一、软删除 + 5 秒撤销、统计实时聚合
4. 通过领域事件向外广播数据变更，驱动 M2 索引与 M8 后处理，而不反向依赖它们

### 1.2 边界（不做的事）
- 不做业务编排（生成流水线属 M3）、不做检索排序（属 M2）、不做 HTTP 暴露（属 M6）
- 不发起任何 LLM 调用
- 只发事件、不订阅业务（订阅方是 M2/M8）
- chunks / chunk_entities 两张表由 M1 建表并提供基础读写，但索引策略（切块、分词写入）归 M2

---

## 2. 实现方式

### 2.1 技术选择（承接架构 SPEC §3.2）
- Python 3.12 + SQLAlchemy 2.0（声明式映射，类型标注）+ Alembic 迁移
- SQLite，连接参数：`journal_mode=WAL`、`foreign_keys=ON`、`synchronous=NORMAL`、`busy_timeout=5000`
- 时间戳统一 UTC ISO8601 字符串；主键统一 `INTEGER PRIMARY KEY AUTOINCREMENT`

### 2.2 包结构
```
backend/app/data/
  db.py            # engine / session 工厂 / WAL 配置
  models.py        # SQLAlchemy ORM 实体（仅本包内可见）
  schemas.py       # Pydantic DTO（跨模块唯一数据形态）
  repos/           # 每聚合一个文件：project.py / outline.py / chapter.py ...
  events.py        # 事件定义 + 进程内事件总线
  stats.py         # 统计聚合服务
backend/alembic/   # 迁移脚本
```

### 2.3 分层规则
1. **ORM 实体不出包**：Repository 入参出参一律 Pydantic DTO；其他模块 import 不到 SQLAlchemy 对象
2. **事务边界**：Repository 自身不 commit；由 UnitOfWork（FastAPI 依赖注入提供）统一提交/回滚。一次请求 = 一个 UoW
3. **事件时机**：领域事件在事务成功提交后派发（after-commit hook）；订阅者异常只记日志，不回滚、不阻塞主流程（M2/M8 订阅者仅负责入自己的异步队列）

### 2.4 排序与"还原原位"
所有列表型数据（大纲节点、章节、伏笔、时间线事件等）使用显式 `sort` 字段维护顺序。软删除不改动 `sort`，因此撤销恢复时天然回到原位置，无需记录删除前索引。

---

## 3. 数据模型详细设计

> 约定：`PK` 主键，`FK→表.列` 外键，`NN` 非空，`IDX` 建索引，`UQ` 唯一。json 列存结构化内容，读写经 Pydantic 校验。

### 3.1 项目与大纲
```
projects
  id PK | title NN | genre NN | synopsis | target_words INT
  pov | tones json | phase[筹备|写作] NN default 筹备
  created_at | updated_at | deleted_at（软删除标记，IDX）

outline_nodes
  id PK | project_id FK→projects NN IDX | parent_id FK→outline_nodes（null=卷）
  level INT NN check(1..3) | sort NN | title NN | summary | status[构思|大纲|定稿]
  tension INT check(1..10) | created_at | updated_at
  —— 三级树邻接表；level 由 parent 推导，写入时校验禁止出现第 4 级
```

### 3.2 章节与版本
```
chapters
  id PK | project_id FK NN IDX | outline_node_id FK→outline_nodes（可空=超纲章）
  seq NN | title NN | text default '' | word_count INT NN default 0
  status[构思|大纲|草稿|待修|定稿] NN default 构思 | sort NN
  summary（章摘要，M8 写入）| created_at | updated_at | deleted_at
  UQ(project_id, seq)

chapter_versions
  id PK | chapter_id FK NN IDX | version INT NN | text NN
  source[ai|human|mixed] | task_id FK→generation_tasks（可空）| created_at
  UQ(chapter_id, version)
```

### 3.3 人物与实体图
```
characters
  id PK | project_id FK NN IDX | name NN | aliases json | gender | role
  appearance | surface_goal | deep_need | secret | arc | notes
  first_chapter_id FK→chapters（可空，M8 回填）| created_at | updated_at | deleted_at
  UQ(project_id, name)

character_appearances
  character_id FK NN | chapter_id FK NN | PK(character_id, chapter_id)

relations（实体图边表，支持任意实体互连，已决策：混合实体图）
  id PK | project_id FK NN IDX
  src_kind[char|world] NN | src_id NN     ← char→characters.id，world→world_entries.id
  dst_kind[char|world] NN | dst_id NN
  type TEXT NN                                  ← 自由文本，不枚举；用户可填任意关系名（血缘/隶属/持有/杀父之仇……）
  label | description | since_chapter_id FK→chapters（可空）
  status[active|历史] default active | created_at | updated_at
  IDX(src_kind, src_id) | IDX(dst_kind, dst_id)
  —— 多态端点无法建 DB 级外键，引用完整性由 Repository 写入时校验（端点不存在即拒绝）
  —— 前端可提供常用关系名建议与配色映射（未知类型按名称哈希取色），数据层不校验不限制
```

### 3.4 伏笔与世界观
```
foreshadows
  id PK | project_id FK NN IDX | title NN | description | importance INT check(1..3)
  planted_chapter_id FK→chapters | planned_resolve_chapter_id FK（可空→悬空）
  actual_resolve_chapter_id FK（可空）
  state[已埋设|部分揭示|已回收|悬空] NN | notes
  created_at | updated_at | deleted_at

world_entries
  id PK | project_id FK NN IDX | category[地理|势力|力量体系|器物|名词|习俗|档案] NN
  name NN | content | tags json | created_at | updated_at | deleted_at
  —— 其中的势力/地理/器物等词条兼作实体图的非人物节点
```

### 3.5 Skill 与会话
```
skills
  id PK | scope[global|project] NN | project_id FK（global 时为 null）
  name NN | genre | inject_points json（world/outline/draft/review 子集）
  enabled BOOL NN default 1 | filepath NN（指向 skills/ 目录 md 包）
  version INT | created_at | updated_at
  UQ(scope, project_id, name)

chat_sessions
  id PK | project_id FK NN IDX | title | created_at | updated_at | deleted_at

chat_messages
  id PK | session_id FK NN IDX | role[user|assistant] NN | content
  thinking | tool_calls json | refs json | seq NN | created_at
  suggestion json（可空：AI 建议 payload，含 type 与内容）
  suggestion_status[pending|approved|dismissed]（可空）
  —— AI 后处理建议复用本表，不另设建议队列表（已决策）
```

### 3.6 批注、任务与偏好
```
annotations
  id PK | project_id FK NN | target_type[chapter|outline|world] NN | target_id NN
  anchor_start INT | anchor_end INT | quoted（锚点漂移兜底的原文快照）
  text NN | session_id FK→chat_sessions（可空，圈选对话关联）| created_at

generation_tasks
  id PK | project_id FK NN IDX | chapter_id FK NN IDX | round INT NN default 1
  status[装配中|生成中|评审中|待决策|已接受|已驳回|失败] NN
  context_snapshot json（上下文账本）| draft_text | review json（评审契约见架构 §6.3）
  decision[待定|接受|驳回] default 待定 | reject_tags json | reject_note
  created_at | updated_at

preference_events
  id PK | project_id FK NN IDX | task_id FK→generation_tasks
  action[accept|reject] NN | tags json | feedback | created_at

preference_profile
  project_id PK FK | version INT NN default 1
  likes json | dislikes json | hard_constraints json
  style_sample_ids json（被接受版本的 chapter_versions.id）
  rubric_weights json | source[auto|manual] | updated_at
  snapshots json（历史版本快照数组，支持回滚；不再单设历史表）
```

### 3.7 时间线与索引表
```
timeline_events
  id PK | project_id FK NN IDX | chapter_id FK（可空）
  track[main|char:<id>|foreshadow] NN | time_label | title NN | description
  sort NN | created_at | updated_at | deleted_at

chunks（M1 建表与基础读写；切块/分词写入策略归 M2）
  id PK | project_id FK NN IDX | source_type[chapter|world|outline|char] NN
  source_id NN | ord INT | text | tokens INT | entities json
  UQ(source_type, source_id, ord)

chunk_entities
  chunk_id FK NN | entity_type[char|place|item] NN | entity_name NN
  PK(chunk_id, entity_type, entity_name) | IDX(entity_name)

chunks_fts（FTS5 虚拟表：content=chunks，存 jieba 空格分词文本；M2 维护写入）
```

---

## 4. 模块间耦合协议（其他模块如何调用 M1）

### 4.1 调用方式
- **同进程 Python import**：M1 是库不是服务，无网络调用。各模块 `from app.data.repos import ...`
- **Web 请求内**：Repository 经 FastAPI `Depends(get_uow)` 获得 UnitOfWork，同一请求共享事务
- **后台任务内**（M2/M8 异步队列）：任务自行开启 UoW
- **跨模块数据形态**：只认 `schemas.py` 里的 Pydantic DTO

### 4.2 Repository 接口清单（◆ 冻结契约）

通用 CRUD 模板（每个聚合都有）：`create(dto) / get(id) / update(id, patch) / delete(id) / restore(id) / list(project_id, ...)`。以下只列**非通用**方法：

```python
class OutlineRepo:
    def subtree(self, project_id) -> list[OutlineNodeDTO]      # 全量节点，前端自组树
    def move(self, node_id, parent_id, sort) -> None           # 移动并重算 level
    def delete(self, node_id) -> None                          # 级联软删子树
    # 插入/移动自动重排兄弟节点 sort，支持任意位置插节点（如四章中途加一章）

class ChapterRepo:
    def assign_outline(self, chapter_id, outline_node_id) -> None
        # 章节随时改挂大纲节点（可为空=超纲章）
    def commit_draft(self, chapter_id, text, source, task_id=None) -> int
        # 写正文 → 重算 word_count → 生成 chapter_version → 发 chapter_text_committed
        # 返回版本号
    def accept(self, chapter_id, task_id) -> None
        # 状态置定稿 → 发 chapter_accepted（M8 流水线入口）
    # 中间插入/删除章节时，事务内自动顺延重编后续章号（seq）

class ForeshadowRepo:
    def resolve(self, fsp_id, chapter_id) -> None              # → 已回收 + actual_resolve
    def unresolve(self, fsp_id) -> None                        # 撤销回收，state 按规则回落
    def recalc_state(self, fsp_id) -> None                     # 无 planned_resolve → 悬空

class RelationRepo:
    def create(self, dto) -> RelationDTO                       # 写入前校验两端实体存在
    def neighbors(self, kind, entity_id, depth=1) -> EntitySubgraphDTO
        # 1~2 跳子图（应用层 BFS），返回节点+边，供 M3 上下文装配与 M7 画图

class SkillRepo:
    def set_enabled(self, skill_id, enabled: bool) -> None
    def validate_package(self, filepath) -> ValidationResult   # frontmatter 校验（M4 复用）

class StatsService:
    def project_stats(self, project_id) -> ProjectStatsDTO
    # 字段对齐 Demo projStats：plan / written / words / chars / rels /
    # fsp / fspDone / fspDangling / entries / events / sessions / gap
    # 全部实时聚合，禁止缓存双写

—— AI 建议不单设 Repository：写入/采纳/驳回走 SessionRepo 的 suggestion 标记消息，
   采纳时在事务内应用 payload 对应写入并更新 suggestion_status
```

### 4.3 领域事件清单（◆ 冻结契约）

| 事件 | Payload | 订阅方 | 用途 |
|---|---|---|---|
| `chapter_text_committed` | {chapter_id, version} | M2 | 增量重建该章索引 |
| `chapter_accepted` | {chapter_id, task_id} | M8（触发后处理）、M2 | 流水线入口 |
| `chapter_deleted` | {chapter_id} | M2 | 清理索引 |
| `world_entry_changed` | {entry_id, op} | M2 | 词条索引更新 |
| `outline_changed` | {node_id, op} | M2 | 大纲摘要索引更新 |
| `character_changed` | {character_id, op} | M2 | 人物卡索引更新 |

机制：进程内同步总线；after-commit 派发；订阅者异常仅记日志。统计联动**不走事件**——`StatsService` 实时计算，天然一致。

### 4.4 各模块调用 M1 的方式一览

| 模块 | 读 | 写 |
|---|---|---|
| M2 | ChapterRepo / WorldEntryRepo / OutlineRepo / CharacterRepo（取源文本） | ChunkRepo（chunks、chunk_entities、FTS 影子列） |
| M3 | 全部只读（上下文装配）；SessionRepo | SessionRepo（消息落库）、GenerationTaskRepo（任务状态/快照/草稿/评审） |
| M4 | SkillRepo | SkillRepo |
| M5 | GenerationTaskRepo（读驳回上下文） | PreferenceRepo（事件与画像） |
| M6 | 所有 Repository（REST 装配） | 经前端请求转发 |
| M8 | 全部只读 | CharacterRepo（出场）、SessionRepo（建议消息）、ChapterRepo.summary、TimelineRepo |

### 4.5 禁止事项
- 其他模块直接 `session.execute(SQL)`（FTS5 影子列维护是 M2 唯一例外，仍封装在 ChunkRepo 内）
- Repository 之间跨聚合隐式提交；跨聚合一致性由 UoW 事务保证
- 模块间传递 ORM 实体或 dict 裸结构（必须 DTO）

---

## 5. 功能清单（要实现什么）

1. **项目**：CRUD、阶段切换（筹备→写作）、软删除与撤销
2. **大纲树**：三级 CRUD、节点移动/重排、级联删除、章关联
3. **章节**：CRUD、草稿提交与版本留档、状态管理、接受操作、章摘要字段
4. **人物**：档案 CRUD、出场记录维护、首出场章回填字段
5. **实体图边**：边 CRUD、跨实体类型连接（人物↔人物、人物↔世界观实体、世界观实体互连）、端点存在性校验、1~2 跳子图查询
6. **伏笔**：CRUD、四态流转（resolve/unresolve/悬空推导）
7. **世界观**：词条 CRUD、分类与标签
8. **Skill**：元数据 CRUD、启用开关、包校验入口
9. **会话**：会话与消息 CRUD、消息结构化字段
10. **批注**：CRUD、锚点 + 原文快照
11. **生成任务**：任务全生命周期状态与快照读写
12. **偏好**：事件追加、画像读写与历史版本
13. **时间线**：事件 CRUD、轨道与排序
14. **AI 建议**：以 suggestion 标记的对话消息为载体，采纳时事务内应用 payload、驳回时标记
15. **软删除与撤销窗口**：全实体统一机制（§2.4）+ 过期物理清理任务
16. **字数与统计**：word_count 统一计算、ProjectStats 聚合
17. **领域事件总线**：§4.3 事件发布
18. **迁移**：Alembic 全量脚本，空库一键建 schema

---

## 6. 验收标准

> 全部以 pytest 自动化验证为准；标注「目视」的允许人工核查。

| # | 指标 | 判定 |
|---|---|---|
| A1 | 19 张实体表 Repository 的 CRUD 参数化测试全绿 | 每实体 ≥ create/get/update/delete/list 5 用例通过 |
| A2 | 撤销还原：删除任意实体后 5 秒内 `restore`，列表中位置与删除前一致；到期后物理清理无残留 | 位置按 `sort` 断言 |
| A3 | 字数口径：任意文本 `word_count` = CJK 字符数 + 连续拉丁词数（与 Demo `wordCount()` 逐例一致） | 对照 Demo 函数跑 10 组样本（含混合中英、空串、纯标点） |
| A4 | 大纲树：创建第 4 级节点被拒绝；move 后 level 与 sort 正确；中间插入节点后兄弟节点自动顺延重排；删节点级联软删子树；中间插入章节后后续章号自动重编且连续 | 边界用例全绿 |
| A5 | 版本留档：每次 `commit_draft` / 接受生成一条 chapter_version，version 号连续；可读取任意历史版本文本 | 连续提交 3 次断言 3 版本 |
| A6 | 伏笔四态：resolve/unresolve 状态流转正确；清空 planned_resolve 自动落「悬空」 | 状态机用例全绿 |
| A7 | 统计一致性：构造含 N 章 / M 人物 / K 伏笔（含悬空与已回收）的项目，`project_stats` 返回值与直接查库结果逐项相等 | 断言 11 个统计字段 |
| A8 | 事件契约：`accept` 恰好发出一次 `chapter_accepted`；订阅者抛异常不影响主事务提交 | 用假订阅者验证 |
| A9 | 迁移：空库 `alembic upgrade head` 建立全部表（含 FTS5 虚拟表）；`downgrade -1` 无错 | CI 中执行 |
| A10 | 隔离性：其他模块的契约测试只通过 Repository / DTO / 事件三个入口访问 M1，静态检查无 `models.py` 直接 import | grep/import-linter 检查 |
| A11 | 性能基线：1000 章 + 10000 chunks 的库上，章节列表与 project_stats 查询 < 100ms | 基准脚本目视报告 |
| A12 | 内容全可写：不存在任何无 update 入口的文本字段（AI 产物字段 summary/context_snapshot/review 均有对应写入口） | 接口清单核查 |
| A13 | 实体图：人物↔世界观词条、词条↔词条的跨类型边均可创建并查回；写入指向不存在实体的边被拒绝；`neighbors` 2 跳查询返回正确子图 | 用例全绿 |

---

## 附：与架构 SPEC 的对应关系
- 表结构底稿：架构 SPEC §4.1（本文细化为字段级）
- 联动规则：架构 SPEC §4.2（字数口径、状态联动、删除保护在本文 §2.4/§5.16/A2/A3/A7 落实）
- 建议机制「AI 产物人工确认」原则：架构 SPEC §5.4（本文以 suggestion 标记消息落实，不单设队列表）
