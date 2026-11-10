# 路线图 · 到达终态契约的路径

> 本文件是**路线**，不是契约。目标不可变内容见 [`CONTRACT.md`](./CONTRACT.md)。
> 每一步的"退出条件"必须先满足，才能进入下一步；不满足就停在这里，不跳步。

- 对应契约：`v1.0.0`
- 当前进度：**A/B 对比实验完成（三轮 × 6 任务）→ 裁决保留 A**（见 EXPERIMENT-REPORT.md）；性能事故已修复（6→102 tok/s，见 PERF-INVESTIGATION.md）
- 已知环境补丁：`bench/migrations/001_workbench_event_types.sql`（事件类型白名单，不带它 job 会直接失败）

---

## 总览

| 步骤 | 内容 | 状态 | 阻塞下一步 |
|---|---|---|---|
| S0 | 基线冻结与现状盘点 | 部分完成（环境/数据已固化，git 基线待定） | 是 |
| S1 | 任务集（YAML + 断言 + 种子数据） | 初稿完成，**待用户复核** | 是 |
| S2 | 数据库快照与重置 | **已完成**（快照 123 行 / 重置 6–9s / 确定性已验证） | 是 |
| S3 | 运行模式开关（A/B） | **已完成**（默认 auto；`skill` 待 S4 接 skill 加载） | 是 |
| S4 | B 组 fold 实现（skill 化） | **已完成**：信号源 / 渐进式加载 / 3 个 skill / 播种 / 并行保留 / 重复读拦截 / 冲突检测；references 与 claims 见下方说明 | 是 |
| S5 | 跑批执行器与数据采集 | **已完成**（36 次运行，机检断言 + LLM 遥测） | 是 |
| S6 | 评测报告与决策 | **已完成**（EXPERIMENT-REPORT.md，裁决：保留 A） | — |
| S7 | （实验后）群聊准入 admission | 排除在当前契约外 | — |

---

## S0 · 基线冻结与现状盘点

**目标**：把"实验开始前"的状态钉死，任何后续差异都能归因。

**产出**
1. 上游 commit 哈希 + 本地改动清单（当前：源码解压包，非 git 仓库 —— 需确认以哪个 commit 为基线）
2. 依赖版本快照（`pnpm-lock.yaml` 哈希）
3. 环境快照：Node / pnpm 版本、`.env.local` 键名清单（不含值）
4. A 组行为基线：现有 `OPPORTUNITY_REVIEW_PLAN` 的触发条件、预算、工具白名单抄录

**退出条件**
- 能回答"这条结论是在哪个 commit、哪个依赖版本、哪个模型下得出的"

**风险**
- 当前是源码 tar 解压，不是 git clone → 无法精确追溯。建议重新以 `git clone` 建立基线，或在 S0 里补建 git 仓库并提交当前状态。

---

## S1 · 任务集（地基，最重要）

**目标**：产出可机检、可复现、用户已复核的评测任务。详见契约 §6-2。

**产出**
- `tasks/*.yaml`：8–12 条，按 CRM-Agent-Bench 契约格式
- 每条含：`instruction`、`capabilities`、`expected_actions`、`expected_args`、`expected_order`、`expected_state`、`forbidden_state`、`forbidden_actions`、`expected_response_semantic`
- 种子数据：任务执行前数据库应处于的确定状态
- 覆盖矩阵：只读调查 / 写操作 / 需并行调查 / 需审批的外部动作，四类各至少 2 条

**硬约束**
- 不得复用 `builtins.ts` 已有 12 场景（I5）
- 断言必须是**机器可判**；只有 `expected_response_semantic` 允许模型判
- 写操作类任务必须同时有 `forbidden_state`（证明没误伤别的记录）

**退出条件**
- 用户逐条复核通过并签字（写入 CONTRACT §9 的配套记录）
- 任务体量估算：单任务预期工具调用 ≤ 该 agent 的 `maxSteps`

