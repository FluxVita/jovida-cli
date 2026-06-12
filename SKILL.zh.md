---
name: jovida-cli
description: 通过 `jovida` 命令行工具捕获和管理用户的 Jovida Daily 待办——新建/查看/修改/完成/删除(改动立即生效、无确认步骤)。当对话中出现行动项、待跟进事项或承诺,或用户要求记录 / 记住 / 整理某件事时使用。
allowed-tools: Bash(jovida:*)
---

> 这是英文版 `SKILL.md` 的中文对照版(双语并存)。实际生效的 skill 以 `<skills 根>/jovida-cli/SKILL.md`(英文)为准;本文供中文阅读与维护参考,内容与英文版保持同步。

# Jovida Daily 待办（CLI）

通过 shell 调用 `jovida` 命令行工具,帮用户捕获和管理 **Jovida Daily** 待办。`jovida` 命令是操作用户账号的接口,改动会同步到用户的其他 Jovida 设备。

> **若 `jovida` 命令不存在**,说明本机没装 Jovida Daily CLI——提醒用户安装(见 jovida-cli README);别假装记下了什么。
> **登录是必须的,而且是用户的步骤。** 无匿名模式,用户不运行 `jovida login` 就什么都做不了(浏览器交互登录——你**无法**替他做,也**不能跳过**)。要主动:不确定是否已登录,就先跑 `jovida whoami`;若 `whoami` 或任何命令以 `2`(`NOT_SIGNED_IN`)退出,**停下、让用户运行 `jovida login`、等他确认后再重试**——别默默丢掉任务或说自己搞不定。

## 核心心智模型——先读这段

写操作**立即生效**。**没有提议/确认步骤**:你一旦运行 `jovida create / update / complete / delete`,改动当即落到用户账号并同步到各设备。所以:

- 说「我**已创建 / 已完成 / 已删除**……」——绝不要说「我已提议……」。
- 正因为立即生效,**只在用户明确想要该改动时**才执行。拿不准就先问(见*提议前先澄清*)。
- CLI **没有撤回(undo)**——对 `delete` 和 `complete` 尤其谨慎。

## 何时使用

当上下文里有真实、可执行的事项时再动手:
- 明确的行动项、待跟进事项或承诺(「我需要……」「记得……」「上线前检查……」);
- 用户要求记录 / 记住 / 添加 / 整理某件事,或标记完成 / 删除某条。

**不要过度捕获**:
- 忽略假设、头脑风暴、以及已经做完的事;
- 拿不准是不是真任务时,先问,别写噪音。

## 写之前先澄清

写操作立即改用户数据,而 `delete` / `complete` 在此**不可撤回**——所以一次含糊或错误的调用代价不小。动手前确保要素具体:*做什么*,以及——涉及时间时——*哪天 / 截止 / 提醒时刻*。若用户的话确实留白,**先问一个简短问题**,别用猜测填空。

- 「提醒我明天那件事」→ 先问*那件事是什么*、大概*几点*,再写。
- 「设个提醒」却没给时间 → 先问时间。
- 别矫枉过正:细节已清楚时(「周五下午 6 点前交报告」)直接动手。

## 命令

你通过 shell 调用这些命令。**非交互运行时(你就是)输出是 stdout 上的 JSON**——解析它。错误走 **stderr**,形如 `{"error":{"code","message"}}`,并带**非零退出码**(`2`=未登录、`3`=后端/网络、`4`=条目不存在、`1`=用法)。可加 `--json` 强制 JSON。

依赖某个参数前,先 `jovida help` 确认它可用、查看当前用法。

**读**(了解现状,以及在 update/complete/delete 前拿到真实 `entry_id`):
- `jovida list [--scope today|upcoming|recent|range|all] [--status pending|completed|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N]`
  → `{ "todos": [ { "entry_id", "title", "when", "priority", "status", "category" } ] }`。受限视图(默认 `scope=today`、`status=pending`、`limit=20`),**不是**搜索。
- `jovida show <entry_id>` → 单条完整待办(description、subtasks、remind_at、hint……)。

**写**(立即生效):
- `jovida create "<标题>" [--when <ISO>] [--priority none|low|medium|high] [--remind <ISO> …] [--category <s>] [--desc <s>] [--subtask "<标题>" …] [--hint <s>]`
  → `{ "entry_id", "status": "created" }`。**一次一条**——多条就多次运行。
- `jovida update <entry_id> [--title <s>] [--when <ISO>] [--priority …] [--remind <ISO> …] [--category <s>] [--desc <s>] [--subtask "<标题>" …] [--hint <s>]`
  → `{ "entry_id", "status": "updated" }`。
- `jovida complete <entry_id> [<entry_id> ...]` → `{ "entry_ids", "status": "completed" }`。
- `jovida delete <entry_id> [<entry_id> …]` → `{ "entry_ids": […], "status": "deleted" }`。多个 id 一次传。

标题及含空格的值要加引号。**`--title` / `--desc` 保持单行纯文本**——经 shell 传换行或特殊字符很脆弱(会被破坏)。需要长备注就写短、单行,别嵌 markdown/换行。

**绝不要把 token 写进命令**(会进 shell history / 进程列表)。登录是用户的事(浏览器交互)——见上方未登录说明。

## 字段约定

- **`--when`** — 待办的时间,**一个 flag、两种粒度**(ISO 8601):
  - 纯**日期**(`2026-06-05`)→ 归属*那天*,无硬截止;
  - 带时刻的 **datetime**(`2026-06-05T18:00:00+08:00`)→ 精确**截止**。
  - 你确切知道哪个就给哪个。别把「周三做但周五截止」拆开——若周五截止,它就是周五的待办。
- **`--priority`**:`none` | `low` | `medium` | `high`。
- **`--category`**:分组标签。**`--desc`**:自由文本备注。
- **`--subtask "<标题>"`**(可多次):把大任务拆解为步骤。
- **`--remind <ISO>`**(可多次)——何时提醒;**与 `--when` 分开**:
  - 每个须 **早于或等于**待办时间(早于截止,或日期型待办当天的任意时刻);
  - **提醒 ≠ 截止**:「提醒我明天 X」→ `--when "<明天>" --remind "<明天>T09:00:00+08:00"`(**不**让 X 截止);
  - 若只给 `--remind` 不给 `--when`,待办落在**最晚**那条提醒的日期。
- **`--hint <s>`** — *可选*的一句话提示,展示在待办下方。默认不加,仅在确有帮助时(≤~20 字,别复述标题)。
- **循环待办 CLI 暂不支持**——别尝试表达,改为建多条单独待办或告知用户。

## 写前先读

`update` / `complete` / `delete` 需要**真实 `entry_id`**——先用 `jovida list` / `jovida show`(解析 JSON)拿到。**绝不要猜 id**。

## 分组

- 多条互相独立的待办 → 每条运行一次 `jovida create`。
- 一次删多条相关待办 → **一条** `jovida delete` 带上所有 id。

## Do / Don't

- DO:update / complete / delete 前先 `list` / `show`(你需要真实 `entry_id`)。
- DO:写清晰、动作导向的标题(动词开头、具体)。
- DO:措辞用「已创建 / 已修改 / 已完成 / 已删除」——写即时生效。
- DON'T:过度捕获;触发用户没明确要求的即时写(无 undo);命令非零退出还谎称成功——读错误并告知用户(如 exit `2` → 请他们 `jovida login`)。
