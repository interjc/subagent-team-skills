<div align="right">

[English](README.md) | [简体中文](README_ZH.md)

</div>

# Subagent Team Skills

把写代码这件事当成一个**小型软件团队**来运转的 Agent Skills。团队分四层，外加一个尽量少打扰的人：

- **第一层 总管**：一个主 session。拆任务、给每个任务定流程、写契约、集成、提交
- **第二层 内部专家团队**：强模型 subagent。细化设计、负责任务线、审核验收、做专家决策
- **第三层 内部执行团队**：便宜快速的 subagent。实现并测试、独立审核、检索，以及充当外包的**对接人**
- **第四层 外包团队**：通过 CLI、插件或 MCP 连接的其他厂商 agent（agy、Codex CLI 等），接需求明确的批量活
- **人**：到最后一次性问清楚

```
第一层  总管          1 个主 session，高档模型 · high effort        例：Claude Opus 5.5 / GPT-6.1 Sol
第二层  内部专家团队  细化设计、任务线负责人、审核验收、专家决策     例：GPT-6.1 Sol / Claude Opus 5.5 / Claude Fable 5.1
第三层  内部执行团队  实现 + 测试、独立审核、检索、外包对接人         例：Claude Sonnet 5.5 / Claude Haiku 5.5
第四层  外包团队      翻译、批量改写、补测试、第二意见                例：Gemini 4 / Gemini 3.8 Flash（agy）/ GPT-6.1 Sol（Codex CLI）/ DeepSeek 4.1 Flash
人                    收尾时一次性回答一份 grill me 清单
```

*（型号是 2026-10 的举例，skill 正文统一用抽象档位。）*

**层**管职责和决策权，**档位**管模型强弱，两者分开选：第三层的对接人用低档模型，第三层里做高风险实现的人可以用高档模型。内部团队和外包团队都有各自的档位。

这套方法来自作者在多个生产项目里的日常实践，主要用 **Claude Code**，也用 **Codex**。内容包括：

- 怎样像软件工程经理一样拆任务，并给每个任务指定流程（哪些层参与、哪些层跳过）
- 什么活该派出去、派给谁；任务说明怎么写才不返工
- 外包怎样由低档对接人跟踪，只有难题才回到专家或总管
- 怎样用可执行的命令代替模型的「感觉」来验证
- 什么时候才去问人
- 团队状态怎样持久化在项目里，让 `AGENTS.md` 和 `docs/` 互相引用、沉淀经验，随时可以交接

## 支持哪些 agent

兼容性分两层：你用来跑主 session 的**宿主 agent**，以及它能连上的**外包团队**。

宿主 agent：

