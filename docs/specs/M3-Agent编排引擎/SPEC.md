# M3 Agent 编排引擎 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：M1（全部 Repository）、M2（SearchService，输入契约见 §7）
> 被依赖：M4（注入点被本模块调用）、M5（读画像/写事件）、M6（路由）、M8（任务触发）
> 职责：LLM 网关、手写 tool loop、单章生成流水线、改写操作、对话 Agent 与工具集、SSE 流式、异步任务队列
> 对外契约：◆ SSE 事件协议（§5）+ Pipeline API（§3.6）—— P0 冻结项

---

## 1. 目标与边界

### 1.1 目标
1. 实现已决策的**自研薄内核**：Provider 层 + Agent 循环层 + 编排层（架构 SPEC §6.2）
2. 跑通单章流水线：上下文装配 → 写手生成 → 评审打分 → 待决策 → 接受/驳回迭代
3. 提供划选改写能力（润色/精简/扩写/改人称/自由指令）
4. 提供对话 Agent：数据驱动的工具调用，工具返回全部来自项目真实数据
5. 全部流式输出走 SSE，支持停止生成与断线重连

### 1.2 边界（不做的事）
- 不做 Skill 包的加载与管理（M4），只按注入点向 SkillRegistry 索要文本
- 不做偏好蒸馏（M5），只读画像注入 prompt、把接受/驳回事件交给 M5
- 不做索引与检索实现（M2），只调用 SearchService
- 不做 REST 暴露（M6 装配本模块的端点）
- 不做章节接受后的抽取/摘要（M8），只发 `chapter_accepted` 事件

---

## 2. 薄内核三层设计（怎么实现）

### 2.1 Provider 层（llm/provider.py）
| 项 | 设计 |
|---|---|
| 封装 | LiteLLM，OpenAI 兼容协议；三个角色独立配置：`writer` / `reviewer` / `distiller` |
| 配置 | 配置文件声明各角色的 model / base_url / api_key / 温度等；未配置时启动报错并指明缺哪个角色 |
| 流式 | 统一 `stream_chat(role, messages, tools?) -> AsyncIterator[Chunk]`；Chunk 含 delta 文本 / 工具调用增量 / 用量 |
| 重试 | 网络与限流错误指数退避重试（默认 3 次）；内容类错误不重试 |
| 降级口 | Provider 层是唯一接触 LLM SDK 的地方——将来循环层换脚手架，只影响循环层，本层不动 |
| 可测性 | 提供 `FakeProvider`（从 yaml 读预录回复），CI 全流程不依赖真实 API（见 B10） |

### 2.2 Agent 循环层（agent/loop.py）
手写 tool loop，显式状态机：

```
idle → thinking → tool_call → tool_result → thinking → … → done
                                            ↘ error / cancelled
```

| 机制 | 设计 |
|---|---|
| 消息持久化 | 每步落库（chat_messages / generation_tasks），内存态只是缓存 |
| 轮数护栏 | 工具调用最大轮数 `max_tool_rounds`（默认 8）；超限自动终止，产出可读错误摘要 |
| 工具超时 | 单工具执行超时（默认 60s），超时记为工具错误交回模型，连续 2 次同工具超时则终止 |
| 停止生成 | 取消标志位，循环在每步边界检查；已产出的半截内容**保留并标记**，不删除（对齐 Demo 红线） |
| 中断恢复 | 进程重启后，处于进行中的任务/消息被标记为「已中断」，前端可一键续跑或放弃；绝不永久停在半截光标 |
| 流式回调 | 循环以回调吐出增量（thinking delta / tool 状态 / token delta），由上层翻译成 SSE 事件 |

### 2.3 编排层（pipeline/、rewrite/、chat/）
确定性 Python 流水线：**阶段顺序写死，阶段内才允许模型自由发挥**。编排层负责：
- prompt 组装（角色模板 + Skill 注入 + 偏好注入 + 上下文装配结果）
- 阶段间状态落库与流转（generation_tasks.status）
- 评审 JSON 的 schema 校验与失败重试
- 事件发布（经 M1 事件总线）

