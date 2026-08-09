# AI 小说写作助手（Novel Writing Agent）系统规格书

> 版本：v0.1（架构评审稿）
> 定位：本文只承载**架构、技术选型与模块拆分**，供评审确认；不展开实现细节与验收标准——模块拆分确认后，每个模块另出详细 spec（含验收标准）
> 对齐对象：`前端模板参考/novel-studio.html`（单文件前端原型）与 `前端模板参考/task.txt`

---

## 1. 项目概述

### 1.1 定位
构建一个 **AI 辅助人类创作长篇小说的 Agent 工作台**。人类作者是创作的最终裁决者：AI 负责生成、检索上下文、评审打分与迭代修改；所有 AI 产出必须经过人工「接受 / 驳回」才能进入正典（canon）。

### 1.2 核心目标
1. **筹备阶段**：通过对话式生成 + 划选式修改，完成世界观设定与三级树形大纲（卷 → 篇章 → 内容摘要）。
2. **写作阶段**：以章为单位的流水线 —— 上下文检索 → 写手 Agent 生成 → 评审 Agent 打分 → 人工接受/驳回 → 驳回迭代。
3. **偏好学习**：记录每次接受/驳回行为与反馈，持续构建用户画像，使生成与评审越来越贴合用户口味。
4. **数据资产化**：世界观、大纲、人物关系（图结构）、伏笔（埋设/回收追踪）全部持久化、可视化、可 CRUD。

### 1.3 非目标（本期不做）
- 多用户协作 / 云端账号体系（单用户本地优先）
- 全自动写作（无人值守批量生成章节）
- 移动端适配（桌面浏览器优先，≥1000px）
- 多语言小说支持（聚焦中文写作）

---

## 2. 核心工作流设计

### 2.1 筹备阶段（必选前置）

```
新建作品 ──► 世界观设定 ──► 三级大纲 ──► 解锁「写作阶段」
              ▲ 对话式生成      ▲ 对话式生成
              ▲ 划选式修改      ▲ 划选式修改
```

**大纲树（三级结构）**：
- L1 卷：大段落划分，含卷名 + 一句话概要 + 章节范围
- L2 篇章：卷下的故事单元（粒度可粗可细，可以是"章"也可以是"篇章段落"）
- L3 内容摘要：每个篇章的故事发展节拍（beat），1~N 条

不强制一次性写满三级：允许先只有卷 + 粗粒度篇章，写作推进时再向下补全。但**开始写第 N 章前，第 N 章对应的 L3 节拍必须存在**（可由 AI 对话式补全）。

**AI 辅助的两种交互**：
| 方式 | 触发 | 行为 |
|---|---|---|
| 对话式生成 | Agent 对话模块 | 用户自然语言描述想法，AI 生成/补全世界观词条、大纲节点；生成结果以「建议卡片」呈现，用户逐条采纳 |
| 划选式修改 | 正文/大纲/设定的编辑视图中选中文本 | 浮出操作条：① 添加批注 ② 圈选片段送入 AI 对话，要求局部润色/修改，产出「前后对照卡片」（采纳替换 / 放弃 / 再来一次） |

**Skill 机制（可插拔技能包）**：
- Skill 是一个带 frontmatter 的 Markdown 包：声明适配题材（玄幻 / 情感 / 悬疑…）、注入点（世界观编写 / 大纲 / 正文生成 / 评审）、提示词片段与可选的 few-shot 范文。
- 用户可自由新建、编辑、启用/停用；系统内置 2~3 个预置 Skill（玄幻网文、情感、悬疑）作为模板。
- Skill 同时作用于写手与评审 Agent（评审按 Skill 声明的题材标准打分）。

### 2.2 写作阶段：单章流水线

```
            ┌────────────────────── 章 N 生成任务 ──────────────────────┐
            │                                                            │
用户触发 ──► │ ① 上下文组装 ──► ② 写手Agent生成 ──► ③ 评审Agent打分 ──► ④ 人工决策 │
            │   (检索服务)        (流式输出)        (分维度+意见)    接受│驳回   │
            └────────────────────────────────────────────────────────┬───┘
                                          接受 ──► 后处理流水线（§5.4）│
                                          驳回 ──► 记录偏好事件 ──► 携带驳回意见重新生成
```

