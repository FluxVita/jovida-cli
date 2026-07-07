# jovida-cli

[English](./README.md) · **简体中文**

**Jovida Daily CLI**——在终端、以及在 AI 编码 agent(Codex、Claude Code……,含跑在云端沙盒里的 agent)里捕获和管理 **Jovida Daily** 待办。随仓附带一份 agent **skill**,让 AI 知道何时、如何使用它。

> **内测中。** Jovida Daily 处于私有内测;CLI 需要 Jovida 账号(无匿名模式)。

---

## 给 AI agent:端到端完成安装

**你是一个 AI agent,用户让你安装这个工具。下面每一步都**你自己**跑——别把命令甩给用户,不到 `jovida whoami` 成功不要停。用户**唯一**要做的是在浏览器里点一下「批准」、或打开一条链接。**

> **沙箱注意。** 如果你跑在 home 目录可能不可写 / 不持久的沙箱里,**先**把 CLI 的数据目录指到你的工作区,并对**每一条** `jovida` 命令都用它,这样登录 token 才能留存:
> ```bash
> export JOVIDA_HOME="$PWD/.jovida"
> ```
> (一旦写盘失败,CLI 会提示你正是这么做。登录前设一次即可。)

**1. 安装 CLI**

```bash
npm i -g @fluxvita/jovida-cli
```

**2. 安装 skill** 到用户的 agent(让本机任何 AI 都知道怎么驱动 CLI):

```bash
jovida skill install
```

装进**所有探测到**的 agent。若本机有多个 agent,告诉用户你将为它们全部安装。只装一个:`jovida skill install --agent codex`(可重复 / 逗号分隔;`jovida help skill` 查完整名单)。`--all` 可对所有已知 agent 安装(即使未探测到)。

**如果上面这条命令没给**你自己**装上 skill**——你是平台 / 云端 / 沙盒型 agent、以自己的方式加载 skill、不在支持列表里——别硬套 `install`。自己把 skill 内容放到**你**系统读 skill 的地方(你最清楚自己的约定):

```bash
jovida skill show                  # 打印 skill;读进你的上下文,或:
jovida skill show > <你的-skill-目录>/jovida-cli/SKILL.md
```

**3. 给用户登录。** 把 login 放到**后台**跑,这样你能边转发链接边继续干活:

```bash
jovida login
```

它会立刻打印一条 `https://jovida.ai/jovida-daily/device?code=…` 的 URL(授权码已内置在链接里)并尝试打开用户浏览器。然后:

- **浏览器在用户机器上弹出了**(你是跑在用户电脑上的本地 agent)→ 让用户在那点「批准」。
- **没有弹出浏览器**(你跑在云端沙盒 / 远程机器——你所在的地方没有浏览器)→ 把这条 URL 转给用户,让他在自己的设备上打开并批准。

两种情况,用户批准后命令都会自己结束。**任何情况都别让用户自己去敲 `jovida login`**——CLI 必须跑在**你**所在的机器上(token 要落在你身边),用户只负责批准。

**4. 确认。** 不到这一步成功,不算装完:

```bash
jovida whoami
```

**5. 提议进阶配置(可选,先问再做)。** 安装到此完成;接下来把两件你能顺手配好的事告诉用户,用户想要才动手:

- **终端里的待办提醒** —— 你的宿主若有 statusline 或 prompt hook(Claude Code 就有),`jovida due --brief` 能自动露出逾期/临期待办。配置方法见下文「在终端 / TUI agent 里收到待办提醒」一节(或 `jovida help due`)。
- **导入飞书待办** —— 用户若在用飞书任务,`jovida import lark` 能把未完成任务搬过来(幂等、可反复跑;见 `jovida help import`)。先跑 `--dry-run` 给用户看会导入什么。

此后按 **[`SKILL.md`](./SKILL.md)** 驱动 CLI。会话自动续期;之后任何命令以 `2`(`NOT_SIGNED_IN`)退出,就按第 3 步同样的方式再给用户登录一次。

---

## 这是什么

- **`jovida` 命令** —— 经 HTTPS 操作用户的 Jovida 账号(需登录),**不留本地待办库**,与用户的其他 Jovida 设备同步。
- **`SKILL.md`**(name:`jovida-cli`)—— 可移植的行为指引,教 AI 走**单轨:写即时生效**(无提议/确认步骤;`complete` 可经 `reopen` 撤回,但 `delete` 永久)。

## 快速开始

```bash
jovida create "周五下午6点前交报告" --when 2026-06-12T18:00:00+08:00
jovida list
jovida view <entry_id>
jovida complete <entry_id>
```