### 2.4 上下文与会话管理
| 场景 | 机制 |
|---|---|
| 生成上下文 | ContextAssembler 按架构 SPEC §5.3 的 P0~P4 优先级 × 预算装配；每层记入 `context_snapshot` 账本（来源、tokens、优先级、是否被压缩） |
| token 计数 | LiteLLM token_counter；不可用时按中文 1 字 ≈ 1 token 估算，账本标注 `estimated` |
| 超预算压缩 | 仅在逼近预算上限时兜底：从 P4 向 P2 依次减量（原文块 top-K 减半 → 词条减半 → 人物卡只留核心字段）；P0/P1 不压缩；压缩动作记入账本 |
| 对话滚动上下文 | 会话历史超过 `session_token_budget`（默认 8k）时，distiller 把旧消息压缩为一条摘要消息（落库可审计），压缩失败不阻塞对话（降级为截断） |
| 会话隔离 | 生成任务与对话会话各用独立的消息容器与任务记录，物理上不可能串话 |

### 2.5 上下文装配算法（贪心预算法，三场景共用）

```
1. 列候选：每个优先级层按其检索策略取候选片段，逐条实测 token
2. 必装层：最高优先级层（如生成的 P0/P1）全量装入，永不压缩
3. 选装层：其余层按相关性排序依次装入，预算打住为止
4. 超限压缩：选装层溢出时从最低优先级层倒序减量（top-K 减半 → 字段裁剪）；
   必装层本身超预算 → 报 budget_exceeded
5. 记账：每片段记 {来源, 优先级, tokens, 状态[装入|压缩|丢弃]} → context_snapshot
```

> **为什么要逐条测 token**：预算是软上限（默认 128k），但逐片段测量是记账与逼近上限时裁剪的依据（就像装行李箱，先知道每件东西的尺寸才决定装什么、留什么）。测量不是逐字数：每个片段过一次分词器，毫秒级，代价可忽略。

三个装配场景（均在编排层实现，共用上述算法，只是层定义与预算不同）：

| 场景 | 入口 | 层定义 | 默认预算 |
|---|---|---|---|
| 章节生成 | ChapterPipeline.generate | P0~P4（架构 §5.3） | 128k |
| 划选改写 | RewriteService.rewrite | 简化通道：选区+指令直接喂 Agent，不做分层装配（§3.4） | 极小 |
| 大纲/世界观辅助 | 对话工具 draft_outline 等 | O0~O2（§4.3） | 8k |

### 2.6 装配实例：生成一章的端到端走查（查哪张表→拼成什么）

例：玄幻小说写第 5 章「试剑峰会」，大纲节拍="沈听澜携无锋剑赴峰会，北冥阁当众挑衅"，预算 128k（可配，大上下文时代预算是软约束），prior_full_k=3。装配层服务于两阶段（§3.1）：**细纲阶段用 P0~P2；扩充阶段才加 P3/P4，Skill draft 注入仅用于扩充**。全程如下（查询均经 Repository，为直观写成 SQL）：

**第 1 步 · P0 必装（偏好/Skill）**
```
① SELECT likes, dislikes, hard_constraints FROM preference_profile WHERE project_id=1
   → 拼成段落：「用户偏好：喜欢短句；避免大段心理独白；禁止……」
② SELECT filepath FROM skills WHERE enabled=1 AND (scope='global' OR project_id=1)
   → SkillRegistry.render('draft') 返回玄幻写作惯例文本
```