① **上下文组装**（详见 §5.3）：检索前文摘要与前章结尾、本章大纲节拍、相关人物档案+关系子图、活跃伏笔、世界观词条、用户偏好档案、激活 Skill 的提示词，按 token 预算分级装配。
② **写手 Agent**：流式输出正文；输出即草稿（draft），不直接入正典。
③ **评审 Agent**：独立模型/独立提示词，按维度打分（情节连贯、人物一致性、伏笔照应、节奏、文风贴合）并输出结构化意见；评审权重受用户画像动态调整。
④ **人工决策**：接受 → 草稿定稿并触发后处理；驳回 → 用户给出驳回理由（标签 + 自由文本），连同评审意见一起作为反馈重新生成（同任务可多次迭代，全部版本留档）。

### 2.3 用户偏好学习

- **事件层**：每次接受/驳回落库（任务快照、评审分、驳回标签、用户自由文本反馈）。
- **画像层**：每累计 N 次事件（建议 N=5）触发一次 LLM 反思蒸馏，产出结构化画像：风格偏好、雷区清单、正例片段（取自被接受的草稿）、评审权重调整建议。
- **注入点**：
  1. 写手 system prompt 追加「用户偏好」段落 + 被接受片段作 few-shot；
  2. 评审提示词按画像调整维度权重与重点关注项；
  3. 连续被同类理由驳回时，画像中标记为「硬约束」（如"禁止出现心理独白超过 3 句"）。
- 画像可在前端「偏好档案」页查看、手动修正（人工可编辑优先级高于自动蒸馏）。

---

## 3. 系统架构与技术选型

### 3.1 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    前端工作台（React + TS）                    │
│  书架│对话│正文读/写│人物关系图│大纲伏笔│世界观│看板│Skill管理   │
└───────────────▲─────────────────────────────▲───────────────┘
                │ REST (CRUD)                 │ SSE (流式生成/评审)
┌───────────────┴─────────────────────────────┴───────────────┐
│                  后端服务（Python / FastAPI）                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ 领域服务层 │ │ Agent编排 │ │ 检索服务  │ │ 偏好学习服务    │  │
│  │(CRUD/事务)│ │(流水线/SSE)│ │(混合检索) │ │(事件/画像蒸馏)  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────┬────────┘  │
│       │            │            │               │            │
│  ┌────┴────────────┴────────────┴───────────────┴────────┐  │
│  │                    LLM 网关层                          │  │
│  │      writer模型 / reviewer模型 / 蒸馏模型 分角色配置       │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│ 存储层（全部本地文件，单目录可整体备份迁移）                        │
│  SQLite(WAL): 结构化数据 + FTS5 全文索引 + 实体共现索引          │
│  文件系统: Skill 包(.md) / 导出备份 / 运行日志                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 技术栈选型（评审重点）

| 层 | 选型 | 理由 | 备选 |
|---|---|---|---|
| 前端框架 | **React 18 + TypeScript + Vite** | Demo 的模块结构与交互深度（命令面板、撤销 Toast、划选操作条）用组件化框架维护成本最低；TS 保证多模块并行开发时接口不漂移 | Vue 3 |
| 编辑器 | **Tiptap（ProseMirror）** | 划选式修改、批注锚点、前后对照替换都依赖可靠的选区与标记（Mark）能力；纯 contenteditable 方案锚点会在重渲染后漂移 | CodeMirror 6（纯文本方案） |
| 关系图 | **d3-force + React 封装** | 力导向图、拖拽加热、按类型着色虚线，Demo 已验证算法可行，d3-force 是其成熟版 | 自研（沿用 Demo 物理迭代） |
| 视觉 | 复用 Demo 设计令牌（纸底 #f6f1e6 / 印章红 #a8433a / 宋体+楷体+等宽三栈），CSS Variables + Tailwind | Demo 视觉方向已获认可，直接迁移 token，不重新设计 | — |
| 后端框架 | **Python 3.12 + FastAPI** | LLM/Agent 生态最成熟（分词、prompt 工具链）；原生 async 适配流式；Pydantic 做接口契约 | Node.js + NestJS |
| 主数据库 | **SQLite（WAL 模式）+ SQLAlchemy 2 + Alembic** | 单用户本地工具，零运维、单文件备份；关系模型足以承载大纲树/人物/伏笔/事件日志 | PostgreSQL（若未来转云服务） |
| 全文检索 | **SQLite FTS5 + jieba 预分词** | 中文关键词检索；章节入库时 jieba 切词写入 FTS 影子列，检索零外部依赖 | MeiliSearch |
| 实体检索 | **实体共现表（chunk_entities）+ 应用层查询** | 小说检索以专名（人物/地点/物件）为锚点，实体由后处理流水线 LLM 抽取建表，按实体命中召回章节块 | 向量检索（已决策不采用，见 §5.5） |
| 图查询 | **关系表（nodes/edges）+ 应用层 1~2 跳邻接查询** | 单部小说人物量级 ≤ 百，专用图数据库属过度设计；应用层子图抽取足够 | Neo4j（若未来需多跳推理） |
| LLM 网关 | **OpenAI 兼容协议统一接入**（LiteLLM 封装），writer / reviewer / 蒸馏 三角色独立配置模型 | 支持 DeepSeek / GLM / Qwen / OpenAI 任意组合；写手用强生成模型、评审与蒸馏可用更便宜的模型 | 直连各厂 SDK |
| 流式协议 | **SSE**（生成逐 token、思考过程、工具调用、评审结果均为事件流） | 单向流式场景比 WebSocket 简单，断线重连内建 | WebSocket |
| 后台任务 | **进程内 asyncio 任务队列**（章接受后的索引/抽取后处理） | 单机单用户，无需 Celery 级基建；队列状态落库可恢复 | RQ |
| 打包分发 | **先做纯 Web（localhost 启动脚本）**；P4 阶段评估 Tauri 壳 | 先验证核心链路，桌面壳是增量工作 | Electron |

