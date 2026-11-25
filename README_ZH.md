<div align="right">

[English](README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md)

</div>

# Subagent Team Skills

把写代码这件事当成一个**小型软件团队**来运转的 Agent Skills。团队分四层，外加一个尽量少打扰的人：

- **第一层 总管**：一个主 session。拆任务、给每个任务定流程、写契约、集成、提交
- **第二层 内部专家团队**：强模型 subagent。细化设计、负责任务线、审核验收、做专家决策
- **第三层 内部执行团队**：便宜快速的 subagent。实现并测试、独立审核、检索，以及充当外包的**对接人**
- **第四层 外包团队**：通过 CLI、插件、ACP 或 MCP 连接的其他厂商 agent（agy、Codex CLI、OpenCode 等），接需求明确的批量活
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

[四周委派复盘报告](docs/field-report-2026-11-delegation.md)推动了本轮规则改进：高风险任务同时安排内部资深审核与其他厂商的只读评审；实现使用 medium/high effort；按风险预留评审返工时间；对接人收齐结果并执行检查后才能结束；生成的测试还要独立审核其内容。这些单项目观察用于改进流程，不用于给模型排名。

## 支持哪些 agent

兼容性分两层：你用来跑主 session 的**宿主 agent**，以及它能连上的**外包团队**。

宿主 agent：

