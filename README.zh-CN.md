# jovida-cli

[English](./README.md) · **简体中文**

**Jovida Daily CLI**——在终端、以及在 AI 编码 agent(Codex、Claude Code、云端沙盒……)里捕获和管理你的 **Jovida Daily** 待办。随仓附带一份 agent **skill**,让 AI 知道何时、如何使用它。

> **内测中。** Jovida Daily 处于私有内测;CLI 需要 Jovida 账号(无匿名模式)。

---

## 给 AI agent:端到端完成安装

**你是一个 AI agent,用户让你安装这个工具。下面每一步都**你自己**跑——别把命令甩给用户,不到 `jovida whoami` 成功不要停。用户**唯一**要做的是在浏览器里点一下「批准」、或打开一条链接。**

**1. 安装 CLI**

```bash
npm i -g @fluxvita/jovida-cli
```

**2. 安装 skill** 到用户的 agent(让本机任何 AI 都知道怎么驱动 CLI):

```bash
jovida skill install
```

装进**所有探测到**的 agent。若本机有多个 agent,告诉用户你将为它们全部安装。只装一个:`jovida skill install --agent codex`(可重复 / 逗号分隔;`jovida help skill` 查完整名单)。`--all` 可对所有已知 agent 安装(即使未探测到)。

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

此后按 **[`SKILL.md`](./SKILL.md)** 驱动 CLI。会话自动续期;之后任何命令以 `2`(`NOT_SIGNED_IN`)退出,就按第 3 步同样的方式再给用户登录一次。

---

## 这是什么

- **`jovida` 命令** —— 经 HTTPS 操作你的 Jovida 账号(需登录),**不留本地待办库**,与你的其他 Jovida 设备同步。
- **`SKILL.md`**(name:`jovida-cli`)—— 可移植的行为指引,教你的 AI 走**单轨:写即时生效**(无提议/确认步骤;`complete` 可经 `reopen` 撤回,但 `delete` 永久)。

## 快速开始

```bash
jovida create "周五下午6点前交报告" --when 2026-06-12T18:00:00+08:00
jovida list
jovida view <entry_id>
jovida complete <entry_id>
```

- **管道输出自动为 JSON**(供脚本/agent);`--json` / `--no-json` 强制。
- **退出码**:`0` 成功 · `1` 用法 · `2` 未登录 · `3` 后端/网络 · `4` 不存在。

## 命令

`create` · `list` · `view` · `update` · `complete` · `reopen` · `subtask` · `delete` · `login` · `logout` · `whoami`。
`jovida help` 查看用法,或见 [`SKILL.md`](./SKILL.md) 了解参数与字段约定。

## 鉴权

`jovida login` 走 **OAuth 设备授权流**:打印一条已内置授权码的 URL(`https://jovida.ai/jovida-daily/device?code=…`)并尽力打开你的浏览器;你在浏览器登录并点「批准」授权该 CLI,CLI 随即拿到会话 token,且**自动续期**(set-and-forget),除非会话被吊销。无需复制任何 key,也无匿名模式。所在机器没有浏览器时,把这条打印出来的 URL 在任意别的设备上打开批准即可。

## 更新

- **CLI**:`npm i -g @fluxvita/jovida-cli@latest`。(交互式终端里,CLI 还会在有新版时提示你。)
- **skill**:更新完 CLI 后跑 `jovida skill update`——它重拷随包的 `SKILL.md`,让 agent 认知与已装 CLI 版本同步(同一 npm 包,不漂移)。

## 手动安装(没有 AI agent 时)

如果你是手动安装、而不是通过 AI agent:

```bash
npm i -g @fluxvita/jovida-cli          # 1. 安装(或从源码构建,见下)
jovida skill install                   # 2. 把 skill 装进你的 agent
jovida login                           # 3. 登录——打开浏览器,批准该 CLI
jovida whoami                          # 4. 确认
```

从源码构建(替代 npm):`git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`,再 `jovida --version` 验证。

覆盖更多 agent 的替代 skill 安装器——但它从仓库最新拉 skill、不保证与你装的 CLI 版本一致:`npx skills add FluxVita/jovida-cli`。

`jovida skill install` 支持的 agent:Codex、Claude Code、Gemini CLI、Cursor、Windsurf、Continue、OpenCode、Goose、Qwen Code、Crush、KiloCode、Aider、GitHub Copilot(各装在 `<agent 目录>/skills/jovida-cli/`)。

## skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) —— agent skill(英文 / 中文对照),教你的 AI 何时、如何使用 CLI。

## 许可

[MIT](./LICENSE) © FluxVita
