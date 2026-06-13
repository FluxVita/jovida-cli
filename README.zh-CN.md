# jovida-cli

[English](./README.md) · **简体中文**

**Jovida Daily CLI**——在终端、以及在 AI 编码 agent(Codex、Claude Code……)里捕获和管理你的 **Jovida Daily** 待办。随仓附带一份 agent **skill**,让 AI 知道何时、如何使用它。

> **如果你是正在安装它的 AI agent:** 按 **[安装](#安装)** 顺序执行。第 1–2 步你自己做。**第 3 步 `jovida login` 你做不了——但绝不能跳过:** 装好后要**明确让用户运行 `jovida login`**(浏览器会打开,他登录并点「允许」),并等他确认。用 `jovida whoami` 验证。**登录成功前,别认为安装完成、也别去操作待办。** 此后按 **[`SKILL.md`](./SKILL.md)** 驱动 CLI;之后任何命令以 `2`(`NOT_SIGNED_IN`)退出,停下并让用户重新 `jovida login`。

> **内测中。** Jovida Daily 处于私有内测;CLI 需要 Jovida 账号(无匿名模式)。

## 两部分

- **`jovida` 命令** —— 经 HTTPS 操作你的 Jovida 账号(需登录),**不留本地待办库**,与你的其他 Jovida 设备同步。
- **`SKILL.md`**(name:`jovida-cli`)—— 可移植的行为指引,教你的 AI 走**单轨:写即时生效**(无提议/确认步骤;`complete` 可经 `reopen` 撤回,但 `delete` 永久)。

## 安装

**1. 安装 `jovida` 命令**,让它在 `PATH` 上:

```bash
npm i -g @fluxvita/jovida-cli
```

(或从源码构建:`git clone https://github.com/FluxVita/jovida-cli && cd jovida-cli && npm install && npm run build && npm link`。)用 `jovida --version` 验证。

**2. 安装 skill**,让 AI 知道何时/如何用 CLI:

```bash
jovida skill install
```

把随包的 `SKILL.md`(与 CLI 同版本)拷进探测到的 agent(`~/.codex/skills/jovida-cli/`、`~/.claude/skills/jovida-cli/`)。加 `--all` 可对所有已知 agent 安装(即使未探测到)。(备选:`npx skills add FluxVita/jovida-cli`。)

**3. 登录 —— 这是用户的步骤(交互式;agent 做不了):**

```bash
jovida login          # 打开浏览器;登录并点「允许」授权该 CLI
```

用 `jovida whoami` 验证。此后 CLI 保持登录态(自动续期),直到会话被吊销。

## 更新

- **CLI**:`npm i -g @fluxvita/jovida-cli@latest`。(交互式终端里,CLI 还会在有新版时提示你。)
- **skill**:更新完 CLI 后跑 `jovida skill update`——它重拷随包的 `SKILL.md`,让 agent 认知与已装 CLI 版本同步(同一 npm 包,不漂移)。
- **源码**:在克隆的仓库里 `git pull && npm install && npm run build`(`npm link` 软链常驻),再 `jovida skill update`。

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

`create` · `list` · `view` · `update` · `complete` · `reopen` · `delete` · `login` · `logout` · `whoami`。
`jovida help` 查看用法,或见 [`SKILL.md`](./SKILL.md) 了解参数与字段约定。

## 鉴权

`jovida login` 走 **OAuth 设备授权流**:显示一个 URL 和一个短码(并尽力打开你的浏览器);你在浏览器登录并点「允许」授权该 CLI,CLI 随即拿到会话 token。token **自动续期**(set-and-forget),除非会话被吊销。无需复制任何 key,也无匿名模式。

## skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) —— agent skill(英文 / 中文对照),教你的 AI 何时、如何使用 CLI。

## 许可

[MIT](./LICENSE) © FluxVita