### 3.3 部署形态
单机本地服务：`python -m novelstudio` 起 FastAPI（127.0.0.1:8000）+ 前端构建产物静态托管，双击启动脚本即用。所有数据落在 `~/.novelstudio/`（数据库 + Skill + 备份），整体可复制迁移。

---

## 4. 数据模型设计

> 原则：**大纲计划（plan）与已写稿件（chapters）分表**（Demo task.txt §模块5 的硬性区分）；章节正文保留全版本历史；所有 AI 建议先进「待确认」队列再入正典。

### 4.1 核心表结构（简表）

```
projects            id, title, genre, synopsis, target_words, pov, tones(json),
                    phase[筹备|写作], created_at, updated_at

outline_nodes       id, project_id, parent_id, level(1卷|2篇章|3摘要), sort,
                    title, summary, status[构思|大纲|定稿], tension(1-10)
                    —— 三级树，邻接表存储，前端树形 CRUD

chapters            id, project_id, outline_node_id(可空，允许超纲章), seq,
                    title, text, status[构思|大纲|草稿|待修|定稿], word_count,
                    summary(章摘要，后处理生成), updated_at

chapter_versions    id, chapter_id, version, text, source[ai|human|mixed],
                    task_id(可空), created_at
                    —— 每次定稿/驳回迭代留档

characters          id, project_id, name, aliases(json), gender, role,
                    appearance(外在形象), surface_goal(想要什么), deep_need(真正需要什么),
                    secret(深层秘密), arc(人物弧光), first_chapter_id, notes
                    —— 字段设计对齐 Demo「写作导向档案」

character_appearances  character_id, chapter_id     —— 出场记录，驱动频次统计
relations           id, project_id,
                    src_kind[char|world] + src_id, dst_kind[char|world] + dst_id,
                    type(自由文本，不枚举，用户可填任意关系名，如 血缘/隶属/持有/敌对),
                    label, description, since_chapter_id, status[active|历史]
                    —— 实体图：人物（characters）与世界观词条（world_entries 中的势力/地理/器物等）均为节点，本表为边，支持任意实体互连（混合实体图，已决策）；前端可提供常用类型建议与配色映射，但存储不受限

foreshadows         id, project_id, title, description, importance(1-3),
                    planted_chapter_id, planned_resolve_chapter_id(可空→悬空),
                    actual_resolve_chapter_id, state[已埋设|部分揭示|已回收|悬空],
                    notes

world_entries       id, project_id, category[地理|势力|力量体系|器物|名词|习俗|档案],
                    name, content, tags(json)

skills              id, scope[global|project], project_id(可空), name, genre,
                    inject_points(json: world|outline|draft|review),
                    enabled, filepath(指向 skills/ 目录 md 包), version

chat_sessions       id, project_id, title, created_at, updated_at
chat_messages       id, session_id, role[user|assistant], content, thinking,
                    tool_calls(json), refs(json: 引用的人/章/伏笔)

annotations         id, project_id, target_type[chapter|outline|world],
                    target_id, anchor_start, anchor_end, text, session_id(可空)
                    —— 划选批注；关联会话即「圈选片段与 AI 对话」的记录

generation_tasks    id, project_id, chapter_id, round, status,
                    context_snapshot(json: 组装的上下文与token账本),
                    draft_text, review(json: 分维度分+意见),
                    decision[待定|接受|驳回], reject_tags(json), reject_note,
                    created_at

preference_events   id, project_id, task_id, action[accept|reject],
                    tags(json), feedback, created_at
preference_profile  project_id, version, likes(json), dislikes(json),
                    hard_constraints(json), style_sample_ids(json),
                    rubric_weights(json), source[auto|manual], updated_at

timeline_events     id, project_id, chapter_id, track[main|char:<id>|foreshadow],
                    time_label, title, description
                    —— 多轨时间线数据，后处理抽取 + 人工可编辑

chunks              id, project_id, source_type[chapter|world|outline|char],
                    source_id, ord, text, tokens, entities(json)
                    + FTS5 影子表(jieba分词)

chunk_entities      chunk_id, entity_type[char|place|item], entity_name
                    —— 实体↔章节块共现表（后处理抽取建立），实体驱动检索的索引
```

