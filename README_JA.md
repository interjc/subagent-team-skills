<div align="right">

[English](README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md)

</div>

# Subagent Team Skills

コーディング作業を**小さなソフトウェア組織**として動かすための Agent Skills です。組織は 4 つの層と、できるだけ手を煩わせない人間で構成されます。

- **L1 統括**：メインセッション 1 つ。作業を分割し、タスクごとのフローを決め、契約を書き、統合してコミットする
- **L2 社内エキスパート**：強いモデルの subagent。詳細設計、タスクラインの担当、レビューと受け入れ、エキスパート判断
- **L3 社内実行チーム**：安くて速い subagent。実装とテスト、独立レビュー、調査、そして外部チームの**窓口役**
- **L4 外部チーム**：CLI、プラグイン、MCP 経由でつなぐ他社の agent（agy、Codex CLI など）。仕様が固まった大量作業を担当
- **人間**：最後にまとめて一度だけ質問される

```
L1  統括              メインセッション 1 つ、高ティア · high effort       例：Claude Opus 5.5 / GPT-6.1 Sol
L2  社内エキスパート  詳細設計、タスクリード、レビュー、エキスパート判断  例：GPT-6.1 Sol / Claude Opus 5.5 / Claude Fable 5.1
L3  社内実行チーム    実装 + テスト、レビュー、調査、窓口役               例：Claude Sonnet 5.5 / Claude Haiku 5.5
L4  外部チーム        翻訳、一括編集、テストの補充、セカンドオピニオン    例：Gemini 4 / Gemini 3.8 Flash（agy）/ GPT-6.1 Sol（Codex CLI）/ DeepSeek 4.1 Flash
    人間              最後に「grill me」リストへまとめて回答
```

*（モデル名は 2026-10 時点の例です。skill 本文では抽象的なティアを使います。）*

**層**は責任と決定権、**ティア**はモデルの強さを表し、両者は別々に選びます。L3 の窓口役は低ティアで動き、L3 でもリスクの高い実装を担う者は高ティアで動きます。社内チームにも外部チームにもティアがあります。

この方法は、作者が複数の本番プロジェクトで日々行ってきた作業から抽出したもので、主に **Claude Code**、加えて **Codex** で使っています。扱う内容：

- エンジニアリングマネージャーのように作業を分割し、各タスクにフロー（どの層が参加し、どの層を飛ばすか）を与える方法
- 何を誰に任せるか。手戻りしないタスク指示書の書き方
- 低ティアの窓口役が外部作業を追跡し、難しい質問だけがエキスパートや統括に届く仕組み
- モデルの「感覚」ではなくコマンドで検証する方法
- いつ手を止めて人間に聞くか
- チームの状態をプロジェクト内に永続化し、`AGENTS.md` と `docs/` が相互に参照し合いながら教訓を蓄積して、いつでも引き継げるようにする方法

## 対応している agent

互換性は 2 段階あります。メインセッションを動かす**ホスト agent** と、そこからつなげる**外部チーム**です。

ホスト agent：