**第 2 步 · P1 必装（本章定位 + 衔接锚点）**
```
④ SELECT * FROM outline_nodes WHERE id=23          ← 本章叶子节点
   沿 parent_id 向上查两级（篇章→卷），各级取 title + summary
   → 拼成：「卷一概要 → 篇章二概要 → 本章节拍：……」
⑤ SELECT text FROM chapters WHERE project_id=1 AND seq=4   → 取末尾 1500 字（衔接锚点）
⑥ SELECT seq, title, summary FROM chapters WHERE seq < 4   → K 章之外的更早章摘要
```

**第 3 步 · P2 必装（前 K 章全文 + 伏笔 + 人物 + 关系子图）**
```
⑥' SELECT seq, title, text FROM chapters WHERE seq IN (2,3,4)
    → 前 K 章全文原文（prior_full_k，默认 3，必装不裁剪）；
      若 P0+P1+P2 已超预算 → 报 budget_exceeded，提示调小 K，不静默裁剪
⑦ SELECT * FROM foreshadows WHERE project_id=1 AND state<>'已回收'
   → 每条一行；planned_resolve_chapter_id=5 的标注「用户指定本章回收」（回收决策来自用户标记，非 AI 判断）
⑧ 确定本章涉及人物：
   SELECT id, name, aliases FROM characters WHERE project_id=1   （人物量小，全表扫）
   Python 中用 name/aliases 对节拍文本做子串匹配 → 命中：沈听澜、北冥阁主
⑨ 一跳关系子图：
   SELECT * FROM relations WHERE project_id=1 AND
     ((src_kind='char' AND src_id IN (命中集)) OR (dst_kind='char' AND dst_id IN (命中集)))
   对 kind='world' 的端点补 SELECT * FROM world_entries WHERE id=<端点id>
   → 沿「隶属」边顺带搜出「听澜剑宗」词条
⑩ 拼人物卡：姓名(定位)/表层动机/深层秘密/关系行（type+对方+label）
```

**第 4 步 · P3 选装（世界观词条）**
```
⑪ SearchService.search(query=节拍文本+人物名, source_types=['world'], k=8)
   → M2 内部：jieba 分词查 chunks_fts（BM25）+ chunk_entities 实体路
   → 命中：无锋剑/北冥阁/试剑峰会
⑫ 每条拼为「词条名：内容」（单条截断 400 字）
```

**第 5 步 · P4 选装（更早原文块）**
```
⑬ SearchService.search(query=本章实体名, source_types=['chapter'], k=10,
                        chapter_range=[1, seq-K-1])   ← 前 K 章已在 P2，不重复检索
⑭ 累计 token 超预算 → k 降为 5（超限压缩，记入账本）
```

**第 6 步 · 拼成最终 prompt**
```
[System] 写手角色设定 + Skill draft 注入（仅扩充阶段）+ 用户偏好
[User]
  ## 本章定位（卷→篇章→节拍） ← ④
  ## 本章细纲（已人工确认）   ← 细纲阶段产物（扩充阶段独有）
  ## 前章结尾              ← ⑤
  ## 更早章节摘要            ← ⑥
  ## 前 K 章全文            ← ⑥'（必装）
  ## 活跃伏笔              ← ⑦
  ## 本章涉及人物与关系     ← ⑩
  ## 相关世界观            ← ⑫
  ## 更早相关原文           ← ⑬
  ## 写作指令（字数目标、章题）
```
细纲阶段的 prompt 即上述去掉 P3/P4、Skill 与细纲段的子集。全程记录写入 context_snapshot：{来源表.字段, 优先级, tokens, 状态}，前端可逐条展开看"本章 AI 看到了什么"。大纲/世界观辅助（O 层）同样走这个流程，只是查的表不同（§4.3）；划选改写走简化通道（§3.4），不做分层装配。

---

## 3. 单章生成流水线

### 3.1 状态机（generation_tasks.status）—— 两阶段生成（已决策）