**风险**
- 断言写太松 → 两组都满分，无法区分；写太严 → 两组都零分，同样无法区分。S1 完成后应先用 A 组试跑 1 次确认"有区分度空间"。

---

## S2 · 数据库快照与重置

**目标**：每次 trial 从同一状态开始。见契约 I2。

**产出**
1. 种子快照的 dump（仅 `public` schema）
2. 重置脚本：`DROP SCHEMA public CASCADE` → 重建 → 恢复 → 重新授权
3. 一致性自检：表 188 / 函数 436 / RLS 550，对不上则中止
4. 验证：连续两次重置后，关键表的行数与内容哈希一致

**退出条件**
- 连续 3 次"重置→跑一条最小任务→重置"，第二次起数据完全一致
- 单次重置耗时记录在册（用于估算总实验时长）

**风险**
- 恢复后未重新授权 → RLS 全挂，表现为所有查询空结果（不是报错），极易误判为"模型不干活"
- `DROP SCHEMA` 需级联，注意别把 `auth` 相关对象一起带掉

---

## S3 · 运行模式开关（A/B）

**目标**：一个仓库内可切换两种模式。见契约 D1。

**产出**
1. 模式枚举：`collaboration_mode = subagent | skill`（外加实验用的 `off` 便于对照）
2. 配置来源：组织级默认 + 单次 run 覆盖
3. run 元数据写入模式标记，事件流可归因
4. 开关默认值：保持现状（`subagent`），确保不影响既有行为

**退出条件**
- 同一任务在两模式下都能跑通，且元数据能正确区分
- 关闭开关时，A 组行为与改动前逐字节等价（回归验证）

**风险**
- 开关放在错误层级（例如放在 specialist 内部）会导致 A 组行为漂移 → 必须做 A 组回归

---

## S4 · B 组 fold 实现

**目标**：specialist 专长变 skill，主循环内联；保留真正需要并行的分支。见契约 D8/D9。

**已完成（含对应文件）**

| 子项 | 实现 | 验证 |
|---|---|---|
| 信号源改造 | `lib/ai/agents/workbench-skill-signal.ts`（任务文本 + `#agente:` + `#objeto:`） | 7 单测 |
| 渐进式加载 | `workbench-start-job.ts`：索引进 system prompt 前缀，命中正文进 user 后缀 | 类型检查 |
| 三个 skill | `lib/ai/agents/builtin-skills.ts`（21–25 行/个） | 已发布到 DB |
| 播种 | `scripts/ensure-builtin-skills.ts`（平台级、版本不可变、指纹比对） | 幂等已验证 |
| 并行保留 | `lib/ai/agents/workbench-parallel-policy.ts`（跨对象盘点才并行） | 6 单测 |
| 重复读拦截 | `lib/ai/agents/read-call-guard.ts`（同工具+同参数才算重复） | 8 单测 |
| 冲突检测 | `lib/ai/agents/read-conflict.ts` + `read_conflict` 事件 | 8 单测 |
| 命中校验 | `scripts/check-skill-match.ts`（真实任务集跑 matcher） | 10 任务 6 命中 |

**两项的处置（不是遗漏，是决定）**

- **references 按需读取**：内置三个 skill 的正文只有 21–25 行，刻意不挂 references（`manifest: []`）。
  运行时的 `read_skill_reference` 工具在入站链路已存在且按 manifest 门控；工作台路径未接入。
  若将来某个 skill 需要外挂文档，再补 manifest + storage + 工具暴露，不影响当前实验。
- **证据契约（结构化 claims）**：已核实评测的 `knowledge_grounding` 直接读
  `runtimeMessages` 里的 `crm_search_knowledge` 工具消息（`evaluate-run.ts:209`），
  **与架构无关**，A/B 同等对待；claims 只服务于 `collaboration_quality`，
  而该维度已按契约 I9 排除出跨组比较。因此 fold 模式不需要另造 claims。

