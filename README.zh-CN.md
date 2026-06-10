# jovida-cli

[English](./README.md) · **简体中文**

**Jovida Daily CLI**——在终端、以及在 AI 编码 agent(Codex、Claude Code……)里捕获和管理你的 **Jovida Daily** 待办。随仓附带一份 agent **skill**,让 AI 知道何时、如何使用它。

> **内测中。** Jovida Daily 处于私有内测;CLI 需要 Jovida 账号(无匿名模式)。公开 npm 发布即将到来。

## 两部分

- **`jovida` 命令** —— 经 HTTPS 操作你的 Jovida 账号(需登录),**不留本地待办库**,与你的其他 Jovida 设备同步。
- **`SKILL.md`**(name:`jovida-cli`)—— 可移植的行为指引,教你的 AI 走**单轨:写即时生效**(无提议/确认步骤,暂无撤回)。

## 安装

### 1. skill(让 AI 知道怎么用 CLI)

```bash
npx skills add FluxVita/jovida-cli
```

把 `SKILL.md` 装进探测到的 agent(`~/.codex/skills/jovida-cli/`、`~/.claude/skills/jovida-cli/`……)。或把本仓库 URL 贴给 agent、让它自行安装。

### 2. `jovida` CLI

预发布——暂时从源码构建:

```bash
git clone <repo> jovida-cli && cd jovida-cli
npm install && npm run build && npm link   # 提供 `jovida` 命令
```

(发布后:`npm i -g @jovida/cli`。)

## 快速开始

```bash
jovida login                      # 必须 —— 粘贴 web 出 key 页生成的 key
jovida create "周五下午6点前交报告" --when 2026-06-12T18:00:00+08:00
jovida list
jovida show <entry_id>
jovida complete <entry_id>
```

- **管道输出自动为 JSON**(供脚本/agent);`--json` / `--no-json` 强制。
- **退出码**:`0` 成功 · `1` 用法 · `2` 未登录 · `3` 后端/网络 · `4` 不存在。

## 命令

`create` · `list` · `show` · `update` · `complete` · `delete` · `login` · `logout` · `whoami`。
`jovida help` 查看用法,或见 [`SKILL.md`](./SKILL.md) 了解参数与字段约定。

## 鉴权

`jovida login` 接收一枚在 Jovida web 出 key 页生成的 **CLI key**。CLI 用它换会话 token 并**自动续期**(set-and-forget)——除非你吊销 key,否则无需再登录。无匿名模式。

## skill

[`SKILL.md`](./SKILL.md) · [`SKILL.zh.md`](./SKILL.zh.md) —— agent skill(英文 / 中文对照),教你的 AI 何时、如何使用 CLI。

## 许可

[MIT](./LICENSE) © FluxVita
