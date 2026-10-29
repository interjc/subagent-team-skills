<div align="right">

[English](README.md) | [简体中文](README_ZH.md)

</div>

# Subagent Team Skills

把写代码这件事当成一支**团队**来运转的 Agent Skills。团队由四部分组成：

- **总管**：一个主 session
- **项目经理**：几个强模型
- **员工**：几十个又便宜又快的执行者，包括内部 subagent 和其他厂商的 CLI agent
- **人**：尽量少打扰，到最后一次性问清楚

```
总管        1 个主 session，高档模型 · high effort          例：Claude Opus 5.5 / GPT-6.1 Sol
├── 项目经理  拆分、方案、审核、验收、专家决策               例：GPT-6.1 Sol / Claude Opus 5.5 / Claude Fable 5.1
├── 员工      实现、检索、翻译、补测试                       例：Claude Sonnet 5.5 / Gemini 4 / Gemini 3.8 Flash / DeepSeek 4.1 Flash
└── 人        收尾时一次性回答一份 grill me 清单
```

*（型号是 2026-10 的举例，skill 正文统一用抽象档位。）*

这套方法来自作者在多个生产项目里的日常实践，主要用 **Claude Code**，也用 **Codex**。内容包括：

- 什么活该派出去、派给谁
- 任务说明怎么写才不返工
- 怎样用可执行的命令代替模型的「感觉」来验证
- 什么时候才去问人
- 长时间、多 agent 的工作怎样随时可以交接

## 支持哪些 agent