### 4.2 口径与联动规则
- **所有内容可读写**：正文、大纲、世界观词条、人物档案与关系、伏笔、时间线事件、Skill、偏好画像等全部文本内容均提供前端 CRUD，不存在只读的 AI 派生内容；AI 抽取/生成的内容落库后与人写内容同权，可直接修改。
- **字数口径唯一**：`word_count` 由后端统一计算（CJK 字符 + 连续拉丁词，同 Demo `wordCount()` 口径），章节页、侧栏、看板一律读该字段；编辑区实时字数标注「编辑区」字样。
- **状态联动**：伏笔状态改变 → 回收率、风险提示、大纲模块角标、看板数字全部由后端统计接口实时返回，前端不各自硬算。
- **删除保护**：项目/会话/章节删除走软删除 + 5 秒撤销窗口（对齐 Demo 交互），到期物理清理。

---

## 5. 存储与检索方案（关键技术难点）

### 5.1 多库分工

| 数据 | 存储 | 检索方式 |
|---|---|---|
| 结构化实体（大纲/人物/伏笔/设定/任务/事件） | SQLite 关系表 | SQL + 应用层图遍历 |
| 章节正文、设定词条、大纲摘要 | SQLite FTS5（jieba 分词） | 关键词 BM25 |
| 同上（切块后） | chunks + chunk_entities | 实体共现召回 + 关键词 BM25 |
| 实体关系（实体图） | relations 多态边表 + 两类节点表 | 1~2 跳子图抽取（应用层 BFS） |
| 前文记忆 | 分层滚动摘要（见 §5.2） | 按章号直接取用 |

> **为什么不用图数据库、也不引入向量库**：单用户单部小说实体量级小（人物 ≤ 百、章节 ≤ 千），SQLite 单文件带来"整目录拷走即迁移"的运维优势。检索采用**实体驱动**路线：小说检索的锚点以人物/地点/物件等专名为主，后处理流水线的实体抽取本来就要建共现索引，配合 FTS 关键词与 LLM 查询改写即可覆盖检索需求，无需额外引入 embedding 模型与向量化成本（已评审决策，见 §5.5；图存储结论可随规模假设重议，见 §11 决策点 D3）。

### 5.2 分层滚动摘要（解决"前文太长喂不下"）

```
全局摘要（全书至今 ≤800 字）
  └─ 卷摘要（每卷 ≤500 字）
      └─ 章摘要（每章 ≤200 字，章节接受后自动生成）
          └─ 章节原文块（chunk，仅按需经实体/关键词检索进入上下文）
```

- 章接受 → 生成/更新章摘要；每 5 章或卷结束 → 增量刷新卷摘要与全局摘要。
- 写第 N 章时，"前文"不靠全文塞入，而是：全局摘要 + 当前卷摘要 + 前 2~3 章摘要 + 第 N-1 章结尾原文（~1500 字，保证衔接语感）+ 实体驱动检索命中的更早原文块。

### 5.3 单章上下文组装（写手输入的组织方式）

按 **优先级 × token 预算**（默认预算 16k，可配）自顶向下装配，每层带账本记录（写入 `generation_tasks.context_snapshot`，前端可预览"本章 AI 看到了什么"）：

