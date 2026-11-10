# 实验与改造说明

本仓库基于 [luckiest-draw/AiNativeCrm](https://github.com/luckiest-draw/AiNativeCrm) 的 `main`，
在本地完成了一轮**架构对比实验**与**一次性能事故修复**。此目录保存全部实验契约、数据与结论。

## 1. 改了什么（相对上游）

只修改 3 个文件，新增 17 个文件。

| 文件 | 变更 | 作用 |
|---|---|---|
| `lib/ai/agents/workbench-start-job.ts` | +141 / −16 | **性能修复**（租约校验时机）+ 接入协作路由器 + skill 加载 |
| `lib/ai/agents/workbench-events.ts` | +6 / −0 | 新增 `collaboration_mode`、`collaboration_decision`、`read_conflict` 事件类型 |
| `app/api/v1/ai/workbench/runs/route.ts` | +4 / −1 | 模式枚举扩展为 `auto \| skill \| skill_only \| disabled` |

新增模块（含单元测试，共 50 个测试）：

| 模块 | 作用 |
|---|---|
| `collaboration-mode.ts` | 协作模式解析（默认 `auto`，未知值降级） |
| `collaboration-router.ts` | 结构门禁 → 语义分类 → 动态 plan |
| `workbench-skill-signal.ts` | 工作台任务的 skill 触发信号 |
| `workbench-parallel-policy.ts` | fold 模式下何时保留并行子 Agent |
| `read-call-guard.ts` | 完全重复的只读调用拦截 |
| `read-conflict.ts` | 同一实体字段读出不同值的冲突检测 |
| `builtin-skills.ts` | 三个内置 skill（客户事实 / 商机诊断 / 政策依据） |

## 2. 核心结论

| 结论 | 数据 |
|---|---|
| **性能事故修复**：吞吐 6 → 63–124 tok/s | T07 单任务 1214s（超时）→ 91–103s |
| **A/B 架构对比**：质量完全等价，延迟无显著差异 | 各 18/18 通过，pass^3 全过，p95 98s vs 97s |
| **裁决**：保留多 Agent（A），skill 转为可选增强 | 详见 `EXPERIMENT-REPORT.md` |

## 3. 文档

| 文档 | 内容 |
|---|---|
| [`PERF-INVESTIGATION.md`](./PERF-INVESTIGATION.md) | 性能事故完整复盘：六步排查链路、每步实测数据、根因与修复验证 |
| [`EXPERIMENT-REPORT.md`](./EXPERIMENT-REPORT.md) | A/B 三轮 36 次运行的对比报告与裁决依据 |
| [`CONTRACT.md`](./CONTRACT.md) | 实验终态契约（不可变目标、决策、不变量） |
| [`ROADMAP.md`](./ROADMAP.md) | 实施路线与各步退出条件 |
| [`tasks.yaml`](./tasks.yaml) / [`seed.yaml`](./seed.yaml) | 评测任务集与确定性种子数据 |
| [`tasks-README.md`](./tasks-README.md) | 断言语义与判定规则 |

## 4. 跑批框架（`bench/`）

| 脚本 | 作用 |
|---|---|
| `seed.mjs` | 写入确定性种子数据（固定 UUID） |
| `snapshot.mjs` / `reset.mjs` | 数据库快照与重置（约 10 秒，确定性已验证） |
| `run-batch.mjs` | 跑批：任务 × 组 × 轮次，机检断言 + LLM 遥测采集 |
| `judge.mjs` | 聚合与 `pass^k` 计算 |
| `probe-llm.mjs` / `probe-tools.mjs` | 直连 API 延迟对照探针 |
| `results/` | 三轮原始运行记录（round 8/9/10） |

> ⚠️ 脚本中的路径按本地环境硬编码（`D:/workBoddy-pro/...`），换机器需调整。

## 5. 复现要点

```bash
pnpm install --frozen-lockfile
# 按 docs/SETUP.md 配置 Supabase，并执行 supabase/baseline.sql
node scripts/ensure-builtin-agents.ts                  # 创建四个内置 Agent
node --import tsx scripts/ensure-builtin-skills.ts     # 发布三个内置 skill
node bench/seed.mjs && node bench/snapshot.mjs         # 建种子与快照
node bench/run-batch.mjs                               # 跑批
```

首次跑批前需为组织配置模型凭据（DeepSeek / OpenAI 等），详见上游 `docs/SETUP.md`。
