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
| 超预算压缩 | 从 P4 向 P2 依次减量（原文块 top-K 减半 → 词条减半 → 人物卡只留核心字段）；P0/P1 不压缩；压缩动作记入账本 |
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

三个装配场景（均在编排层实现，共用上述算法，只是层定义与预算不同）：

| 场景 | 入口 | 层定义 | 默认预算 |
|---|---|---|---|
| 章节生成 | ChapterPipeline.generate | P0~P4（架构 §5.3） | 16k |
| 划选改写 | RewriteService.rewrite | R0~R3（§3.4） | 4k |
| 大纲/世界观辅助 | 对话工具 draft_outline 等 | O0~O2（§4.3） | 8k |

---

## 3. 单章生成流水线

### 3.1 状态机（generation_tasks.status）

```
装配中 → 生成中 → 评审中 → 待决策 ─┬→ 已接受 ──►（M1 事件 → M8 后处理）
                                    └→ 已驳回 ──► round+1 新任务（携驳回反馈）
任意阶段可 → 失败（可重试错误标记 resumable）
```

### 3.2 阶段详情
1. **装配中**：ContextAssembler 产出 context_snapshot；失败（如检索服务不可用）→ 任务失败且 resumable
2. **生成中**：writer prompt = 系统角色设定 + Skill `draft` 注入 + 偏好画像段 + 装配上下文 + 本章大纲节拍 + 写作指令；流式输出草稿；每收到增量更新 task.draft_text（节流落库，默认 500ms 一次）
3. **评审中**：reviewer prompt = 草稿 + 上下文要点摘要 + Skill `review` 注入 + 偏好评审权重；要求输出 §6.3 契约 JSON；schema 校验失败自动重请一次，再失败 → 任务失败（草稿保留）
4. **待决策**：前端展示草稿 + 评审；用户接受/驳回
5. **已驳回**：记录 preference_event（经 M5）；用户填驳回标签+意见后，创建 round+1 新任务，prompt 追加「上轮草稿 + 评审意见 + 驳回反馈」作为修改依据
6. **已接受**：调 M1 `ChapterRepo.accept` → 发事件；草稿成为正文 v N

### 3.3 轮次控制
- `max_rounds`（默认 5）：同一章连续驳回达到上限后提示用户人工介入，不再自动开新轮
- 每轮任务独立留档（round 字段），前端可对比任意两轮草稿

### 3.4 改写操作（划选式修改的后端）
独立轻量通道 `RewriteService`，不走评审：
```
rewrite(chapter_id, start, end, op[润色|精简|扩写|改人称|自由指令], instruction?)
  → SSE 流式返回改写结果 + 原文对照
```

**改写上下文装配（R 层，预算 4k，走 §2.5 算法）**：

| 层 | 内容 | 取法 |
|---|---|---|
| R0 | 偏好画像风格段 + Skill `draft` 注入 | 直查 |
| R1 | 选中文本 + 前后各 3 段（~1500 字） | 正文按锚点位置切片 |
| R2 | 章标题 + 开头 ~300 字（文风锚点） | 直查 |
| R3 | 选区涉及人物的卡片 | 选区文本与 characters.name/aliases 精确匹配 |

- 硬性要求（对齐 Demo 红线）：**对任意选中文本必须产出可见变化**；词典式替换命中不了时走结构式兜底（如精简=切除最长修饰从句，润色=重组最长句），禁止返回"未检测到可改动处"
- 前端拿结果渲染对照卡片；采纳=调 M1 更新正文（新版本留档），M3 不直接改库

### 3.5 起草入口
- `draft_from_outline(chapter_id)`：章无正文时，按其 L3 节拍起草（进入 3.1 正常流水线）
- 对话中 `draft_chapter` 工具产出的是**对话内草稿**（不进任务流水线），用户可一键"转入正式生成"

### 3.6 Pipeline API（◆ 冻结契约，供 M6 挂载）
```python
class ChapterPipeline:
    async def generate(self, chapter_id, instruction=None) -> AsyncIterator[SseEvent]
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

---

## 5. SSE 事件协议（◆ 冻结契约）

### 5.1 事件类型
```
event: thinking      data: {task_id, delta}                # 思考过程增量
event: tool_call     data: {task_id, call_id, name, args, status[calling|done|error]}
event: tool_result   data: {task_id, call_id, result}
event: token         data: {task_id, delta}                # 正文增量
event: review        data: {task_id, review}               # 评审 JSON（§6.3 契约）
event: progress      data: {task_id, stage[装配|生成|评审], pct?}
event: done          data: {task_id}
event: error         data: {task_id, code, message, resumable}
```

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
        # HitDTO: source_type, source_id, ord, text, score, matched_by[entity|fts]
    def entities_of(self, chapter_id) -> list[str]    # 该章涉及实体名，供装配 P4 查询展开
```

### 6.3 对 M4 / M5 的调用
- M4：`SkillRegistry.render(inject_point, project) -> str`（world/outline/draft/review 四注入点）
- M5：`PreferenceService.get_profile(project_id) -> ProfileDTO`（装配 P0 与评审权重）；决策时 `record_decision(event)`

---

## 7. 配置项
```
llm:      writer / reviewer / distiller 各自的 model、base_url、api_key、temperature
budgets:  context_budget=16000, session_token_budget=8000
guards:   max_tool_rounds=8, tool_timeout_s=60, max_rounds=5
stream:   flush_interval_ms=500
```

---

## 8. 验收标准

> B 系列；全部可用 FakeProvider 在 CI 跑，不依赖真实 LLM API。

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
| B9 | **驳回迭代**：驳回带标签+意见 → 新轮任务 prompt 含上轮草稿与反馈；round 号递增；达 max_rounds 停止自动开轮 | 用例 |
| B10 | **离网可测**：全套流水线测试用 FakeProvider 通过，CI 不配置任何真实 API key | CI 配置即证明 |
| B11 | **改写兜底**：对 10 组刁钻选区（短句/纯对话/无修辞）执行四种改写 → 每次均产出可见变化，无「未检测到可改动处」 | 用例 |
| B12 | **Skill/画像注入可见**：账本中可查证 draft 阶段注入了哪些 Skill 段落与偏好条目；Skill 停用后新任务账本不再含该段 | 账本断言 |

---

## 附：与架构 SPEC 的对应关系
- 薄内核决策与三层：架构 §6.2（本文 §2 落地）
- 单章流水线：架构 §2.2（本文 §3 落地）
- 上下文装配 P0~P4：架构 §5.3（本文 §2.4/§3.2 落地）
- SSE 事件底稿：架构 §8.2（本文 §5 细化为冻结契约）
- 评审 JSON 契约：架构 §6.3（本文直接引用）