| 优先级 | 内容 | 来源 | 预算占比 |
|---|---|---|---|
| P0 | 用户偏好档案 + 激活 Skill 提示词 + 全书全局摘要 | preference_profile / skills / 摘要层 | ~15% |
| P1 | 本章大纲路径（卷概要→篇章→L3 节拍）+ 前章结尾原文 + 前 3 章摘要 | outline_nodes / chapters | ~30% |
| P2 | 活跃伏笔清单（未回收全量 + 计划本章回收的高亮）+ 本章涉及人物的档案与实体图子图（沿隶属/持有等边顺带捞相邻世界观词条） | foreshadows / characters / relations / world_entries | ~25% |
| P3 | 世界观词条：按本章大纲+人物名检索 top-K | world_entries（FTS 关键词 + 实体加权） | ~15% |
| P4 | 更早原文块：实体共现检索 top-K（以本章涉及的人物/地点/物件名展开查询） | chunks / chunk_entities | 剩余 |

超预算时从 P4 向 P2 依次压缩（原文块减量 → 词条减量 → 人物卡只留核心字段），P0/P1 不压缩。

### 5.4 增量更新流水线（章节接受后触发，异步队列）

```
章节定稿 ──► 1. 字数/状态落库
          ─► 2. 章摘要生成（LLM）→ 视情况刷新卷/全局摘要
          ─► 3. 切块 → 写 chunks / FTS5 索引（先删旧块）
          ─► 4. 实体抽取（LLM）：出场人物、地点、物件 → character_appearances + chunk_entities
          ─► 5. 关系变更建议：新关系/关系变化 → 「待确认」队列（人工采纳入库）
          ─► 6. 伏笔侦测：疑似新埋设/疑似回收 → 建议卡片（人工确认后改状态）
          ─► 7. 时间线事件抽取 → timeline_events（轨道归属按人物/伏笔自动归类）
          ─► 8. 大纲对账：实际正文与 L3 节拍偏差过大时提示用户修大纲
```

所有 AI 抽取产物（4~7）默认进**建议消息**（带 suggestion 标记的对话消息，不单设队列表）而非直接改写正典，前端以角标提示待确认数量 —— 与"人类是创作主导者"的定位一致。

### 5.5 检索算法（实体驱动 + 关键词，不依赖向量）
- **实体路（主路）**：以查询涉及的人物/地点/物件名查 chunk_entities 共现表 → 召回相关章节块，按共现次数 × 章号邻近度排序。小说检索绝大多数查询是专名驱动，此路命中率高且零模型成本。
- **关键词路**：jieba 分词走 FTS5（BM25），用于世界观词条与自由文本查询。
- **查询改写（LLM 替代向量召回）**：对描述性查询（如「主角和师父决裂那段」），检索 Agent 先让 LLM 改写出 2~3 组候选关键词/实体名再多次检索合并结果——语义能力由系统已有的 LLM 承担，不引入 embedding。
- **融合**：实体命中加权 > FTS 得分；source_type / project_id / 章号范围在 SQL 层预过滤。

---

## 6. Agent 系统设计

### 6.1 Agent 角色

| 角色 | 职责 | 模型配置 |
|---|---|---|
| 对话 Agent | 筹备阶段对话式生成（世界观/大纲建议）、日常问答、工具调用（检索/统计/起草） | writer 模型 |
| 写手 Agent | 单章正文生成、划选片段的润色/精简/扩写/改人称 | writer 模型 |
| 评审 Agent | 分维度打分 + 结构化意见 + 一致性核对（对照上下文快照找硬伤） | reviewer 模型（可独立配置） |
| 蒸馏 Agent | 偏好事件反思、章/卷摘要、实体与关系抽取、伏笔侦测 | 可配更经济的模型 |

对话 Agent 的工具集（对齐 Demo 的工具卡片呈现）：`stat_summary` / `fetch_chapter` / `char_lookup` / `scan_foreshadow` / `search_world` / `draft_outline` / `draft_chapter`。工具调用全程以「工具卡片（名称/入参/状态/返回）」形式在消息流中可视化。

### 6.2 内核实现策略（已决策：自研薄内核）

不采用 opencode 等现成编码 Agent 框架作运行时内核（其代码向工具集与单循环模型与本项目的领域工具、阶段式流水线不匹配，且引入 TS/Node 栈翻转或双进程复杂度）。内核自研，由三层组成：

| 层 | 实现 | 说明 |
|---|---|---|
| Provider 层 | LiteLLM（OpenAI 兼容协议） | 三角色模型路由、流式、重试、限流 |
| Agent 循环层 | 手写 tool loop（数百行级） | 消息历史管理、工具调用分发、流式增量回调、中断/恢复 |
| 编排层 | 确定性 Python 流水线 | 上下文组装→写手→评审→决策→后处理，阶段间状态落库（generation_tasks），非"单 Agent 自由循环"模式 |