| Agent | 状況 |
|---|---|
| **Claude Code** | 主対象。日常的に開発・使用。skills と読み取り専用のレビュー agent を含むプラグインとして提供。 |
| **Codex** | 副対象。実プロジェクトでメインセッションとして使用。skills はプラグインとしてインストール可能。レビュー agent は Claude Code 用の定義なので、Codex では `reviewer-prompt.md` を使ってください。 |
| その他（OpenCode、Pi、Cursor、Gemini CLI など） | 未テストで、品質は保証しません。skills はオープンな [Agent Skills](https://agentskills.io) 形式に従い、方法自体もツールに依存しないため、skills に対応した agent ならインストールして読み込めます。`npx skills` か、お使いの agent のプラグイン / skill マーケットプレイスからインストールし、ハーネス固有の部分は各自で調整してください。 |

どのホストを使っているかを先に伝える必要はありません。環境チェックが環境変数から最初の推測を出し、初回利用時にあなたに確認したうえで、プロジェクトのポリシーに記録します。その後チームは、subagent を起動できるか、subagent ごとにモデルと effort を選べるか、ネイティブのタスクリストがあるか、といったホストの能力に合わせて動きます。

外部チーム：

| 外部チーム | 接続方法 | 状況 |
|---|---|---|
| **agy**（Google Antigravity） | CLI、または [agy-staff](https://github.com/keli-wen/agy-staff) プラグイン | 実プロジェクトで使用。ラッパースクリプト同梱 |
| **Codex CLI** | CLI（`codex exec`） | 実プロジェクトで使用。ラッパースクリプト同梱 |
| OpenCode、Pi、Grok CLI、MCP 経由で公開された agent | CLI / MCP | 未テスト。新しい CLI をつなぐためのチェックリストがあり、まず小さな読み取り専用ジョブで検証してから使います |

## インストール

**任意の agent**（[skills CLI](https://github.com/vercel-labs/skills) 経由）：

```bash
npx skills add interjc/subagent-team-skills                               # すべての skills
npx skills add interjc/subagent-team-skills --skill subagent-team         # コアのみ
```

**Claude Code**（プラグイン：3 つの skills と 2 つの読み取り専用レビュー agent）：

```bash
claude plugin marketplace add interjc/subagent-team-skills
claude plugin install subagent-team@subagent-team-skills
```

セッション内で `/plugin marketplace add interjc/subagent-team-skills`、続けて `/plugin install subagent-team@subagent-team-skills` を実行すると、プラグインパネルが開いてインストール範囲を選べます。サードパーティのマーケットプレイスはデフォルトでは自動更新されません。更新は `claude plugin marketplace update subagent-team-skills && claude plugin update subagent-team@subagent-team-skills` で行います。

**Codex**：

```bash
codex plugin marketplace add https://github.com/interjc/subagent-team-skills
codex plugin add subagent-team@subagent-team-skills
```

インストール後は agent を再起動してください。

**動作要件**：方法そのものに依存関係はありません。任意の補助スクリプトもパッケージには依存しませんが、次のものが必要です。

- **Node.js 18 以上**（必須の下限。Node 18 / 20 / 22 / 24 で実測済み）。これより古い場合、スクリプトは明確なメッセージを出して実行を拒否します。
- **Node.js 24**（推奨バージョン。[`.nvmrc`](.nvmrc) に固定）。
- **git**。

セッション開始時、コア skill は**環境ヘルスチェック**（`env-check.cjs`）を実行し、次を報告します。

- ブロッカーと警告、それぞれの修正コマンド
- ホスト agent の推測（あなたの確認が必要）
- 使える外部チーム：Codex CLI、agy、agy-staff、`PATH` 上のその他の agent CLI、プロジェクトの `.mcp.json` にある MCP サーバー
- プロジェクトにチームポリシーとチームボードがすでにあるか

agent は、あなたの同意がある場合にのみ何かをインストールし、その後で再チェックします。断った場合は、文書化された代替手段で続行します。

## チームの動き方

**統括はすべてのタスクにフローを与え**、タスクのカードに書きます。タスクに不要な層は飛ばし、質問が出たときに必要に応じて呼び込みます。

| フロー | 経路 | 使う場面 |
|---|---|---|
| `solo` | 統括が自分でやる | 1〜2 ファイル、変更内容が明らか |
| `direct` | 統括 → 実行 → 統括 | 統括の指示書ですべての判断が済んでいる |
| `outsource` | 統括 → 窓口役 → 外部チーム → 社内レビュー → 統括 | 仕様が固まり、コマンドで受け入れ判定できる大量作業 |
| `designed` | 統括 → エキスパート → 実行 → エキスパートの受け入れ → 統括 | 詳細設計が必要、複数モジュールにまたがる、または機微な領域に触れる |
| `designed+outsource` | 上と同じ。機械的な部分はエキスパートが仕様を凍結して外部に出す | 大量作業を含む設計タスク |
| `consult` | 統括 → エキスパート → 統括 | 判断だけが必要で、コードは書かない |

- **L2** が細部を決めます：サブタスク、指示書、受け入れコマンド。**L3 と L4** が実行とテストを行い、実際の受け入れ結果を提出します。独立レビュアーがそれを再実行し、リスクを探します。統合とコミットは常に統括が行います。
- **質問は一層ずつ上がります**：外部チーム → 窓口役 → エキスパート → 統括 → 人間。各層は答えられるものに答え、残りを上に渡します。人間にしか決められない質問（プロダクト上のトレードオフ、お金、認証情報、公開または不可逆な操作）だけが、最後の grill-me リストに入ります。
- **窓口役**は、1 つの外部ジョブに割り当てられる低ティアの社内 subagent です。ジョブを投入し、上限付きで待ち、結果を回収し、変更が範囲内に収まっているかを確認し、受け入れコマンドを実行します。答えが指示書にすでにある素直な質問には自分で答え、機械的な手直しを 1 回送ります。判断が必要な質問だけがエキスパートや統括に届くので、待ち時間や定型チェックがメインセッションのコンテキストを埋めることはありません。
- **永続的な状態**：ホストにネイティブの仕組み（Claude Code の共有タスクリストなど）があれば、リアルタイムの連携に使います。外部チーム、複数セッション、Strict モードが関わる場合、またはホストにネイティブの仕組みがない場合は、状態をリポジトリ内の**チームボード**に書き、そこを信頼できる唯一の情報源とします。

```text
docs/agent-team/
├── README.md       # ボードの索引：読む順番、タスク表、AGENTS.md へのリンク
├── progress.md     # 状態スナップショット、完了ログ、次のキュー、ユーザーの決定、未回答の質問、落とし穴
├── decisions.md    # 番号付きの決定。追記のみで書き換えない
├── lessons.md      # ユーザーによる調整と教訓。ルールに昇格したものは AGENTS.md へリンク
└── tasks/<ID>.md   # タスクまたは外部ジョブごとのカード：フロー、保持者（唯一の書き手）、リース、ログ、質問、結果
```

- **互いに参照し合うドキュメント**：`AGENTS.md` の `## Subagent team` セクションがチームポリシーを持ち、ボードへリンクします。ボードはそこへリンクを返します。各ルールの置き場所は 1 か所だけで、ほかはすべてリンクで参照します。あなたがプロセスを調整したら、すぐに `lessons.md` に記録し（日付と、あなた自身の言葉で）、プロジェクト全体に関わるルールは `AGENTS.md` に書きます。

## Skills

| Skill | 内容 | 読み込まれる場面 |
|---|---|---|
| [`subagent-team`](skills/subagent-team/SKILL.md)（コア） | ホスト agent の検出と確認、初回のチームポリシー、4 層と層 / ティアの区別、タスク分割とタスクごとのフロー、外注の基準と窓口役、チームボードと `AGENTS.md` / `docs/` の相互参照、モード（solo / standard / strict）、指示書テンプレート、実行可能な検証と 3 段階のレビュー、層ごとのエスカレーション、agent の再利用とスロット制限、Claude Code と Codex の違い | タスクが複数のファイルや段階にまたがるとき。作業の分割、フローの選択、委任、モデルや effort の選択、指示書の作成、外部作業の追跡、委任結果のレビュー、教訓の記録、ユーザーに聞くべきか迷うとき |
| [`cli-agent-delegation`](skills/cli-agent-delegation/SKILL.md) | Google Antigravity（`agy`。[agy-staff](https://github.com/keli-wen/agy-staff) の有無は問わない）と OpenAI Codex CLI への外注：agy と Codex の使い分け、安全なラッパー、追跡、再開、受け入れ、実測データ。窓口役による上限付きの待機。OpenCode、Pi、Grok などの CLI や MCP をつなぐためのチェックリスト | 仕様が固まった大量作業を他社の agent に渡すとき |
| [`agent-handover`](skills/agent-handover/SKILL.md) | 進捗記録、タスクカードと教訓、ローカルメモリではなくリポジトリに置くルール、コミットハッシュのプレースホルダー、決定記録、引き渡しと引き継ぎのチェックリスト | 作業を受け入れた後、セッションが終わりそうなとき、agent やツールを切り替えるとき、他人の作業を引き継ぐとき |

Claude Code プラグインに同梱される agent：`team-reviewer`（通常の変更、medium effort）と `team-reviewer-deep`（リスクの高い変更や複数モジュールにまたがる変更、high effort）。どちらも指示によって読み取り専用とされ、編集や書き込みのツールを持ちません。ただしテストを実行するために Bash は残しており、Bash でもファイルは書けるので、必要に応じて作業ツリーのフィンガープリントを照合してください（`verification.md` を参照）。

## 補助スクリプト

| スクリプト | 用途 |
|---|---|
| `skills/subagent-team/scripts/env-check.cjs` | セッション開始時の環境ヘルスチェック：Node.js（下限 18、推奨 24）、git、ホスト agent の推測、外部チーム（Codex CLI、agy、agy-staff、その他の agent CLI、プロジェクトの MCP サーバー）、プロジェクトのチームポリシーとチームボード。保守的な構文で書かれているため、古い Node でも動作して問題を説明できます。 |
| `skills/subagent-team/scripts/team-board.mjs` | チームボード：`init` は `docs/agent-team/` の骨格を作り（既存ファイルは上書きしない）、`new` はタスクカードとその索引行を追加し、`status` はタスクの状態と未回答の質問を集計して、索引・カード・`AGENTS.md` の食い違いを報告します。 |
| `skills/subagent-team/scripts/model-roster.mjs` | OpenRouter の公開モデル一覧から、Anthropic / OpenAI / Google / DeepSeek の最新モデルを価格とコンテキスト長付きで一覧表示します。抽象ティアを現在のモデルに対応づけるのに使います。 |
| `skills/cli-agent-delegation/scripts/codex-run.mjs` | `codex exec` / `exec resume` を、effort の明示指定を必須にして実行します。`ultra` と `danger-full-access` を拒否し、タイムアウトに対応し、ログと最終回答をファイルに書き、session id 付きの JSON サマリーを出力します。 |
| `skills/cli-agent-delegation/scripts/agy-run.mjs` | agy-staff プラグインがない場合に `agy` をヘッドレスで実行します。モデル id を検証し、Claude / GPT モデルへの回り道を拒否し、`--write` を制限なしモードに対応させ、conversation id による継続に対応します。 |
| `skills/cli-agent-delegation/scripts/doctor.mjs` | 読み取り専用の環境レポート：CLI の有無とバージョン、Codex のデフォルト effort の落とし穴、使えるモデル、agy-staff のインストール状況。 |

## 初回利用：チームポリシーを決める

コア skill がプロジェクトで初めて動くとき、`AGENTS.md`（または `CLAUDE.md`）の中に `## Subagent team` セクションを探します。

なければ、ホスト agent、使えるモデル、外部チーム、プロジェクトにある既存のドキュメントを検出したうえで、7 つの短い質問をします。各質問には検出結果から事前入力した推奨回答が付いており、まとめて一度に受け入れることもできます。回答はそのセクションに書き込まれ、以後のセッションは改めて聞かずにそれに従います。

1. **ホスト agent**：検出結果を確認し、このプロジェクトを他の agent からも使うかどうかを答えます。
2. **モデルポリシー**：
   - `auto`（推奨）：メインセッションが、その時点で使えるモデルから役割ごとに推奨のモデルと effort を選び、何を選んだかを伝えます。
   - `fixed`：すべてのティアについて、あなたがモデルと effort を指定します。
   - `hybrid`：一部の役割は固定、残りは auto。
3. **コストの方針**：バランス / 節約 / 品質優先。
4. **外部チーム**：どれを使うか、どの方法（CLI / プラグイン / MCP）でつなぐか、それぞれどのモデルが external-fast と external-strong のティアを担うか、どれがファイルを編集してよく、どれがレビューのみか。
5. **チームボード**：`docs/agent-team/` とホストのネイティブなタスクリストの併用を推奨します。
6. **外注しないパスと共有ファイル**：例として、課金・決済・認証のパス、言語ファイルやドキュメント索引。
7. **コミットとプッシュのルール**。

このセクションはいつでも手で編集できます。テンプレートとルール：[project-setup.md](skills/subagent-team/references/project-setup.md)。後であなたがプロセスを調整すると、このセクションが更新され、その変更が `lessons.md` に記録されます。

## 開発

```bash
npm test          # オフラインのユニットテスト（偽の codex / agy 実行ファイルと fixtures）
npm run check     # frontmatter、リンク、バージョンの一致、レビュー prompt の同期、プライバシースキャン
```

非公開にしたい語（プロジェクト名、内部ホスト名）は、追跡されない `.privacy-denylist` に 1 行に 1 つずつ書きます。以後、それらがリポジトリに現れると `npm run check` が失敗します。コントリビューターのルール：[AGENTS.md](AGENTS.md)。

## 謝辞

- Keli Wen による [agy-staff](https://github.com/keli-wen/agy-staff)：このリポジトリが推奨する agy プラグインで、他のワーカー CLI をラップする際のお手本でもあります。
- [anthropics/skills](https://github.com/anthropics/skills) と [Agent Skills 仕様](https://agentskills.io/specification)。

## 作者

**Justin** · 𝕏 [@interjc](https://x.com/interjc) · [interjc.net](https://interjc.net) · GitHub [@interjc](https://github.com/interjc)

## ライセンス

[MIT](LICENSE)