```
装配中 → 细纲生成中 → 细纲确认中(人工) → 扩写生成中 → 评审中 → 待决策
                                                            ├→ 已接受 ─►（M1 事件 → M8 后处理）
                                                            └→ 已驳回 ─► 回退细纲确认 或 round+1 重扩写
任意阶段可 → 失败（可重试错误标记 resumable）；用户可 skip_plan 直接进入扩写
```

### 3.2 阶段详情
1. **装配中**：ContextAssembler 产出 context_snapshot（细纲/扩充两份账本）；失败 → 任务失败且 resumable
2. **细纲生成中**：writer 模型基于 P0~P2 装配（不含 P3/P4 与 Skill draft）产出**本章细纲**，结构 = 情节节拍（3~6 条，每条一句）+ 涉及实体清单（人物/势力/地点/器物）+ 伏笔段（= 提醒：用户已标记「本章回收」的条目 + 可选的 AI 回收提议，提议必须显式标注）。**Agent 的能力边界止于提议：埋设/回收提议均需用户确认才生效，AI 永不直接变更伏笔状态**；用户确认细纲时保留的提议等同于用户指示，删除的提议视为拒绝；落库 chapters.plan，发 `plan_ready` 事件
3. **细纲确认中**：前端展示细纲供用户**编辑或确认**（所见即所得可改）；确认/修改后落库，进入扩写；用户可选「跳过细纲」直接生成（偏好或紧急场景）
4. **扩写生成中**：writer prompt = P0~P4 全装配 + Skill `draft` 注入 + **已确认细纲** + 写作指令；流式输出草稿，节流落库（默认 500ms）
5. **评审中**：reviewer prompt = 草稿 + 细纲 + 上下文要点 + Skill `review` 注入 + 偏好评审权重；输出 §6.3 契约 JSON；schema 校验失败自动重请一次，再失败 → 任务失败（草稿保留）
6. **待决策 → 已接受**：调 M1 `ChapterRepo.accept` → 发事件；草稿成为正文 v N

### 3.3 驳回与轮次控制
- **驳回分路**：问题在情节方向 → 回退「细纲确认」（改细纲后重扩，同一 round）；仅文笔问题 → 同一细纲直接重扩；无法判断时由驳回标签指定（标签集增加「情节方向不对」）
- 驳回记录 preference_event（经 M5）；重扩 prompt 追加「上轮草稿 + 评审意见 + 驳回反馈」
- `max_rounds`（默认 5）：同一章连续驳回达上限后提示人工介入，不再自动开新轮
- 每轮细纲与草稿独立留档（round），前端可对比任意两轮

### 3.4 改写操作（划选式修改的后端）—— 简化版（已决策）
独立轻量通道 `RewriteService`，不走评审、**不做分层装配**：
```
rewrite(chapter_id, start, end, op[润色|精简|扩写|改人称|自由指令], instruction?)
  → 直接把选中文本 + 操作/指令（+ 用户偏好档案）喂给 Agent
  → SSE 流式返回改写结果 + 原文对照
```
- 简化决策：首期不为改写装配周边上下文（前后段落、文风锚点等），选区直接交给模型；若后续实践中改写质量不足（如与前后文衔接变差），再评估补周边上下文
- 硬性要求（对齐 Demo 红线）：**对任意选中文本必须产出可见变化**，禁止返回"未检测到可改动处"这类空转结果
- 前端拿结果渲染对照卡片（采纳替换 / 放弃 / 再来一次）；采纳=调 M1 更新正文（新版本留档），M3 不直接改库

### 3.5 起草入口
- `draft_from_outline(chapter_id)`：章无正文时，按其 L3 节拍起草（进入 3.1 正常流水线）
- 对话中 `draft_chapter` 工具产出的是**对话内草稿**（不进任务流水线），用户可一键"转入正式生成"