取舍理由：本项目的复杂度在上下文组装、评审契约与偏好注入（均在编排层），而非 Agent 循环本身；自研保证流水线、SSE 事件协议与数据模型完全可控，无框架耦合。

内核须自管的责任范围：会话持久化、生成/对话两类上下文管理、循环控制（轮数护栏）、Skill 注入、中断恢复、token 账目——具体设计与验收标准在 M3 模块 spec 中展开。若循环层实现遇到超预期阻力，可降级换用轻量 agent 脚手架（如 OpenAI Agents SDK），三层架构保证替换不影响编排层与数据模型。

### 6.3 评审 Agent 输出契约（JSON）

```json
{
  "scores": { "情节连贯": 8, "人物一致性": 7, "伏笔照应": 9, "节奏": 6, "文风贴合": 8 },
  "weights": { "…": "来自偏好档案的当前权重" },
  "overall": 7.6,
  "verdict_hint": "建议修改后接受",
  "issues": [ { "level": "高", "type": "人物口癖漂移", "detail": "…", "evidence": "第3段" } ],
  "highlights": ["…"],
  "revision_suggestions": ["…"]
}
```

评审权重初始内置，随偏好档案的 `rubric_weights` 滚动更新（如用户多次以"节奏太慢"驳回 → 节奏维度权重上调）。

### 6.4 Skill 包规范

```
skills/
  玄幻网文/
    skill.md          # frontmatter: name/genre/version/inject_points
                      # 正文: 修炼体系写作惯例、爽点节奏准则、称谓规范…
    samples.md        # 可选 few-shot 范文
```

- 注入点：`world`（世界观生成时追加题材惯例）、`outline`（大纲节奏模板）、`draft`（写手 system prompt 追加）、`review`（评审追加题材检查项）。
- 前端提供 Skill 管理页：列表、启用开关、Markdown 编辑器（CodeMirror）、新建/复制预置模板。

### 6.5 偏好学习闭环

```
接受/驳回 ──► preference_events ──► 每5事件蒸馏 ──► preference_profile
     ▲                                                     │
     └──── 注入写手prompt / 评审权重 / few-shot正例 ◄────────┘
```

- 驳回时前端提供结构化标签（节奏问题 / 文风不合 / 逻辑硬伤 / 人物失真 / 偏离大纲）+ 自由文本，降低用户表达成本。
- 画像版本化留档，可回滚；手动编辑的画像字段打 `source=manual`，蒸馏不覆盖。

---

## 7. 模块拆分与边界（并行开发视图）

> 8 个模块，按接口契约解耦。标注 ◆ 的契约需在第 0 里程碑冻结，之后各模块可并行开工。

| # | 模块 | 职责 | 对外契约 | 依赖 |
|---|---|---|---|---|
| **M1** | 数据与领域层 | SQLAlchemy 模型、Alembic 迁移、Repository CRUD、软删除/撤销窗口、字数统计、统计聚合接口 | ◆ Repository 接口 + Pydantic Schema | 无 |
| **M2** | 索引与检索服务 | 切块、jieba/FTS、实体共现索引、实体+关键词检索、LLM 查询改写、分层摘要维护、重建索引 | ◆ `SearchService.search(query, filters, k)` / `index_source(...)` | M1 |
| **M3** | Agent 编排引擎 | LLM 网关（三角色模型路由、重试、限流）、单章流水线、对话 Agent 与工具调用、SSE 事件协议、后处理异步队列 | ◆ SSE 事件协议 + Pipeline API | M1 M2 |
| **M4** | Skill 系统 | Skill 包加载/校验/注入点分发、预置 Skill、管理 API | ◆ SkillRegistry 接口 | M1 |
| **M5** | 偏好学习 | 事件记录、蒸馏任务、画像读写与版本化、评审权重计算 | ◆ `PreferenceService` | M1（蒸馏调 M3 的 LLM 网关） |
| **M6** | Web API 层 | REST 路由、鉴权(本机 token)、错误规范、OpenAPI 文档、静态托管 | ◆ OpenAPI（M1~M5 的路由装配） | M1~M5 的路由 |
| **M7** | 前端工作台 | 七大模块页面 + 章生成工作台 + Skill 管理 + 偏好档案页 + 划选编辑（Tiptap）+ 命令面板 | ◆ 按 OpenAPI/Mock 契约开发 | M6（前期用 mock） |
| **M8** | 章节后处理 | §5.4 流水线 2~8 步：摘要/抽取/建议消息/大纲对账 | ◆ 建议消息模型（属 M1）+ 队列任务接口 | M1 M2 M3 |