- **管道输出自动为 JSON**(供脚本/agent);`--json` / `--no-json` 强制开/关。
- **退出码**:`0` 成功 · `1` 用法 · `2` 未登录 · `3` 后端/网络 · `4` 不存在。

## 命令

`create` · `list` · `due` · `view` · `update` · `complete` · `reopen` · `subtask` · `delete` · `import` · `login` · `logout` · `whoami`。
`jovida help` 列出用法;[`SKILL.md`](./SKILL.md) 说明参数与字段约定。

`jovida import lark` 把你飞书里未完成的「我的任务」单向导入 Jovida(幂等,可反复跑/定时跑;此前导入的任务在飞书完成后,重跑会把 Jovida 侧也标记完成)。数据源走官方 `lark-cli`(`npm i -g @larksuite/cli && lark-cli auth login --domain task`);详见 `jovida help import`。

## 在终端 / TUI agent 里收到待办提醒

`jovida due` 是只读的「当下要紧事」雷达:已逾期的待办 + 截止**或提醒**落在窗口内(默认 24h)的待办。它走本地短时快照缓存(60s;经 CLI 的任何写操作会立即失效),缓存过期后也先用一个极小的版本探测续期、数据真变了才全量重拉,每次输入 / statusline 刷新都调也不心疼。`--brief` 输出单行——无事**输出空**、出错**静默**(exit 0),不会弄脏状态栏。

接进 Claude Code(其他带 hook/statusline 的 TUI agent 同理):

```jsonc
// ~/.claude/settings.json
{
  // statusline:一眼看到临期待办(接在你现有 statusline 命令后面)
  // --ansi = 分层配色(逾期红/时间黄/标题弱化)
  // --link = OSC 8 超链接:支持的终端里这段可 Cmd+点击打开 jovida.ai(Claude Code 的 statusline 透传)
  "statusLine": { "type": "command", "command": "... ; JOVIDA_TIMEOUT_MS=5000 jovida due --brief --ansi --link" },
  // hook:有临期待办时,单行提示注入到你下一条消息的上下文,agent 会在对话里主动提起
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "JOVIDA_TIMEOUT_MS=5000 jovida due --brief", "timeout": 10 } ] }
    ]
  }
}
```

在这些命令里设 `JOVIDA_TIMEOUT_MS`(毫秒),网络异常时不会卡住 TUI。若想在没开 agent 时也收到系统级通知,用 cron/launchd 定时跑 `jovida due --json`,再接你喜欢的通知器。

## 鉴权

`jovida login` 走 **OAuth 设备授权流**:打印一条已内置授权码的 URL(`https://jovida.ai/jovida-daily/device?code=…`),用户在浏览器批准,CLI 随即拿到会话 token,且**自动续期**,除非会话被吊销。无需复制任何 key,也无匿名模式。(上面第 3 步是 agent 如何端到端驱动这套流程,含本机无浏览器的情形。)

## 更新

- **CLI**:`npm i -g @fluxvita/jovida-cli@latest`。(交互式终端里,CLI 还会在有新版时打印提示。)
- **skill**:更新完 CLI 后跑 `jovida skill update`——它重拷随包的 `SKILL.md`,让 agent 认知与已装 CLI 版本同步(同一 npm 包,不漂移)。

## 手动安装(没有 AI agent 时)

如果你是手动安装、而不是通过 AI agent:

```bash
npm i -g @fluxvita/jovida-cli          # 1. 安装(或从源码构建,见下)
jovida skill install                   # 2. 把 skill 装进你的 agent
jovida login                           # 3. 登录——打开浏览器,批准该 CLI
jovida whoami                          # 4. 确认
```

- **从源码构建**(替代 npm):`git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`,再 `jovida --version` 验证。
- **`jovida skill install` 支持的 agent**:Codex、Claude Code、Gemini CLI、Cursor、Windsurf、Continue、OpenCode、Goose、Qwen Code、Crush、KiloCode、Aider、GitHub Copilot(各装在 `<agent 目录>/skills/jovida-cli/`)。不在此列的 agent 用 `jovida skill show`(见第 2 步)。
- **覆盖更多 agent 的替代安装器**——但它从仓库最新拉 skill、不保证与你装的 CLI 版本一致:`npx skills add FluxVita/jovida-cli`。

## skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) —— agent skill(英文 / 中文对照),教 AI 何时、如何使用 CLI。

## 许可

[MIT](./LICENSE) © FluxVita