### 3.6 Pipeline API（◆ 冻结契约，供 M6 挂载）
```python
class ChapterPipeline:
    async def generate(self, chapter_id, instruction=None, skip_plan=False,
                       prior_full_k=None) -> AsyncIterator[SseEvent]
    async def confirm_plan(self, task_id, plan_edited=None) -> None   # 确认/修改后的细纲
    async def decide(self, task_id, decision[accept|reject], tags=None, note=None) -> TaskDTO
    async def cancel(self, task_id) -> None
    async def resume(self, task_id) -> AsyncIterator[SseEvent]   # 失败/中断任务续跑

class RewriteService:
    async def rewrite(self, chapter_id, start, end, op, instruction=None) -> AsyncIterator[SseEvent]

class ChatAgent:
    async def chat(self, session_id, user_text) -> AsyncIterator[SseEvent]
    async def stop(self, message_id) -> None
```

---

## 4. 对话 Agent 与工具集

### 4.1 工具清单（function calling 定义）
| 工具 | 入参 | 行为 | 数据源 |
|---|---|---|---|
| `stat_summary` | project_id | 项目统计速览 | M1 StatsService |
| `fetch_chapter` | seq 或 chapter_id，tail? | 取章（可只取结尾 N 字） | M1 ChapterRepo |
| `char_lookup` | name 或 all | 人物档案 + 出场/关系统计 | M1 CharacterRepo/RelationRepo |
| `scan_foreshadow` | status? | 伏笔清单与回收率 | M1 ForeshadowRepo |
| `search_world` | query, category? | 世界观词条检索 | M1 + M2 |
| `search_chunks` | query, k | 原文块混合检索 | M2 SearchService |
| `draft_outline` | instruction | 生成大纲建议（走建议消息，人工采纳） | LLM + M1 |

### 4.2 硬性规则（继承 Demo §五 必过项）
- 所有回复中的专名、数字**必须从项目真实数据读出**，提示词模板禁止硬编码任何作品专名
- **空项目冒烟**：0 章/0 人物/0 伏笔的项目触发全部工具与意图时，走引导分支（说清缺什么、下一步填什么），工具返回如实反映空状态
- 工具调用全程产出工具卡片事件（名称/入参/状态/返回），见 §5

### 4.3 大纲/世界观辅助编写的上下文装配（O 层）
对话式生成大纲、补全世界观时（`draft_outline` 及世界观编写对话）的装配层，预算 8k：

| 层 | 内容 | 取法 |
|---|---|---|
| O0 | 偏好画像 + Skill `outline`/`world` 注入 | 直查 |
| O1 | 现有大纲树整棵（大纲规模通常百级节点，可全量进上下文）+ 全局/卷摘要 | OutlineRepo.subtree |
| O2 | 与用户指令相关的世界观词条 | SearchService.search |

产出物一律走**建议消息**：AI 生成大纲节点/世界观词条建议，人工采纳才写库（经 M1），绝不直接落库；采纳后的节点继承树的排序与层级校验。

两个方向共用同一套 O 层，互为锚点：
- **写大纲时**：O2 的世界观词条提供设定约束（篇章不能和设定打架）
- **写世界观时**：O1 的大纲树提供情节锚点（词条服务于已知剧情）
- **初始化冷启动**：筹备早期 O1/O2 可能都是空的，装配结果只剩 O0（偏好+Skill）——此时对话 Agent 走引导分支（对齐 Demo 空项目必过测试：说清当前缺什么、下一步填什么），而非硬编内容。

---

## 5. SSE 事件协议（◆ 冻结契约）

### 5.1 事件类型（可见性优先：每个阶段的进展与产出都推给前端）
```
event: progress      data: {task_id, stage[装配|细纲|扩写|评审], pct?}   # 阶段切换
event: context_ready data: {task_id, ledger}                  # 装配完成：材料清单+注入的Skill+token账目
event: thinking      data: {task_id, delta}                   # 思考过程增量
event: tool_call     data: {task_id, call_id, name, args, status[calling|done|error]}
event: tool_result   data: {task_id, call_id, result}
event: plan_ready    data: {task_id, plan}                    # 细纲产出，等待人工确认
event: token         data: {task_id, delta}                   # 正文增量
event: review        data: {task_id, review}                  # 评审 JSON（§6.3 契约）
event: snapshot      data: {task_id, status, text, plan?, review?}  # 重连时的全量快照
event: done          data: {task_id}
event: error         data: {task_id, code, message, resumable}
```