**并行策略**：
- Sprint 0（冻结期）：M1 出 Schema + M6 出 OpenAPI 骨架 + M7 出组件框架与设计令牌迁移 —— 三者合出 ◆ 契约。
- 此后三条并行轨：
  - **轨 A**：M1 → M2 → M8（数据/检索/后处理）
  - **轨 B**：M3 → M4 → M5（Agent 能力）
  - **轨 C**：M7 全程对 Mock Service Worker 开发，M6 路由就绪后逐页对接真实 API
- 联调门：每轨完成时以"空项目全流程冒烟"（对齐 Demo task.txt §五的空项目必过测试）作为集成验收。

---

## 8. API 概览

### 8.1 REST（节选）
```
/projects                       GET|POST          /projects/{id}  GET|PATCH|DELETE
/projects/{id}/outline          GET(树)|POST      /outline/{node_id}  PATCH|DELETE
/projects/{id}/chapters         GET|POST          /chapters/{id}  GET|PATCH(保存草稿)
/chapters/{id}/versions         GET               /chapters/{id}/accept | /reject
/characters, /relations, /foreshadows, /world-entries     标准 CRUD
/foreshadows/{id}/resolve | /unresolve                    伏笔状态操作
/skills                         GET|POST          /skills/{id}  GET|PUT|DELETE|enable
/sessions, /messages            CRUD              /sessions/{id}/chat   POST→SSE
/tasks（生成任务）                GET               /chapters/{id}/generate  POST→SSE
/suggestions（后处理建议，suggestion 标记的对话消息） GET    /suggestions/{id}/approve|dismiss
/preferences/{project_id}       GET|PUT           /preferences/events  GET
/stats/{project_id}             GET（看板/角标统一数据源）
```

### 8.2 SSE 事件协议（◆ 冻结契约）
```
event: thinking        data: {text_delta}                 # 思考过程增量
event: tool_call       data: {id,name,args,status}        # 工具卡片状态机
event: tool_result     data: {id,result}
event: token           data: {text_delta}                 # 正文流式
event: review          data: {评审JSON，见§6.3}
event: done            data: {task_id}
event: error           data: {code,message,resumable}
```

---

## 9. 前端设计（与 Demo 对齐）

### 9.1 信息架构
三栏结构沿用 Demo：书架栏 → 上下文栏（随模块变化）→ 主区；顶栏 = 项目名 + 模块切换 + 实时统计条。视觉令牌、字体分工、纸纹/favicon/书脊封面等质感细节全部从 `前端模板参考` 迁移。

### 9.2 页面清单（8+2）
| 页面 | 要点 |
|---|---|
| 1 书架 | 新建（题材/人称/基调表单）、删除（5 秒撤销 Toast）、空态引导 |
| 2 Agent 对话 | 消息三段结构（思考折叠→工具卡片→正文）、流式光标、停止生成、快捷指令、上下文徽标 |
| 3 正文 | 阅读态（排版规范同 Demo）/ 编辑态（Tiptap）；划选操作条：批注、润色、精简、扩写、改人称、「与 AI 谈这段」；改写对照卡片（采纳/放弃/再来一次） |
| 4 人物关系 | d3-force **实体图**：节点含人物与世界观实体（势力/地点/器物，按类型区分颜色/图标 + 类型过滤），边按关系类型着色虚线、标签描边光晕、拖拽加热；人物节点展开写作导向档案（想要 vs 需要、深层秘密、出场章） |
| 5 大纲与伏笔 | 三级树视图（计划/已写分表呈现）、状态循环切换、伏笔四态+回收率+跨度预警、一致性巡检（真实数据计算的分级问题清单） |
| 6 世界观 | 分类导航 + 卡片网格 + 词条编辑；词条写作引导「什么事不能做，做了会怎样」 |
| 7 时间线+看板 | 多轨横向时间线（轨道开关、锚点分隔、事件跳转）；四种 SVG 图表由统计接口实时驱动 |
| 8 章生成工作台（新增） | 流水线可视化：上下文预览（token 账本）→ 生成 → 评审雷达图与意见 → 接受/驳回（驳回标签）→ 版本对比 |
| 9 Skill 管理（新增） | 列表/启用开关/Markdown 编辑/从预置模板复制 |
| 10 偏好档案（新增） | 画像可视化（喜好/雷区/权重）、事件时间线、手动修正入口 |

