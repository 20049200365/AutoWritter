# M8 章节后处理 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：M1（Repository + 事件总线）、M2（index_source）、M3（蒸馏模型，注入）
> 被依赖：无（产物经 M6 的建议/时间线端点暴露给前端）
> 职责：架构 SPEC §5.4 流水线第 2~8 步：章摘要生成、实体抽取、关系/伏笔/时间线提议、大纲对账、队列编排
> 对外契约：◆ 建议消息模型（属 M1，suggestion 标记的对话消息）+ 队列任务接口

---

## 1. 目标与边界

### 1.1 目标
1. 章节接受后自动跑完后处理流水线，把"新章节"消化进全书数据资产：摘要、出场记录、索引、时间线
2. 一切 AI 推断产物（新关系、伏笔动向、时间线事件、大纲偏差）**只发建议消息，人工采纳才落库**——对齐"人类是创作主导者"
3. 队列可断点恢复、可重试、幂等

### 1.2 边界
- 不做检索索引的切块/FTS 维护（M2 职责，M8 只调 `index_source` 与写 `chunk_entities`）
- **不变更 foreshadows 表**（伏笔边界红线：回收/埋设登记全部由用户操作，M8 只发提议，验收 F5 静态+用例双盯）
- 不直接写 characters/relations/timeline_events——新实体与变更一律走建议消息

---

## 2. 队列与任务编排

### 2.1 触发与状态
- 触发：订阅 M1 事件 `chapter_accepted` → 为该章创建一组 `postprocess_jobs`（六个 step 各一条，status=pending）→ 进程内 asyncio 队列逐个执行
- 状态落库（postprocess_jobs，M1）：每步 running/done/failed 落库；进程重启后扫描 pending/running 任务**断点续跑**
- 重试：单步失败退避重试（默认 3 次），耗尽标 failed 并记 error；失败步不阻塞其他独立步；提供手动重跑入口（经 M6）

### 2.2 步骤依赖
```
summary ─┐
entities ─┼─► relations / foreshadows / timeline / outline_check（可并行）
index(M2) ┘   —— relations/foreshadows/timeline 的判定需要实体结果
```

### 2.3 LLM 依赖注入
与 M2 同款依赖倒置：M8 构造时注入 `distiller: Callable`（走 M3 Provider 层的蒸馏角色模型）；测试注入 FakeDistiller（预录输出），CI 零 API 成本。

### 2.4 重建入口（对齐 M2 §3.4）
M2 `rebuild(project_id)` 需要刷新 chunk_entities 时，调 M8 的实体抽取入口对全量章节重跑抽取（作为重建任务的一部分，同样落 postprocess_jobs、可断点恢复）。

## 3. 各步设计

### 3.1 章摘要（summary）
- 输入：本章全文；输出：≤200 字摘要 → 写 `chapters.summary`
- 质量门：必须含本章出场主角名（规则校验，不满足重试一次）；直接落库（摘要是派生数据，无需人工确认，且用户可在章节编辑里改）

### 3.2 实体抽取（entities）
- 输入：本章切块；输出：每块实体列表（人物/地点/器物）
- 写入：`character_appearances`（人物×章）+ `chunk_entities`（块×实体）——这两张是**事实记录表**（出场与提及），非创作判断，直接落库
- 新人物识别：抽到人物库中不存在的名字 → 转 3.3 建议，不自动建档

### 3.3 关系提议（relations）
- 输入：本章实体 + 现有关系子图；输出：候选新关系/关系变化（含端点、类型建议、依据原文引用）
- 去向：建议消息（type=relation_change）；**不直接写 relations**

### 3.4 伏笔提议（foreshadows）—— 能力边界止于提议
- **埋设发现**：草稿疑似埋了新伏笔 → 建议消息（type=foreshadow_plant），附内容摘要与出处，用户采纳=登记新伏笔
- **回收提议**：某条悬空/已埋伏笔时机适合回收 → 建议消息（type=foreshadow_resolve），采纳=用户指定回收章
- 红线：**本步任何分支都不得 UPDATE foreshadows**（F5）