**产出**
1. 三个 skill 包（对应 `customer_evidence` / `opportunity_diagnosis` / `policy_advisor`），每个：frontmatter（name/description/matcher）+ 正文 ≤200 行 + references
2. **信号源改造**：当前 `latestInboundSignal()` 只取最后一条 inbound 消息，工作台任务永不命中 —— 必须扩展为「任务文本 + 对象类型」
3. 渐进式加载：索引常驻 → 命中正文 → references 按需读取（需补"读取 reference"的运行时能力）
4. 保留分支：独立调查类任务仍走并行子 Agent，触发条件需显式定义并写入配置
5. 工具纪律：把"每类只读工具最多一次"从 prompt 移到**工具层计数**
6. 证据契约：主循环显式产出结构化 claims（复用现有 `AgentEvidenceClaim` 结构）
7. 冲突检测重写：原语义是 specialist 之间比对，fold 后改为"同一对象两次读取结果不一致"

**退出条件**
- 零命中时回退主 Agent 自由执行（D9），且该路径有测试
- 保留的并行分支有测试证明其确实并行
- references 能被模型真实读取（非仅存储）

**风险**
- 信号源改造是最大的隐性工作量（现有匹配器为 WhatsApp 入站场景设计）
- 预算：`modelBudgetShare: 0.55` 的前提消失，需重新分配并记录

---

## S5 · 跑批执行器与数据采集

**目标**：按契约 I1/I3 执行两组实验，产出可复算的数据。

**产出**
1. 执行器：`任务 × 模式 × trials` 笛卡尔积；顺序随机化
2. 每 trial：重置（S2）→ 投喂 → 采集轨迹/事件/成本/延迟 → 判定 strict success
3. 断言执行器：机检 `expected_*` / `forbidden_*`，语义项调用**不同模型**的评审（I4）
4. 原始数据落盘：不覆盖、不聚合，保留每条 trial 的完整证据
5. 剔除日志：仅基础设施故障可剔除，逐条记录（I8）

**退出条件**
- 随机抽 3 条 trial 人工重放，结论一致
- 同一任务重复跑的判定结果稳定（判定器本身无随机性）

**风险**
- 长跑中途失败会留下半套数据 → 需支持断点续跑，且续跑不改变任务顺序语义

---

## S6 · 评测报告与决策

**目标**：按契约 §5 给出结论并决定保留哪种模式。

**产出**
1. 报告：strict success（含 pass^1..4）、成本、延迟、工具准确率、护栏分、剔除清单
2. 共同指标对比表（I9）——**禁用加权总分**
3. 用户 30 对盲评结果
4. 依 §5 的裁决；若落入 ±3pp 且成本差 <25%，明确标注"需用户裁决"并附理由

**退出条件**
- 报告中的每个数字都能从落盘原始数据复算
- 决策依据与契约 §5 逐条对应

---

## S7 · （排除）群聊准入 admission

契约 §8 明确排除。A/B 完成后若需要，另起契约。届时参考 `dsh-superagent-prototype` 的两层结构（准入矩阵 + 三事实评估），默认 `observe` 运行，先比对"它判该建单"与"人实际想要的"。

---

## 依赖关系

```
S0 ──> S1 ──> S2 ──> S3 ──> S4 ──> S5 ──> S6
                 └────────────────────────> S5（S2 可先于 S3 完成）
```

- S1 与 S2 可并行推进（任务集设计 与 快照脚本互不依赖）
- S4 开始前 S3 必须完成（否则无法隔离两模式）
- S5 开始前 S1/S2/S3/S4 全部完成

## 关键风险汇总

| 风险 | 影响 | 缓解 |
|---|---|---|
| 任务集无区分度 | 实验白跑 | S1 后用 A 组试跑确认分数未打满/未归零 |
| DB 重置不干净 | 结论不可信 | S2 的连续重置一致性验证 |
| 信号源改造被低估 | S4 延期 | 单独列为 S4 的第 2 项，可先做可测 |
| 评测器与被测同模型 | 自偏好 | 契约 I4 |
| 中途改题/改判据 | 数据作废 | 契约 I6 + §9 变更流程 |