| Agent | 状态 |
|---|---|
| **Claude Code** | 主推。日常开发使用，以插件形式提供 skills 和两个只读审核 agent。 |
| **Codex** | 次选。真实项目里当过主 session；skills 可以作为插件安装。审核 agent 是 Claude Code 的定义，Codex 下请用 `reviewer-prompt.md`。 |
| 其他（OpenCode、Pi、Cursor、Gemini CLI 等） | 未测试，不保证使用质量。skills 遵循开放的 [Agent Skills](https://agentskills.io) 格式，方法本身不绑定工具，所以支持 skills 的 agent 都能安装和加载。请通过 `npx skills` 或你所用 agent 自己的插件 / skill 市场安装，并自行微调 harness 相关的部分。 |

## 安装

**任意 agent**（通过 [skills CLI](https://github.com/vercel-labs/skills)）：

```bash
npx skills add interjc/subagent-team-skills                               # 全部 skills
npx skills add interjc/subagent-team-skills --skill subagent-team         # 只装核心
```

**Claude Code**（插件，包含三个 skills 和两个只读审核 agent）：

```bash
claude plugin marketplace add interjc/subagent-team-skills
claude plugin install subagent-team@subagent-team-skills
```

也可以在会话里操作：先 `/plugin marketplace add interjc/subagent-team-skills`，再 `/plugin install subagent-team@subagent-team-skills`。这时会打开插件面板，让你选择安装范围。

第三方市场默认不自动更新，更新命令是 `claude plugin marketplace update subagent-team-skills && claude plugin update subagent-team@subagent-team-skills`。

**Codex**：

```bash
codex plugin marketplace add https://github.com/interjc/subagent-team-skills
codex plugin add subagent-team@subagent-team-skills
```

装完重启 agent。辅助脚本只需要 **Node.js 20+**，没有其他依赖。

## Skills 一览

| Skill | 内容 | 什么时候加载 |
|---|---|---|
| [`subagent-team`](skills/subagent-team/SKILL.md)（核心） | 首次使用时约定团队策略（各角色的模型和 effort，或 `auto`）；三种模式（单干 / 标准 / 严格）；团队角色；抽象档位与 effort；外包准入；契约先行的并行开发；任务说明模板；可执行验证与三步审核；以 grill me 清单收尾的决策升级阶梯；agent 复用与槽位限制；Claude Code 与 Codex 的差异 | 任务跨多个文件或阶段；要派活、选模型或 effort、写任务说明、审核委派结果，或者拿不准要不要问用户 |
| [`cli-agent-delegation`](skills/cli-agent-delegation/SKILL.md) | 外包给 Google Antigravity（`agy`，装不装 [agy-staff](https://github.com/keli-wen/agy-staff) 都行）和 OpenAI Codex CLI：两者怎么选、安全封装、进度追踪、续做、验收、实测数据 | 把需求明确的批量活交给其他厂商的 agent 时 |
| [`agent-handover`](skills/agent-handover/SKILL.md) | 进度记录；规则落进仓库而不是本地记忆；commit hash 占位与回填；决策记录；交出与接手清单 | 验收之后、会话可能中断之前、切换 agent 或工具时、接手别人的工作时 |

Claude Code 插件附带两个审核 agent：

- `team-reviewer`：常规改动，medium effort
- `team-reviewer-deep`：高风险或跨模块改动，high effort

两者靠指令约束为只读，工具集里没有编辑和写文件工具。但为了跑测试保留了 Bash，Bash 仍然可以写文件，所以需要时请对工作区做指纹核对（见 `verification.md`）。

## 辅助脚本

| 脚本 | 作用 |
|---|---|
| `skills/subagent-team/scripts/model-roster.mjs` | 从 OpenRouter 的公开模型列表拉取 Anthropic / OpenAI / Google / DeepSeek 的最新模型，附价格和上下文长度，用来把抽象档位映射到当前型号 |
| `skills/cli-agent-delegation/scripts/codex-run.mjs` | 封装 `codex exec` 和 `exec resume`。必须显式传 effort；拒绝 `ultra` 和 `danger-full-access`；支持超时；日志和最终回复写到文件；输出带 session id 的 JSON 摘要 |
| `skills/cli-agent-delegation/scripts/agy-run.mjs` | 没装 agy-staff 时直接 headless 调用 `agy`。会校验模型 id；拒绝绕道调用 Claude / GPT 模型；`--write` 对应不受限模式；可以按 conversation id 续做 |
| `skills/cli-agent-delegation/scripts/doctor.mjs` | 只读的环境报告：CLI 是否安装及版本、Codex 默认 effort 的坑、可用模型、agy-staff 是否已安装 |

## 首次使用：约定团队策略

核心 skill 第一次在某个项目里运行时，会先在 `AGENTS.md`（或 `CLAUDE.md`）里找 `## Subagent team` 小节。

如果没有，它会先探测当前可用的模型和 CLI，再问你五个简短的问题。每题都带推荐答案，可以一次性全部采纳。答案写进这个小节，之后的会话直接照办，不再重复询问：

1. **模型策略**：
   - `auto`（推荐）：主 session 按当时可用的模型，为每个角色自行选定推荐的模型和 effort，并说明选了什么。
   - `fixed`：由你为每个档位指定模型和 effort。
   - `hybrid`：部分角色固定，其余 auto。
2. **成本偏好**：均衡 / 省钱 / 质量优先
3. **外包员工**：agy（装不装 agy-staff 均可）、Codex CLI，或者不用
4. **不外包的路径与共享文件**：例如计费、支付、鉴权；语言文件、文档索引
5. **提交与推送规则**

这个小节随时可以手工修改。模板与规则见 [project-setup.md](skills/subagent-team/references/project-setup.md)。

## 开发

```bash
npm test          # 离线单元测试（用假的 codex / agy 可执行文件和 fixtures）
npm run check     # frontmatter、链接、版本一致、审核 prompt 同步、隐私扫描
```

私有词（项目名、内部域名）写进不入库的 `.privacy-denylist`，一行一个。之后只要仓库里出现这些词，`npm run check` 就会失败。贡献规范见 [AGENTS.md](AGENTS.md)。

## 致谢

- Keli Wen 的 [agy-staff](https://github.com/keli-wen/agy-staff)：本仓库推荐的 agy 插件，也是封装其他 worker CLI 的好范本。
- [anthropics/skills](https://github.com/anthropics/skills) 与 [Agent Skills 规范](https://agentskills.io/specification)。

## 作者

**Justin** · 𝕏 [@interjc](https://x.com/interjc) · [interjc.net](https://interjc.net) · GitHub [@interjc](https://github.com/interjc)

## 许可

[MIT](LICENSE)