| Agent | 状态 |
|---|---|
| **Claude Code** | 主推。日常开发使用，以插件形式提供 skills 和两个只读审核 agent。 |
| **Codex** | 次选。真实项目里当过主 session；skills 可以作为插件安装。审核 agent 是 Claude Code 的定义，Codex 下请用 `reviewer-prompt.md`。 |
| 其他（OpenCode、Pi、Cursor、Gemini CLI 等） | 未测试，不保证使用质量。skills 遵循开放的 [Agent Skills](https://agentskills.io) 格式，方法本身不绑定工具，所以支持 skills 的 agent 都能安装和加载。请通过 `npx skills` 或你所用 agent 自己的插件 / skill 市场安装，并自行微调 harness 相关的部分。 |

宿主不用你先说：环境检查会根据环境变量给出初步判断，首次使用时再和你确认，并记进项目策略。之后按这个宿主的能力调整团队，例如能不能起 subagent、能不能按 subagent 指定模型和 effort、有没有原生任务列表。

外包团队：

| 外包团队 | 接入方式 | 状态 |
|---|---|---|
| **agy**（Google Antigravity） | CLI，或 [agy-staff](https://github.com/keli-wen/agy-staff) 插件 | 真实项目中使用，有封装脚本 |
| **Codex CLI** | CLI（`codex exec`） | 真实项目中使用，有封装脚本 |
| OpenCode、Pi、Grok CLI，以及通过 MCP 暴露的 agent | CLI / MCP | 未测试。skill 给出接入新 CLI 的检查步骤，先跑一个只读小任务验证再用 |

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

装完重启 agent。

**环境要求**：方法本身没有任何依赖。可选的辅助脚本也不依赖任何包，但需要：

- **Node.js 18 及以上**（硬性下限，在 Node 18 / 20 / 22 / 24 上实测通过）。版本更低时，脚本会给出明确提示并拒绝运行。
- **Node.js 24**（推荐版本，写在 [`.nvmrc`](.nvmrc) 里）。
- **git**。

核心 skill 在会话开始时会先做一次**环境健康检查**（`env-check.cjs`），报告这几件事：

- 阻塞项和警告，每一条都附上修复命令；
- 宿主 agent 的初步判断（需要你确认）；
- 有哪些外包团队可用：Codex CLI、agy、agy-staff，`PATH` 上的其他 agent CLI，项目 `.mcp.json` 里的 MCP server；
- 项目里是否已经有团队策略和团队看板。

agent 只有在你同意之后才会安装东西，装完会重新检查。如果你不想装，就按文档里写好的替代方案继续。

## 团队怎么运转

**总管给每个任务指定流程**，写在任务卡片上。不需要的层直接跳过，遇到问题时再按需请进来：

| 流程 | 路径 | 适用 |
|---|---|---|
| `solo` | 总管自己做 | 一两个文件、改动显而易见 |
| `direct` | 总管 → 执行 → 总管 | 总管的任务说明已经把所有决定写清楚 |
| `outsource` | 总管 → 对接人 → 外包 → 执行层审核 → 总管 | 需求明确、可用命令验收的批量活 |
| `designed` | 总管 → 专家 → 执行 → 专家验收 → 总管 | 需要细化设计、跨模块或涉及敏感模块 |
| `designed+outsource` | 同上，其中机械性的尾巴由专家冻结规格后外包 | 设计型任务里夹着批量活 |
| `consult` | 总管 → 专家 → 总管 | 只要一个决定，不写代码 |

- **第二层**负责细节：拆子任务、写任务说明、定验收命令。**第三、四层**负责执行和测试，交出真实的验收输出；独立审核人复跑并找风险。集成和提交始终归总管。
- **问题逐层上报**：外包 → 对接人 → 专家 → 总管 → 人。每一层能答就答，答不了再往上；只有人能决定的事（产品取舍、钱、凭据、公开或不可逆操作）才进最后那份 grill me 清单。
- **对接人**是一个低档的内部 subagent，专门盯一个外包任务：派活、有上限地等待、收结果、核对改动范围、跑验收命令，回答任务说明里已有答案的直接问题，做一轮机械返工。需要判断的问题才交给专家或总管，主 session 的上下文不被等待和琐碎核对占用。
- **状态持久化**：宿主有原生机制（例如 Claude Code 的共享任务列表）就用它做实时协作；只要涉及外包、跨会话、严格模式，或者宿主没有原生机制，就把状态写进仓库里的**团队看板**，那里是唯一可信的来源：

```text
docs/agent-team/
├── README.md       # 看板索引：阅读顺序、任务表，链回 AGENTS.md
├── progress.md     # 状态快照、完成日志、待办队列、用户决定、待人回答的问题、坑
├── decisions.md    # 编号决策，只追加不改写
├── lessons.md      # 用户对流程的调整和经验教训，升级为规则的链到 AGENTS.md
└── tasks/<ID>.md   # 每个任务或外包作业一张卡片：流程、持有人（唯一写入者）、租约、日志、问题、结果
```

- **文档互相引用**：`AGENTS.md` 的 `## Subagent team` 小节写团队策略并链到看板，看板链回 `AGENTS.md`。每条规则只有一个归属，其他地方只放链接。你一调整流程，就立即记进 `lessons.md`（带日期和你的原话）；适用于整个项目的规则写进 `AGENTS.md`。

## Skills 一览

| Skill | 内容 | 什么时候加载 |
|---|---|---|
| [`subagent-team`](skills/subagent-team/SKILL.md)（核心） | 宿主 agent 的检测与确认；首次使用时约定团队策略；四层组织与层 / 档位的区分；任务拆分与每个任务的流程；外包准入与对接人；团队看板与 `AGENTS.md` / `docs/` 互相引用；三种模式（单干 / 标准 / 严格）；任务说明模板；可执行验证与三步审核；逐层上报的决策阶梯；agent 复用与槽位限制；Claude Code 与 Codex 的差异 | 任务跨多个文件或阶段；要拆任务、定流程、派活、选模型或 effort、写任务说明、跟踪外包、审核委派结果、记录经验，或者拿不准要不要问用户 |
| [`cli-agent-delegation`](skills/cli-agent-delegation/SKILL.md) | 外包给 Google Antigravity（`agy`，装不装 [agy-staff](https://github.com/keli-wen/agy-staff) 都行）和 OpenAI Codex CLI：两者怎么选、安全封装、进度追踪、续做、验收、实测数据；对接人如何有上限地等待；接入 OpenCode、Pi、Grok 等其他 CLI 或 MCP 的检查步骤 | 把需求明确的批量活交给其他厂商的 agent 时 |
| [`agent-handover`](skills/agent-handover/SKILL.md) | 进度记录、任务卡片和经验记录；规则落进仓库而不是本地记忆；commit hash 占位与回填；决策记录；交出与接手清单 | 验收之后、会话可能中断之前、切换 agent 或工具时、接手别人的工作时 |

Claude Code 插件附带两个审核 agent：

- `team-reviewer`：常规改动，medium effort
- `team-reviewer-deep`：高风险或跨模块改动，high effort

两者靠指令约束为只读，工具集里没有编辑和写文件工具。但为了跑测试保留了 Bash，Bash 仍然可以写文件，所以需要时请对工作区做指纹核对（见 `verification.md`）。

## 辅助脚本

| 脚本 | 作用 |
|---|---|
| `skills/subagent-team/scripts/env-check.cjs` | 会话开始时的环境健康检查，覆盖 Node.js（下限 18、推荐 24）、git、宿主 agent 的初步判断、外包团队（Codex CLI、agy、agy-staff、其他 agent CLI、项目 MCP server）、团队策略和团队看板。用最保守的语法编写，Node 版本过旧时也能运行，并把问题说清楚 |
| `skills/subagent-team/scripts/team-board.mjs` | 团队看板：`init` 生成 `docs/agent-team/` 骨架（从不覆盖已有文件），`new` 新建任务卡片并登记到索引，`status` 汇总任务状态和待回答的问题，并报告索引、卡片和 `AGENTS.md` 之间的不一致 |
| `skills/subagent-team/scripts/model-roster.mjs` | 从 OpenRouter 的公开模型列表拉取 Anthropic / OpenAI / Google / DeepSeek 的最新模型，附价格和上下文长度，用来把抽象档位映射到当前型号 |
| `skills/cli-agent-delegation/scripts/codex-run.mjs` | 封装 `codex exec` 和 `exec resume`。必须显式传 effort；拒绝 `ultra` 和 `danger-full-access`；支持超时；日志和最终回复写到文件；输出带 session id 的 JSON 摘要 |
| `skills/cli-agent-delegation/scripts/agy-run.mjs` | 没装 agy-staff 时直接 headless 调用 `agy`。会校验模型 id；拒绝绕道调用 Claude / GPT 模型；`--write` 对应不受限模式；可以按 conversation id 续做 |
| `skills/cli-agent-delegation/scripts/doctor.mjs` | 只读的环境报告：CLI 是否安装及版本、Codex 默认 effort 的坑、可用模型、agy-staff 是否已安装 |

## 首次使用：约定团队策略

核心 skill 第一次在某个项目里运行时，会先在 `AGENTS.md`（或 `CLAUDE.md`）里找 `## Subagent team` 小节。

如果没有，它会先探测宿主 agent、可用的模型、外包团队和项目里已有的文档，再问你七个简短的问题。每题都带根据探测结果预填的推荐答案，可以一次性全部采纳。答案写进这个小节，之后的会话直接照办，不再重复询问：

1. **宿主 agent**：确认探测结果，并说明这个项目是否还会在其他 agent 里使用。
2. **模型策略**：
   - `auto`（推荐）：主 session 按当时可用的模型，为每个角色自行选定推荐的模型和 effort，并说明选了什么。
   - `fixed`：由你为每个档位指定模型和 effort。
   - `hybrid`：部分角色固定，其余 auto。
3. **成本偏好**：均衡 / 省钱 / 质量优先
4. **外包团队**：用哪些、通过什么方式接入（CLI / 插件 / MCP）、各自哪个模型对应 external-fast 和 external-strong 档位、哪些可以改文件、哪些只做审核
5. **团队看板**：推荐 `docs/agent-team/` 加宿主的原生任务列表
6. **不外包的路径与共享文件**：例如计费、支付、鉴权；语言文件、文档索引
7. **提交与推送规则**

这个小节随时可以手工修改。模板与规则见 [project-setup.md](skills/subagent-team/references/project-setup.md)。以后你对流程的调整，会同时更新这个小节，并在 `lessons.md` 里留下记录。

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