**可见性设计（用户红线）**：
- `context_ready` 的 ledger = context_snapshot 的前端版：逐条材料 {来源, 优先级, tokens, 状态[装入|压缩]} + **本次注入的 Skill 清单**（名称+注入点）+ 偏好条目数；前端渲染为"本章 AI 看到了什么"卡片与 Skill 徽标
- Skill 本身不在生成时加载（SkillRegistry 启动/热切换时加载）；生成时发生的是注入，注入事实通过 ledger 可见（对齐验收 B12）
- 工具调用的入参与返回、细纲、评审全部作为事件推达，前端无隐藏环节

### 5.2 流式机制
| 机制 | 设计 |
|---|---|
| 端点 | `POST /chapters/{id}/generate`、`POST /sessions/{id}/chat`、`POST /chapters/{id}/rewrite` → SSE 流（M6 挂载） |
| 增量持久化 | token 增量节流落库（500ms），事件本身不全量存——重连靠"快照 + 续流" |
| 断线重连 | 客户端带 task_id 重连 → 服务端先推当前快照事件 `snapshot{已累积文本/状态}`，再续流；**不重复已送达内容** |
| 停止生成 | `cancel` 置位 → 循环边界检查 → 发 `done{cancelled}`；半截草稿保留并标记 |
| 切换页面 | 任务在服务端继续跑；回到页面时重连读快照（对齐 Demo「半截消息必须补全或标记」） |

### 5.3 错误分类
| code | 含义 | resumable |
|---|---|---|
| provider_error | 模型服务不可用/超时（重试耗尽） | true |
| budget_exceeded | 上下文装配失败 | true |
| review_schema_invalid | 评审输出两次不合契约 | true（草稿在） |
| loop_guard | 工具轮数/超时护栏触发 | false |
| cancelled | 用户取消 | —（可 resume 续跑） |

---

## 6. 依赖输入契约

### 6.1 对 M1 的调用（已冻结，见 M1 spec §4）
SessionRepo / GenerationTaskRepo / ChapterRepo / OutlineRepo / CharacterRepo / RelationRepo / ForeshadowRepo / WorldEntryRepo / StatsService；事件总线发 `chapter_accepted` 等。

### 6.2 对 M2 的输入契约（M2 spec 必须满足）
```python
class SearchService:
    def search(self, query, source_types, project_id, k=10, chapter_range=None) -> list[HitDTO]
        # HitDTO: source_type, source_id, ord, text, score, matched_by[entity|fts|rewrite]
    def entities_of(self, chapter_id) -> list[str]    # 该章涉及实体名，供装配 P4 查询展开
```

### 6.3 对 M4 / M5 的调用
- M4：`SkillRegistry.render(inject_point, project) -> str`（world/outline/draft/review 四注入点）
- M5：`PreferenceService.get_profile(project_id) -> ProfileDTO`（装配 P0 与评审权重）；决策时 `record_decision(event)`

---

## 7. 配置项
```
llm:      writer / reviewer / distiller 各自的 model、base_url、api_key、temperature
budgets:  context_budget=128000（可配置至模型上限）, session_token_budget=8000
guards:   max_tool_rounds=8, tool_timeout_s=60, max_rounds=5
pipeline: prior_full_k=3（前 K 章全文必装）
stream:   flush_interval_ms=500
```

---

## 8. 验收标准