### 3.5 时间线事件（timeline）
- 输入：本章摘要 + 实体；输出：候选事件（轨道归属自动归类：主线/char:<id>/foreshadow）
- 去向：建议消息（type=timeline_event），采纳=写 timeline_events

### 3.6 大纲对账（outline_check）
- 输入：本章正文 vs 挂载的 L3 节拍；输出：偏差判定（对齐/轻度偏差/严重偏离）+ 说明
- 轻度以上 → 建议消息（提醒改大纲或调整章节挂载，附偏离点）；对齐则静默
- 判定由 LLM 输出结构化 JSON（level + points[]），schema 校验失败重试一次

## 4. 建议消息机制
- **载体**：chat_messages 的 suggestion 标记（M1 已决策，不单设队列表）
- **归属会话**：每项目自动创建一个系统会话「AI 提议」，全部建议消息落此，前端以角标提示待确认数
- **payload 结构**：`{type, title, detail, evidence(原文引用), target(采纳后的写入指令描述)}`
- **采纳流程**：前端调 `/suggestions/{id}/approve`（M6）→ M1 在事务内应用对应写入（建人物/建关系/登记伏笔/建时间线事件）→ suggestion_status=approved；dismiss 则仅标记
- 同类建议去重：同章同 type 同 target 的建议不重复发（幂等，F9）

## 5. 验收标准

> F 系列；F1~F10 用 FakeDistiller 驱动（CI 层：确定性、零成本、每次提交跑），固定样本章（含 3 人物出场、1 处疑似新伏笔、1 处关系变化、与节拍轻度偏离）；F11 为真模型层，贴近真实场景。

| # | 指标 | 判定 |
|---|---|---|
| F1 | **触发完整**：chapter_accepted → 六个 step 全部入队并执行 | 用例 |
| F2 | **摘要质量门**：摘要 ≤200 字且含主角名；构造不含主角名的假输出 → 触发重试 | FakeDistiller |
| F3 | **事实表直写**：出场与提及正确写入 character_appearances / chunk_entities | 样本断言 |
| F4 | **建议消息落位**：关系/伏笔/时间线/对账建议均落「AI 提议」会话且带 suggestion 标记；未采纳前目标表零变更 | 用例 + 查表断言 |
| F5 | **伏笔红线**：流水线全部分支对 foreshadows 表只读；静态检查 M8 代码无该表写操作 | 用例 + 静态检查 |
| F6 | **重试与隔离**：单步失败重试 3 次标 failed，不阻塞其他步；手动重跑生效 | 用例 |
| F7 | **断点恢复**：流水线执行中杀进程 → 重启后续跑，已完成步不重复 | 用例 |
| F8 | **对账判定**：严重偏离样本产出建议；对齐样本静默无误报 | 双样本用例 |
| F9 | **幂等**：同一流水线连跑两次，建议无重复、事实表无重复行 | 用例 |
| F10 | **性能**：FakeDistiller 下单章全流程 < 10s（真模型耗时不计入 CI） | 基准 |
| F11 | **真链路冒烟（真模型，手动触发）**：真蒸馏模型对样本章跑全流程，人工审三样——摘要质量、提议合理性（依据引用是否真的支撑结论）、误报率；结果记入冒烟报告 | 里程碑/发版前各一次 |

> API key 处理：真链路层的 key 由用户提供，存放于项目根目录 `.env`（已被 .gitignore 覆盖；变量名 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / 三角色 LLM_*_MODEL），**永不进代码、不进提交、不进任何文档与记忆**。

---

## 附：与架构 SPEC 的对应关系
- 流水线底稿：架构 §5.4 第 2~8 步（本文 §3 逐步落地）
- 建议机制：架构 §5.4 注记 + M1 chat_messages.suggestion（本文 §4 细化流转）
- 伏笔边界：M3 §3.2/B13 同源规则（本文 F5 专职盯防）
- M2/M8 分工：架构 §5.1/§5.4（切块 FTS 归 M2，实体抽取归 M8）