### 9.3 全局交互（继承 Demo 必过项）
- **所见即所得编辑**（用户红线）：所有文字内容均可在界面直接修改——正文走 Tiptap 富文本，大纲树节点、人物卡、关系边、伏笔、时间线事件走就地点击编辑，Skill 走 Markdown 编辑器；任何模块不提供只读视图。
- ⌘K 命令面板（跨实体检索）、破坏性操作全部可撤销、每个空态带下一步动作、字数口径唯一、窄屏（<1000px）折叠侧栏。

---

## 10. 开发计划（里程碑）

| 阶段 | 内容 | 交付物 | 验收 |
|---|---|---|---|
| **P0 骨架**（契约冻结） | 工程脚手架、M1 Schema、OpenAPI 骨架、SSE 协议、前端框架+设计令牌 | 可运行的空壳 + 契约文档 | 三方契约评审通过 |
| **P1 无 AI 可用版** | M1/M6 全 CRUD、M7 七模块页面（读写真实数据） | 可手工维护所有数据模块的工作台 | 各模块 CRUD + 统计联动 + 撤销/空态 |
| **P2 检索与生成** | M2 索引/检索、M3 流水线与对话 Agent、章生成工作台 | 端到端跑通一章：检索→生成→人工接受→索引更新 | 空项目冒烟 + 真实项目写一章 |
| **P3 评审与偏好** | 评审 Agent、接受/驳回闭环、M5 偏好学习、后处理建议消息（M8） | 完整单章流水线 + 画像可见可改 | 连续驳回 3 次画像产生可观察变化 |
| **P4 技能与打磨** | M4 Skill 系统、时间线/看板数据接入后处理、一致性巡检、打包启动器 | 全功能版本 | 全量验收清单 |

---

## 11. 风险与决策点（请评审拍板）

| # | 决策点 | 推荐 | 备选与代价 |
|---|---|---|---|
| D1 | 部署形态 | 本地 Web 服务（启动脚本） | Tauri 壳（P4 再议）；纯 Electron（包体大） |
| D2 | 后端语言 | Python + FastAPI | Node/NestJS（与前端同语言，但 LLM 工具链较弱） |
| D3 | 图存储 | 混合实体图：节点表（characters + world_entries）+ 多态边表，应用层遍历（已决策） | Neo4j（仅当未来需要多跳关系推理） |
| D4 | LLM 供应商 | OpenAI 兼容协议三模型分角色配置（供应商不锁定） | 需在配置层给出默认推荐模型（如 writer=DeepSeek/GLM 旗舰，reviewer=同族中档） |
| D5 | 评审时机 | 每次生成自动评审 | 可配置开关（省 token 场景跳过） |

**已决策**：不引入向量库与 embedding 模型 —— 检索采用实体共现索引 + FTS 关键词 + LLM 查询改写（§5.5）。若后续实践中确认关键词召回不足，可经评审重启该议题。

**已决策**：Agent 内核自研薄内核（LiteLLM provider 层 + 手写 tool loop + 确定性流水线编排，见 §6.2），不采用 opencode 等编码 Agent 框架作运行时内核；opencode 可作为本项目的开发期工具。

**主要风险**：
1. **长文一致性**是产品成败核心 —— 缓解：分层摘要 + 上下文账本可视化 + 评审 Agent 专职核对 + 一致性巡检。
2. **上下文超预算**（长篇 100+ 章）—— 缓解：§5.3 分级压缩策略，P4 层只进实体共现命中块。
3. **抽取质量不稳**（实体/关系/伏笔侦测误报）—— 缓解：一律走建议消息人工确认，不直接改正典。
4. **流式中断**（生成中切换页面）—— 缓解：任务状态服务端持久化，前端重连读快照（对齐 Demo「半截消息必须补全或标记」必过项）。
5. **token 成本** —— 缓解：蒸馏类任务用经济模型；评审可配置跳过；摘要分层减少重复喂入。

---

## 附：与前端 Demo 的对齐说明
- Demo 七大模块一一映射到 §9.2 页面 1~7；Demo 的 mock 数据模型（`volumes[].items[]` 计划 vs `chapters[]` 稿件、伏笔四态、章状态五态、六类关系类型、七类世界观分类）直接升格为 §4 正式数据模型。
- Demo 的 Agent 模拟引擎（route/compose 数据驱动、工具卡片、空项目引导分支）是 M3 对话 Agent 的行为规格：真实实现中工具返回值必须同样来自项目真实统计，禁止模板硬编码专名。
- Demo 的验收红线（task.txt §七 禁止清单）转为 M7 前端的验收检查表。
