# M5 偏好学习 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：M1（PreferenceRepo/GenerationTaskRepo；蒸馏模型经注入）｜ 被依赖：M3（画像注入与事件记录）、M6（路由）、M7（偏好档案页）
> 职责：接受/驳回事件记录、画像蒸馏、画像版本化与手动修正、评审权重计算
> 对外契约：◆ `PreferenceService`（§3，满足 M3 §6.3 调用契约）

---

## 1. 目标与边界

### 1.1 目标
1. 落地架构 SPEC §2.3 的偏好学习闭环：事件层 → 蒸馏层 → 注入层
2. 向 M3 提供 `get_profile`（装配 P0 与评审权重）与 `record_decision`（接受/驳回事件）
3. 画像用户可见、可手动修正、可回滚——手动修正优先于自动蒸馏

### 1.2 边界
- 不做注入动作本身（M3 编排层取画像后拼 prompt）；不做画像页展示（M7）
- 蒸馏用的 LLM 经构造注入（distiller Callable，同 M2/M8 的依赖倒置），测试用 FakeDistiller

## 2. 事件模型

### 2.1 驳回标签体系（前端驳回弹窗选项，与 M3 §3.3 一致）
`节奏问题 / 文风不合 / 逻辑硬伤 / 人物失真 / 情节方向不对 / 偏离大纲` + 自由文本

### 2.2 事件记录
- M3 决策时调 `record_decision(event)`：action(accept/reject)、tags、feedback、task_id → 写 preference_events
- accept 事件附带 style_sample_id = 被接受的 chapter_versions.id（画像 few-shot 正例来源）

### 2.3 蒸馏触发
- 每累计 **5 条**未蒸馏事件触发一次（阈值可配）；蒸馏在后台执行，不阻塞写作
- 蒸馏输入：未蒸馏事件（含驳回标签/反馈、任务评审分）+ 当前画像
- 蒸馏输出（结构化 JSON，schema 校验失败重试一次）：likes/dislikes/hard_constraints 增量、rubric_weights 调整建议、建议引用的正例版本

## 3. PreferenceService 契约（◆ 冻结）

```python
class PreferenceService:
    def __init__(self, uow_factory, distiller: Callable | None = None)

    def record_decision(self, event: DecisionEventDTO) -> None
        # 写事件；达到阈值时调度一次蒸馏任务（异步）

    def get_profile(self, project_id: int) -> ProfileDTO
        # ProfileDTO: likes, dislikes, hard_constraints, style_sample_ids,
        #             rubric_weights, version, source
        # M3 装配 P0 与评审权重时调用

    def update_manual(self, project_id, patch) -> None
        # 用户手动修正：被改字段标 source=manual；version+1 并存 snapshots

    def rollback(self, project_id, version) -> None
        # 从 snapshots 回滚（经 M1 PreferenceRepo.rollback）
```

### 3.1 画像规则
- **手动优先**：`source=manual` 的字段蒸馏不得覆盖，只可追加补充建议（M7 上呈现为"AI 建议"供用户裁决）
- **版本化**：每次画像变更 version+1，旧版存入 snapshots json；M7 可视化并支持回滚
- **硬约束**：同一标签连续驳回 ≥3 次，蒸馏自动升级为 hard_constraints 条目（如"禁止大段心理独白"），M3 写手 prompt 中以禁令形式注入

### 3.2 注入点（由 M3 消费）
| 注入点 | 内容 |
|---|---|
| 写手 prompt（P0） | likes/dislikes/hard_constraints 段落 + style_sample_ids 对应的正例片段（few-shot） |
| 评审 prompt | rubric_weights（维度权重）+ 重点关注项（源自 dislikes） |

## 4. 验收标准

> H 系列；FakeDistiller 驱动，事件序列可编排。

| # | 指标 | 判定 |
|---|---|---|
| H1 | **事件落库**：accept/reject 带 tags+feedback 正确写入；accept 附带 style_sample_id | 用例 |
| H2 | **蒸馏触发**：累计 5 事件触发一次蒸馏，产出画像增量；坏 JSON 重试一次 | FakeDistiller |
| H3 | **手动优先**：manual 字段在后续蒸馏后保持不变；AI 补充以建议形式出现 | 用例 |
| H4 | **版本与回滚**：每次变更 version+1 且 snapshots 留档；rollback 恢复指定版本 | 用例 |
| H5 | **硬约束升级**：同标签连续 3 次驳回 → hard_constraints 出现该条 | 用例 |
| H6 | **注入联动**：get_profile 返回的 rubric_weights 出现在评审 prompt；画像段落出现在装配 P0 账本（联动 M3 B12） | 用例 |
| H7 | **离线可测**：全套用例 FakeDistiller 通过，零 API 依赖 | CI 即证明 |
| H8 | 日志（架构 §3.4）：事件记录/蒸馏触发/手动修正/回滚记 INFO 带 project_id；驳回反馈可记（产品数据），画像内容不全文入日志 | 日志断言 |

---

## 附：与架构 SPEC 的对应关系
- 偏好学习总纲：架构 §2.3（本文落地：事件层 §2 / 画像层 §2.3~§3.1 / 注入层 §3.2）
- 调用方：M3 §6.3（get_profile / record_decision）
- 展示与操作面：M6 §2.7 路由 / M7 页面 10（可视化、手动修正、回滚）