| Agent | 状态 |
|---|---|
| **Claude Code** | 主推。日常开发使用，以插件形式提供 skills 和两个只读审核 agent。 |
| **Codex** | 次选。真实项目里当过主 session；skills 可以作为插件安装。审核 agent 是 Claude Code 的定义，Codex 下请用 `reviewer-prompt.md`。 |
| 其他（T3 Code、OpenCode、Cursor、agy、Orca、Pi、Gemini CLI、bot 前端等） | T3 Code 经过部分验证（宿主检测与跨厂商子 agent）；OpenCode、Cursor、agy 和 Gemini CLI *未经验证*；Orca、Pi 和 bot 前端*未测试*。skills 遵循开放的 [Agent Skills](https://agentskills.io) 格式，方法本身不绑定工具，所以支持 skills 的 agent 都能安装和加载。请通过 `npx skills` 或你所用 agent 自己的插件 / skill 市场安装，并自行微调 harness 相关的部分。 |

宿主不用你先说：环境检查会根据环境变量给出初步判断，首次使用时再和你确认，并记进项目策略。之后按这个宿主的能力调整团队，例如能不能起 subagent、能不能按 subagent 指定模型和 effort、有没有原生任务列表。

检查还会判断宿主是哪**一类**客户端，并在会话恢复或交接时重新检查。**原厂客户端**（Claude Code、Codex、agy）只能把其他厂商的模型当作外部团队来用：走 ACP，每个任务配一个联络员。**多厂商 harness**（T3 Code、OpenCode、Cursor）本身就能调用多家厂商的模型，所以外部委派改为内部切换模型：起一个使用对方模型的 subagent 或子 agent，不用包装脚本也不用联络员，主管自己的模型永远不切换。如果不好判断（客户端未知、按 subagent 指定模型不可靠、两条路都能走但账号或额度不同），agent 会给出推荐，让你来选。详见[宿主类型](skills/subagent-team/references/host-harness.md)。

外包团队：

| 外包团队 | 接入方式 | 状态 |
|---|---|---|
| **agy**（Google Antigravity） | ACP（`agy acp`，需 agy 1.5.0 及以上），brief 借用 [agy-staff](https://github.com/keli-wen/agy-staff) 的角色设定；print 模式只作为说明风险后的降级方案 | 真实项目中使用。附 ACP 封装脚本，已在 agy 1.5.14 上用只读、写入和续做小任务验证 |
| **Codex CLI** | CLI（`codex exec`），或 OpenAI 为 Claude Code 出的 [Codex 插件](https://github.com/openai/codex-plugin-cc) | CLI 在真实项目中使用，有封装脚本。插件依据其文档和源码整理，用于审核和作为第二通道 |
| **OpenCode** | [ACP](https://opencode.ai/v2/docs/cli/acp/)（`opencode acp`） | 有封装脚本：固定模型和 effort、默认全部拒绝的权限集、超时和续做。已在 OpenCode 2.2.5 上用小任务验证，尚未用于真实项目 |
| Grok Build、Cursor、Pi 以及 [ACP Registry](https://agentclientprotocol.com/get-started/registry) 里的其他 agent | ACP | 尚未用于实际工作。已在 Grok Build 和 Cursor 上验证会话建立。Gemini CLI 已并入 agy，视为弃用，请用 agy。[接入指南](skills/cli-agent-delegation/references/acp-agents.md)借鉴了 [T3 Code](https://github.com/pingdotgg/t3code) 支持多种 agent 的做法，给出准入检查、权限策略和常见陷阱 |
| 其他 CLI，以及通过 MCP 暴露的 agent | CLI / MCP | 未测试。skill 给出接入新 CLI 的检查步骤，先跑一个只读小任务验证再用 |

**优先走 ACP。** 只要外部 agent 有官方 ACP server，就通过它调用；Codex 没有，就用它自己的 CLI。某个任务没法走 ACP 时（比如 agy 版本太旧、没有 `agy acp`），agent 会在派发前告诉你风险。发现 agent CLI 或插件过旧时，它会提出替你升级，你同意后才执行。agy-staff 这类插件贡献的是角色提示词和任务纪律，调用本身仍走 ACP。账号和登录始终归你：不共享、不轮换账号，不使用环境里顺带的 API key，不用社区桥接工具。规则见 [compliance.md](skills/cli-agent-delegation/references/compliance.md)。

**你的外部算力方案保存在本地文件中，而不是存在 agent 的记忆里**。哪个团队 · 模型 · effort 接哪种活（翻译、批量改动、读代码同步、第二意见审核）、各自的降级路线、何时可以使用（仅限工作日、夜间、直到额度在某天到期）、各自的额度以及每项任务的日志（结果、耗时、token、费用，按天和按小时统计），都会为你机器上的所有项目保存在 `~/.subagent-team/` 中；针对单个项目的差异，则保存在被 git 忽略的 `.agent-team/` 里。agent 对此只问**一次**：没有方案时，它会根据检测到的情况和一份最新的模型榜单（OpenRouter 价格加上 LMArena 的 Code Arena 评分）起草一份，让你在一个对话框中确认或修改，并指定保存位置（全局、当前项目或仅本次会话）。此后它会自行按方案路由，并在做出改动时**告知**你（例如你的 CLI 现已支持更新的模型、额度报错后的降级），只要你没反对就直接继续；每隔几天它还会展示方案供你快速过目。之后你提出的每项改动它都只问一句：仅本次会话、当前项目，还是全局？当上榜的新模型在你的 CLI 中缺失时，它会告诉你更新命令，并在运行前询问。详情见 [compute-config.md](skills/subagent-team/references/compute-config.md)。

只要你开口（"Codex 能审这个吗？""加上 OpenCode""别再用 agy 了"），随时可以重新核实并调整团队。每个团队都有降级路线：先换同一团队的其他通道，再换同档位的其他团队，最后收回内部。当某个通道 · 模型额度用尽时，agent 会将其及恢复时间记入额度台账（查不到就问你），沿着降级路线切换；外部全部用尽后再收回内部，待恢复后再切回。如果某个通道额度还很富余，或者额度快到期，它会问你要不要优先消耗。每个外包团队能看到多少代码也由你决定：agent 会逐个团队向你确认保密等级，长期有效的答案存在项目里的一个文件中，默认不进 git，你要求时才纳入版本管理。

### 场景与配置档

每次会话开始时运行 `compute-config.mjs start`，检测当前宿主并加载该宿主自己的方案（切换宿主后不会沿用上一次会话的宿主方案），同时把机器写入的会话状态单独保存在 `compute-state.json`。宿主分为五种**场景**——`vendor-native`、`harness`、`open-router`、`bot`（*未测试*）和 `unknown`——将*派发方式*与*模型所属厂商家族*分开（审核独立性与保密等级仍由厂商家族决定）。详见 [scenarios.md](skills/subagent-team/references/scenarios.md)。

四种内置**配置档**（`performance`、默认 `balanced`、`frugal`、`load-balance`）、基于它们扩展的自定义配置档以及厂商**约束**（`onlyVendors`、`denyVendors`、`inHouseOnly`）共同控制开销、并行度与批量分配顺序，但绝不降低安全底线。只有在你明确声明并登录了多个账号时，才可按你的规则在账号间分摊任务；agent 绝不会自行探测凭据或轮换账号。会话中的临时调整默认仅限当前会话，未经你同意不会提升为持久配置；每 7 天的模型榜单复核通知与每 30 天的"保留 / 调整 / 稍后"偏好检查会合并进会话开始时唯一的一次确认对话。详见 [profiles.md](skills/subagent-team/references/profiles.md)。

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

- **Node.js 22 及以上**（硬性下限，在 Node 22 / 24 上实测通过）。版本更低时，脚本会给出明确提示并拒绝运行。
- **以你自己的 Node.js 为准**：你当前使用的版本，或项目指定的版本（`.nvmrc`、`.node-version`、`volta.node`）只要在 22 及以上，就直接使用。**Node.js 24 及以上**（写在 [`.nvmrc`](.nvmrc) 里）只用于新装，优先用 **nvm** 安装，不想用 nvm 时才装原生版本。如果电脑上没有 Node.js，agent 会先征得你同意，再用 nvm 帮你安装。
- **git**。

核心 skill 在会话开始时会先做一次**环境健康检查**（`env-check.cjs`），报告这几件事：

- 阻塞项和警告，每一条都附上修复命令；
- 宿主 agent 的初步判断（需要你确认）；
- 有哪些外包团队可用：Codex CLI 及其插件、agy 和 agy-staff、OpenCode，`PATH` 上的其他 agent CLI，项目 `.mcp.json` 里的 MCP server；
- 项目里是否已经有团队策略、团队看板和外部算力方案。

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
| [`cli-agent-delegation`](skills/cli-agent-delegation/SKILL.md) | 通过 ACP 外包给 Google Antigravity（`agy acp`，brief 借用 [agy-staff](https://github.com/keli-wen/agy-staff) 的角色设定）和 OpenCode，以及外包给 OpenAI Codex CLI（封装脚本，或 OpenAI 的 Codex 插件）：ACP 优先和合规规则、升级提议、和用户确认用哪些团队、按需重新核实，什么活交给谁，安全封装、降级路线、进度追踪、续做、验收、实测数据；对接人如何有上限地等待；接入 ACP Registry 中其他 ACP agent 的指南，以及接入其他 CLI 或 MCP 的检查步骤 | 把需求明确的批量活交给其他厂商的 agent 时，或想确认有哪些外部 agent 可用时 |
| [`agent-handover`](skills/agent-handover/SKILL.md) | 进度记录、任务卡片和经验记录；规则落进仓库而不是本地记忆；commit hash 占位与回填；决策记录；交出与接手清单 | 验收之后、会话可能中断之前、切换 agent 或工具时、接手别人的工作时 |

Claude Code 插件附带两个审核 agent：

- `team-reviewer`：常规改动，medium effort
- `team-reviewer-deep`：高风险或跨模块改动，high effort

两者靠指令约束为只读，工具集里没有编辑和写文件工具。但为了跑测试保留了 Bash，Bash 仍然可以写文件，所以需要时请对工作区做指纹核对（见 `verification.md`）。

## 辅助脚本

| 脚本 | 作用 |
|---|---|
| `skills/subagent-team/scripts/env-check.cjs` | 会话开始时的环境健康检查，覆盖 Node.js（下限 22、推荐 24 及以上、nvm）、git、宿主 agent 的初步判断、外包团队（Codex CLI 及其插件、agy 及其是否支持 `agy acp`、agy-staff、OpenCode、其他 agent CLI、项目 MCP server）、团队策略（包括是否询问本次用哪些外包团队）和团队看板。用最保守的语法编写，Node 版本过旧时也能运行，并把问题说清楚 |
| `skills/subagent-team/scripts/team-board.mjs` | 团队看板：`init` 生成 `docs/agent-team/` 骨架（从不覆盖已有文件），`new` 新建任务卡片并登记到索引，`set` 同时修改卡片和索引里的状态，`status` 汇总任务状态和待回答的问题，并报告索引、卡片、`lessons.md` 和 `AGENTS.md` 之间的不一致（加 `--strict` 时有任何不一致即失败） |
| `skills/subagent-team/scripts/model-roster.mjs` | 从 OpenRouter 的公开模型列表拉取 Anthropic / OpenAI / Google / DeepSeek 的最新模型，附价格和上下文长度；`--arena` 加入 LMArena 的 Code Arena 排行榜表现（无需 key），`--save` 保存排行供 `compute-config.mjs` 使用。用来把抽象档位映射到当前型号 |
| `skills/subagent-team/scripts/compute-config.mjs` | 本地文件中的算力方案（全局、项目、宿主与会话状态）：`start`（会话开始宿主检查、配置档、`ask[]`/`say[]`）、`show`、`profile`、`account`（用户声明的账号与 `accountQuota`）、`seat`、`host`、`set` / `route` / `schedule`（支持 `--scope session`）、`promote`、`resolve --role <role>`（支持 `--host`、`--profile`、`--count`）、`plan check|render|apply`、`migrate --dry-run`、`quota`、`reviewed`（模型与偏好检查）、`record` 与 `usage`、`check-models`。加锁写入；`.agent-team/` 不进 git |
| `skills/subagent-team/scripts/audit-dispatch.mjs` | 从宿主会话记录中列出本次会话实际跑了什么：每个 subagent 的模型与 effort，以及外包作业。仅限 Claude Code |
| `skills/cli-agent-delegation/scripts/codex-run.mjs` | 封装 `codex exec` 和 `exec resume`。必须显式传 effort；拒绝 `ultra` 和 `danger-full-access`；支持超时；日志和最终回复写到文件；输出带 session id 的 JSON 摘要 |
| `skills/cli-agent-delegation/scripts/agy-acp-run.mjs` | agy 官方 ACP server（`agy acp`）的客户端。`run` 固定模型和思考档位，只读任务用 agy 的 `default` 模式、改动用 `accept-edits`，拒绝所有权限请求，如实报出自己的名字，去掉环境里的 Google 凭据，拒绝 1.5.0 以下的 agy，支持超时和续做，输出 JSON 摘要。`probe` 只做握手；加 `--session-check` 时在空目录里列出模式和模型。与 OpenCode 封装脚本共用 ACP 核心（`acp-core.mjs`） |
| `skills/cli-agent-delegation/scripts/agy-run.mjs` | agy 没有 ACP 时的降级方案：以 print 模式运行 `agy -p`，每次运行都提示这一风险；会校验模型 id；拒绝绕道调用 Claude / GPT 模型；`--write` 对应不受限模式；可以按 conversation id 续做 |
| `skills/cli-agent-delegation/scripts/opencode-acp-run.mjs` | `opencode acp` 的 ACP 客户端。`run` 固定模型和 effort，注入一个 OpenCode agent：除了读取、允许的编辑和白名单里的 shell 命令，一律拒绝；权限请求一律驳回，保证不会卡在等待审批上；支持超时和续做，输出 JSON 摘要。`probe` 不花 token，列出 OpenCode 可用的模型和 effort 档位 |
| `skills/cli-agent-delegation/scripts/doctor.mjs` | 只读的环境报告：CLI 是否安装及版本、Codex 默认 effort 的坑、可用模型、agy-staff（含版本；`--check-updates` 会与最新发布对比）和 Codex 插件、`agy acp` 和 `opencode acp` 是否可用，以及可提议的升级清单和具体命令 |

## 首次使用：约定团队策略

核心 skill 第一次在某个项目里运行时，会先在 `AGENTS.md`（或 `CLAUDE.md`）里找 `## Subagent team` 小节。

如果没有，它会先探测宿主 agent、可用的模型、外包团队和项目里已有的文档，再问你七个简短的问题。每题都带根据探测结果预填的推荐答案，可以一次性全部采纳。答案写进这个小节，之后的会话直接照办，不再重复询问：

1. **宿主 agent**：确认探测结果，并说明这个项目是否还会在其他 agent 里使用。
2. **模型策略**：
   - `auto`（推荐）：主 session 按当时可用的模型，为每个角色自行选定推荐的模型和 effort，并说明选了什么。
   - `fixed`：由你为每个档位指定模型和 effort。
   - `hybrid`：部分角色固定，其余 auto。
3. **消费配置档**（保存在算力方案中，策略小节只保留指针）：`balanced` / `frugal` / `performance` / `load-balance`（旧策略里的 `Cost preference:` 值 `economize` / `max-quality` 会自动映射）。
4. **外包团队**：用哪些、通过什么方式接入（CLI / 插件 / ACP / MCP）、哪些可以改文件、哪些只做审核，以及以后每次会话开始时是否再问一遍用哪些团队。如果你还没有算力方案，同一个对话框还会确认起草好的方案（每个角色的模型和 effort、降级、时间窗口）及保存位置。
5. **团队看板**：推荐 `docs/agent-team/` 加宿主的原生任务列表
6. **不外包的路径与共享文件**：例如计费、支付、鉴权；语言文件、文档索引
7. **提交与推送规则**

这个小节随时可以手工修改。模板与规则见 [project-setup.md](skills/subagent-team/references/project-setup.md)。以后你对流程的调整，会同时更新这个小节，并在 `lessons.md` 里留下记录。

## 开发

```bash
npm test          # 离线单元测试（用假的 codex / agy / opencode 可执行文件和 fixtures）
npm run check     # frontmatter、链接、版本一致、审核 prompt 同步、隐私扫描
```

私有词（项目名、内部域名）写进不入库的 `.privacy-denylist`，一行一个。之后只要仓库里出现这些词，`npm run check` 就会失败。贡献规范见 [AGENTS.md](AGENTS.md)。

## 致谢

- Keli Wen 的 [agy-staff](https://github.com/keli-wen/agy-staff)：本仓库借用了这个 agy 插件的角色设定和任务纪律，它也是封装其他 worker CLI 的好范本。
- [T3 Code](https://github.com/pingdotgg/t3code)：它以 ACP 为先的 provider 设计和账号规则，塑造了接入指南和合规规则。
- [anthropics/skills](https://github.com/anthropics/skills) 与 [Agent Skills 规范](https://agentskills.io/specification)。

## 作者

**Justin** · 𝕏 [@interjc](https://x.com/interjc) · [interjc.net](https://interjc.net) · GitHub [@interjc](https://github.com/interjc)

## 许可

从 v0.3.4 起，本项目采用 [MIT with Commons Clause v1.0](LICENSE) 许可。

- 在遵守许可条款的前提下，允许免费使用、修改和再分发，也允许用于商业工作。
- 不得出售本项目，也不得出售价值全部或主要来自本项目功能的产品或服务；满足这一条件的收费托管、咨询或支持服务也在限制范围内。
- 再分发原版或修改版时，必须保留版权声明、MIT 许可声明和 Commons Clause 声明。

这是源码可用许可，不属于 OSI 批准的开源许可。此前以 MIT 发布的版本仍适用 MIT，本次变更不会撤回已经授予的 MIT 权利。具体以完整许可文本为准。