> 测试策略分两层：① 验收用例（B 系列）全部用 FakeProvider 跑——确定性、零成本、离线可跑，验的是机制正确性；② 每个里程碑另跑「真实链路冒烟」：用真实 API key 实际写通一章，验提示词质量与真模型行为（key 由用户提供）。两层缺一不可：只跑 Fake 验不出效果，只跑真模型无法断言、无法高频回归。
> 依赖关系：FakeProvider 与真 Provider 是同一接口的两个实现（§2.1），接口先冻结（P0 契约），上层在真 Provider 就绪前即可全量测试。

| # | 指标 | 判定 |
|---|---|---|
| B1 | **中断恢复**：生成进行到一半杀进程 → 重启后任务被标记「已中断」，可续跑或放弃；没有任何消息永久停在半截无标记状态 | 自动化用例 |
| B2 | **预算压缩**：构造超预算项目（大量词条+长前文）→ 装配按 P4→P2 顺序压缩，账本可逐项查证，P0/P1 未被压缩 | 账本断言 |
| B3 | **循环保护**：FakeProvider 无限发起工具调用 → 第 8 轮自动终止，产出可读错误，不挂死 | 用例 |
| B4 | **重连幂等**：流式中途断开重连 → 收到快照 + 续流，全文拼接与不断线时一致，无重复段落 | 用例 |
| B5 | **会话隔离**：同一项目并发生成任务与对话会话 → 两者的消息与上下文零交叉 | 并发用例 |
| B6 | **数据驱动 + 空项目冒烟**：空项目（0 章/0 人物/0 伏笔）触发全部工具 → 回复不含任何预置专名、走引导分支、工具返回如实报 0 | 对照 Demo §五必过 |
| B7 | **评审契约**：reviewer 输出通过 JSON schema 校验（5 维度分 + issues + 权重说明）；故意给坏 JSON → 自动重请一次后标记失败且草稿保留 | 用例 |
| B8 | **停止生成**：生成中取消 → 发 done{cancelled}，半截草稿留档并标记，可基于它续写或重生成 | 用例 |
| B9 | **驳回迭代**：驳回带标签+意见 → 重扩 prompt 含上轮草稿与反馈；「情节方向不对」回退细纲确认；round 号递增；达 max_rounds 停止自动开轮 | 用例 |
| B13 | **细纲确认与伏笔边界**：细纲伏笔段含用户标记提醒；AI 回收提议必须显式标注「提议」；用户保留的提议进入扩写指令、删除的不生效；AI 输出中不得出现未经标注的既成事实式回收描述 | 用例 |
| B14 | **前 K 章全文**：prior_full_k=3 时第 2~4 章全文装入且账本可证；构造 K 过大超预算 → 报 budget_exceeded 并提示调小 K，不静默裁剪 | 用例 |
| B10 | **离网可测**：全套流水线测试用 FakeProvider 通过，CI 不配置任何真实 API key | CI 配置即证明 |
| B11 | **改写兜底**：对 10 组刁钻选区（短句/纯对话/无修辞）执行四种改写 → 每次均产出可见变化，无「未检测到可改动处」 | 用例 |
| B12 | **Skill/画像注入可见**：账本中可查证 draft 阶段注入了哪些 Skill 段落与偏好条目；Skill 停用后新任务账本不再含该段 | 账本断言 |
| B15 | 日志（架构 §3.4）：流水线阶段切换/SSE 关键事件记 INFO 带 task_id；LLM 调用记模型/耗时/token 用量；草稿仅 text_digest 入日志，不记全文与 key | 用例 + 日志断言 |

---

## 附：与架构 SPEC 的对应关系
- 薄内核决策与三层：架构 §6.2（本文 §2 落地）
- 单章流水线：架构 §2.2（本文 §3 落地）
- 上下文装配 P0~P4：架构 §5.3（本文 §2.4/§3.2 落地）
- SSE 事件底稿：架构 §8.2（本文 §5 细化为冻结契约）
- 评审 JSON 契约：架构 §6.3（本文直接引用）
