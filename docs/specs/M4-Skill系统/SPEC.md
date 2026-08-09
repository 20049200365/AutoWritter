# M4 Skill 系统 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：M1（SkillRepo）｜ 被依赖：M3（注入点调用）、M6（管理路由）、M7（管理页）
> 职责：Skill 包加载/校验、四注入点分发、预置 Skill、热切换
> 对外契约：◆ `SkillRegistry`（§3，满足 M3 §6.3 调用契约）

---

## 1. 目标与边界

### 1.1 目标
1. 实现可插拔技能包机制：Skill = 带 frontmatter 的 Markdown 包，用户可见、可编辑、可启用/停用（架构 SPEC §2.1/§6.4）
2. 向 M3 提供 `SkillRegistry.render(inject_point, project) -> str`，四个注入点（world/outline/draft/review）按需装配
3. 内置预置 Skill 模板（玄幻网文/情感/悬疑），用户可复制为自己的 Skill 再改

### 1.2 边界
- 不管注入的时机与位置（M3 编排层决定何时调 render）；不管注入的展示（M3 context_ready 账本 + M7 Skill 徽标）
- Skill 元数据存 M1 skills 表；**正文内容存文件系统**（skills/ 目录，M1 只存 filepath），Markdown 即数据，用户可直接编辑

## 2. Skill 包规范

### 2.1 目录与文件
```
~/.novelstudio/skills/                 # global Skill
{数据目录}/projects/{id}/skills/        # 项目级 Skill
  玄幻网文/
    skill.md        # 主体：frontmatter + 提示词片段
    samples.md      # 可选：few-shot 范文
```

### 2.2 frontmatter 字段
```yaml
name: 玄幻网文        # 必填，scope 内唯一
genre: 玄幻           # 可选，题材标签
version: 1            # 整数，编辑递增
inject_points: [draft, review]   # 必填非空，取值 world/outline/draft/review 子集
```
正文为 Markdown 提示词片段；校验规则由 M1 `SkillRepo.validate_package` 执行（M6 新建/更新时调用），非法包拒绝入库并返回可读错误。

## 3. SkillRegistry 契约（◆ 冻结）

```python
class SkillRegistry:
    def load_all(self) -> None
        # 启动时扫描全部 Skill 包：校验 frontmatter → 缓存正文 → 与 skills 表对账
    def reload(self, skill_id) -> None
        # 热切换：启用/停用/编辑后重载单个包，即时生效（无需重启）
    def render(self, inject_point: str, project_id: int) -> str
        # 返回该注入点的全部注入文本：global + 项目级中 enabled=1 且
        # inject_points 含该注入点的 Skill，按 name 排序拼接，每段带来源标注
    def list_injected(self, inject_point, project_id) -> list[SkillRef]
        # 本次注入的 Skill 清单（名称+注入点），供 M3 写入 context_ready 账本
```

机制要点：
- 拼接顺序：global 在前、项目级在后；各段以 `【Skill：{name}】` 分隔，账本可溯源
- render 是纯读操作，幂等；Skill 正文变更后经 reload 即时生效（G6）
- 空结果返回空串，调用方（M3）按无注入处理，不报错

## 4. 预置 Skill 清单
| 名称 | 题材 | 注入点 | 内容要点 |
|---|---|---|---|
| 玄幻网文 | 玄幻 | draft, review | 修炼体系代价感、突破需铺垫、爽点节奏、称谓规范 |
| 情感 | 日常/情感 | draft, review | 情绪留白、对话潜台词、避免直白抒情 |
| 悬疑 | 悬疑 | draft, outline, review | 线索公平性、误导手法边界、回收节奏 |

预置包随安装提供，标记 `scope=global`；用户"复制为我的 Skill"即拷贝文件 + 建项目级记录。

## 5. 验收标准

> G 系列；基于临时 Skill 包夹具。

| # | 指标 | 判定 |
|---|---|---|
| G1 | **包校验**：缺必填字段/注入点取值非法/重名的包被拒绝，错误可读；合法包入库 | 用例 |
| G2 | **注入点装配**：render('draft', p) 仅含 enabled 且声明 draft 的 Skill；global+项目级合并、顺序正确 | 用例 |
| G3 | **热切换**：停用某 Skill 后，新任务 context_ready 账本不再含该段（联动 M3 B12） | 用例 |
| G4 | **预置模板**：三个预置 Skill 可加载、可校验通过、可复制为项目级 | 冒烟 |
| G5 | **项目隔离**：A 项目的 Skill 不出现在 B 项目的 render 结果中 | 用例 |
| G6 | **即改即生效**：经 M6 API 修改正文 → reload → render 输出为新内容 | 用例 |
| G7 | 日志（架构 §3.4）：Skill 加载/校验失败/热切换记 INFO，带 skill 名称与 project_id | 日志断言 |

---

## 附：与架构 SPEC 的对应关系
- Skill 机制总纲：架构 §2.1 / §6.4（本文落地）
- 注入可见性：M3 §5.1 context_ready（list_injected 供账本）
- 管理面：M6 §2.5 路由 / M7 页面 9
