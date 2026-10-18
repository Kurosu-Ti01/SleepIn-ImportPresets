# AGENTS.md

给在本仓库里开发「学校导入预设」的智能体（与人类贡献者）的作业说明。

本仓库是 SleepIn「从教务系统导入课程表」功能的方案源。所有产出都会发到别人的手机上执行，
所以这里的规则不是建议，而是**准入条件**。

这个文件服务两种任务，先看清是哪一种，再往下读：

| 你要做的事 | 走哪几节 | 允许写的路径 |
|---|---|---|
| **加 / 认领一所学校的导入方案**（fork 后适配自己学校） | 第 0、3、4、5、6、7、8、9、10 节 | `schools/<id>/`、`presets/<id>/`、重新生成的 `source-index.json` |
| **维护框架**（运行流程、族适配器、生成器、测试、探测脚本） | 第 0、3、4、5、8、10、11、12 节 | `lib/`、`families/`、`tools/`、`tests/` |
| 只是先看清一个教务系统的形状（探测） | 第 12 节 | 不改仓库 |

两种任务都要先过第 5 节的判据：能不能用**取值**表达；不能，才考虑写代码。第 1、2、13 节
（语言、命令、提交）对所有任务都适用。

## 0. 先读什么

| 顺序 | 文件 | 用途 |
|---|---|---|
| 1 | `README.md` | 第一事实源：格式、适配器接口、`ctx` 全部成员、载荷契约、周次规则、发布与 CI |
| 2 | `families/<id>/CHANGEPOINTS.md` | 该族的**变化点清单**，等于贡献者检查表。适配一所学校从这里开始，不要先读适配器 |
| 3 | `presets/_<family>-example/preset.json` | 该族的骨架方案（`_` 开头，不参与发布）。先看它，再决定要不要写代码 |
| 4 | `lib/runner.js` | 共享运行流程。要改它之前先读第 5 节 |
| 5 | `tools/probe/README.md` | 探测流程：在浏览器里跑一遍，拿到请求路径、字段名与值的形状 |
| 6 | `schema/source-index.schema.json` | 生成物 `source-index.json` 的字段约束（改生成器时才需要） |

应用侧的契约（载荷校验、桥协议、导入页面）在另一个仓库：
SleepIn 的 `docs/SleepIn-Docs/docs/dev/3.business/6.portal-import.md` 与 `7.school-adaptation.md`。

`reference/` 下是**别的项目**的适配器仓库，只作形状参考：不复制它的代码、字段名或内部标识
（第 3 节第 1 条），也不在发布路径里。

## 1. 语言

- 注释、文档、`CHANGEPOINTS.md`、提交信息正文：**中文**。
- 代码标识符、JSON 键名、族/方案 `id`：英文小写下划线或连字符。
- 面向用户的文案（出现在应用里的字符串）：中文。

## 2. 命令

```powershell
node --test                                          # 单元测试（运行流程 + 探测脚本）
node --test --test-name-pattern "周次"                # 只跑匹配的用例
pwsh ./tools/Build-SourceIndex.ps1                   # 发布物：source-index.json（唯一能交给应用的格式）
pwsh ./tools/Build-SourceIndex.ps1 -Check            # 只校验（CI 跑的就是它）
pwsh ./tools/Build-TestScript.ps1 -Preset <id>       # 开发：拼出自包含脚本到 dist/，供试跑
node --check presets/<id>/script.js                  # 形态 C 手写脚本的语法自检
node --check tools/probe/portal-recon.js
```

`-Check` 与生成做的是同一件事，只差「写不写盘」；CI 跑的就是 `-Check`。改完任何源文件都要重跑生成器，
否则 CI 会失败。

## 3. 硬性规则

1. **不复制参考项目的代码、payload 字段名或内部标识。** 只允许使用**公开接口形状**：
   请求路径、参数名、响应键名。其余逻辑自己写。（`reference/` 下那份仓库就是这样的参考。）
2. **真实学校身份只允许出现在 `schools/<id>/school.json` 与 `presets/<id>/preset.json`** 的
   `name` / `startUrl` / `description`（以及 `school.json` 的 `code` / `aliases`）里——用户要靠它们
   搜索和识别，所以必须有。代码（`adapter.js` / `override.js` / `script.js`）、注释、
   `CHANGEPOINTS.md`、测试与示例里**不得**出现真实校名、域名、学校代码；示例一律用
   `example.invalid` 这类占位。
3. **只允许同源请求**。`ctx.http.*` 已在代码里强制同源，不要用别的方式绕开它
   （第三方域名、统计、CDN、短链一律不允许）。
4. **不打印、不落盘、不外传个人信息**：学号、姓名、Cookie、凭据不得进日志、试跑摘要、仓库或任何
   外部地址；诊断信息只含**字段名与计数**。唯一例外是教务系统自己要求的请求参数（例如个别族
   要把学号发给同源接口才能取到课表）：这类值只能从页面上读出来后直接发给**同一个**教务系统，
   不能落到别处，并且要在该族 `CHANGEPOINTS.md` 里注明。（载荷里的教师姓名属于课程信息，
   不受此条限制。）
5. **不接受任何写操作**：选课、评教、申请、提交表单。
6. **没有在真实教务系统上实测过的学校条目不要提交。** 发给用户的每一条都应该是能跑通的。
   唯一的例外是项目之初的占位条目：它显式写着「占位条目：」、`maintainer` 为「暂无」。
7. **不得手改生成物**：`source-index.json`。它由 `tools/Build-SourceIndex.ps1` 产出，手改会被 `-Check` 拦住。
   应用靠 `indexVersion` 判断「到底有没有变化」，所以内容改了而版本没动，会让所有已安装的应用
   一直认为没有更新。`dist/` 下的测试脚本是本地临时产物，不进版本控制。
8. 不引入运行时依赖。脚本在别人的登录会话里跑，没有包管理器。

## 4. 目录与命名

```
source-index.json       生成物：唯一的发布物（不要手改）
lib/runner.js           共享运行流程（改动影响全部方案）
families/<familyId>/    adapter.js + family.json + CHANGEPOINTS.md
presets/<presetId>/     preset.json（+ override.js，或形态 C 的 script.js）
schools/<schoolId>/     school.json
schema/                 source-index.schema.json（生成物的字段约束）
tests/                  node --test
tools/                  Build-SourceIndex.ps1（发布）、Build-TestScript.ps1（开发用拼装）、
                        lib/ChangePoints.ps1（共用校验）、probe/（探测脚本与说明）
dist/                   开发时拼出来的测试脚本（已被忽略，不要提交）
.github/workflows/      CI
```

- **以 `_` 开头的 `presets/` 与 `schools/` 目录是骨架示例，不参与发布。** `presets/` 下每个族都有
  一份骨架（`_example` / `_zhengfang-example` / `_qiangzhi-example` / `_jwapp-example` /
  `_eams-example` / `_chaoxing-example` / `_generic-table-example`）。新增学校时复制最接近的那份，
  再把名字里的 `_` 去掉。
- **占位条目**：`schools/` + `presets/` 里已经登记了大量学校，它们的 `description` 以「占位条目：」
  开头、`maintainer` 是「暂无」。
  适配一所已有占位条目的学校时改那份 `preset.json`，不要另建目录（第 6.2 节）。
- `id` 必须匹配 `^[a-z0-9][a-z0-9-]{1,63}$`（会成为路径的一部分，改名等于换一个方案）。
- 目录名与 `preset.json` 的 `schoolId`、`school.json` 的 `id` 必须一致。
- `presetId` 约定为 `<schoolId>-<group 小写>`（现在是 `-undergraduate`）。一个学校可以有多个
  preset（本科 / 研究生 / 不同教务系统），但共用一个 `schools/<schoolId>/`。

## 5. 改代码的门槛：什么才算「变化点」

**只有同时满足下面两条，才可以在 `family.json` 里新增变化点：**

1. **跨校稳定**：同一族的不同部署之间，这个值确实会变，而且变化就是取值的不同；
2. **运行时无法推断**：脚本拿不到这个信息，只能由写方案的人填。

不满足第 2 条（运行时可推断）的，写进族适配器的代码里；不满足第 1 条（只有这一所学校特殊）的，
写 `override.js`。

**改 `lib/runner.js` 的门槛更高**：它被所有方案共用，只有「与学校无关、且多个族都会用到」的能力
才放进去（例如周次解析、时段合并、表格工具）。为了迁就单所学校去改运行流程，是明确不接受的。

判断顺序永远是：**先看能不能用取值表达**（下一所学校可以直接复用）→ 再看能不能进族适配器 →
最后才是 `override.js`。这不是风格问题，而是**审阅成本**问题：取值只要看几个字段，代码要看一整段。

### 贡献者（fork）遇到族装不下时，四种归属

| 情况 | 写在哪里 | 回贡时怎么说明 |
|---|---|---|
| 只有你学校特殊 | `presets/<id>/override.js`，只重定义出问题的那一个环节 | 说清是哪一步、为什么取值表达不了 |
| 同族多校都会变、且运行时可推断 | 族适配器的 `adapter.js`（例如从 `ctx.pagePath()` 推出路径前缀） | 说清依据是哪些部署，并同步 `CHANGEPOINTS.md` |
| 同族多校都会变、且脚本拿不到 | `family.json` 新增变化点（同时写进 `CHANGEPOINTS.md`） | 给出两个以上部署的取值差异 |
| 与学校无关、多个族都会用到 | **先开 Issue**，由维护者判断要不要进 `lib/runner.js` | 不要在 PR 里顺带改运行流程 |

## 6. 加 / 认领一所学校的方案（贡献者主路径）

先定目标，两条路的收尾要求不同：

| 目标 | 最少要做到 |
|---|---|
| **自己用**：在自己手机上导入自己学校的课表 | 第 6.1—6.6 节 + 第 8 节的前两层 + 在应用里导入一次 + `description` 写清实际状态 |
| **回贡上游**：提 PR 给别人用 | 上面全部 + 第 9 节的完整清单 |

### 6.1 先拿到事实（拿不到就不要动手）

动手前必须有三件事：

- 登录入口地址（填 `startUrl`），且你自己能登录、能看到课表页；
- 课表数据从哪来：一条请求（路径、参数名、响应里的键名），还是页面上的表格（选择器）；
- 周次与节次分别怎么写（文本还是位图；连续区间还是 `1,3` 这种非连续写法）。

这三件事只能来自真实系统：自己在 DevTools 里看，或跑一遍 `tools/probe/portal-recon.js`
拿一份脱敏报告（第 12 节）；自己登不进那套系统时，才需要请人代跑并把报告贴回来。
**拿不到就把这一项留成「未实测」并在 `description` 里说明**，
不要用推测填上——猜出来的周次与节次会变成一张错课表，而且不会报错。

没有账号、进不去系统、课表页看不到数据时，这一步就只能停在**占位条目**：登记校名与 `startUrl`，
`description` 以「占位条目：」开头，`maintainer` 写「暂无」。不要写成已适配。

### 6.2 认领已有条目，而不是新建

`schools/` + `presets/` 里已经登记了大量学校（第 4 节的「占位条目」）。动手前先查你学校在不在：

- **已有占位条目** → 直接改那份 `presets/<schoolId>-undergraduate/preset.json`；
  `schools/<id>/school.json` 通常已经是对的（校名、别名、`code`）；
- **没有** → 同时建 `schools/<id>/school.json` 与 `presets/<id>-undergraduate/preset.json`，
  `id` 用学校可识别的短名（小写、数字、连字符，例如 `zzu`、`ncepu-baoding`）；
- 一个学校要两个入口（本科 / 研究生 / 不同教务系统）时才建第二个 preset，`schools/` 仍只有一个。

### 6.3 选族：从 `CHANGEPOINTS.md` 开始

复制最接近的骨架（`_` 开头，不参与发布），改掉名字里的 `_`：

| 你的系统 | 骨架 | 要读的清单 |
|---|---|---|
| 正方教务 v9（JSON 接口） | `presets/_zhengfang-example` | `families/zhengfang-v9/CHANGEPOINTS.md` |
| 强智 jsxsd（HTML 表格，选择器回退） | `presets/_qiangzhi-example` | `families/qiangzhi-jsxsd/CHANGEPOINTS.md` |
| 金智 jwapp（JSON，含子形，按取值切换） | `presets/_jwapp-example` | `families/jwapp/CHANGEPOINTS.md` |
| 东软 EAMS / URP（JSON，或脚本变量形式） | `presets/_eams-example` | `families/eams-urp/CHANGEPOINTS.md` |
| 超星教务（参数多来自页面） | `presets/_chaoxing-example` | `families/chaoxing-jw/CHANGEPOINTS.md` |
| 认不出厂商，但课表是标准表格（行 = 节次、列 = 星期） | `presets/_generic-table-example` | `families/generic-table/CHANGEPOINTS.md` |
| 完全不像任何一族 | 形态 C：自己写 `presets/<id>/script.js`，仍建议以 `lib/runner.js` 为起点 | README 第 2.3 节 |

`generic-table` 是**兜底**、不是已适配：它不发请求、没有学校身份，挂在上面的条目不算适配完成。

### 6.4 填 `preset.json`

| 字段 | 规则 |
|---|---|
| `name` | 显示名，写成 `<学校名> · <教务入口>`（例如「浙江大学 · 本科教务」） |
| `schoolId` | 必须与 `schools/<id>/` 的目录名一致 |
| `group` | 只能是 `UNDERGRADUATE` / `POSTGRADUATE` / `GENERAL`（`GENERAL` 是通用工具，不挂学校） |
| `initial` | 单个大写字母，取学校简称的拼音首字母（列表分字母索引用，例如 清华→`Q`、北大→`B`；生成器只校验非空） |
| `startUrl` | 登录入口的 `https://` 地址；占位条目可以没有 |
| `family` | 第 6.3 节选中的族 id；形态 C 不写这一项，改为自带 `script.js` |
| `config` | **只写与族默认值不同的项**，键名必须在该族 `CHANGEPOINTS.md` 里 |
| `description` | 适用系统、使用前提、已知限制，以及**实测到哪一步**（用户判断能不能用的唯一依据） |
| `maintainer` | 你的 GitHub ID；占位条目写「暂无」 |

生成器会拒绝的情况：`id` 不合规、`group` 不在三个取值里、`name` / `initial` / `description` /
`maintainer` 为空、`schoolId` 在 `schools/` 下不存在、`family` 不存在、`config` 里出现族没声明过的键、
既没有 `family` 又没有 `script.js`。

### 6.5 `config` 只写差异

逐项对照 `families/<id>/CHANGEPOINTS.md` 的取值表：和你的学校不一样才写。抄一遍完整的默认值不会报错，
但下一个贡献者就没法从 `config` 一眼看出这所学校特殊在哪里。

`config` 里出现族没声明过的键会**直接报错**（静默按默认值跑会产出错误的课表）。

### 6.6 生成、校验、（人工）试跑

```powershell
pwsh ./tools/Build-SourceIndex.ps1     # 生成 source-index.json：改过任何源文件都要重跑
pwsh ./tools/Build-SourceIndex.ps1 -Check
node --test
pwsh ./tools/Build-TestScript.ps1 -Preset <presetId>   # → dist/<presetId>.js
```

`dist/<presetId>.js` 在真实课表页上跑时走试跑分支：只解析、打印摘要、不写库。把整段粘进已登录的
课表页控制台，摘要里「跳过的行」应当是 0（或每条原因都解释得清）。这一步必须由**人**在真实系统上做
（见第 7 节）。

要在自己手机上用起来，三条路（README 第 4.2 节）：

- 把整份源目录（`source-index.json` 与它引用的 `lib/`、`families/`、`presets/`）拷到手机上，用
  「从本地目录导入源」——**逐文件校验哈希**，所以改过源文件就必须重新生成索引；
- 把 fork 的 `source-index.json` 链接填进应用（同样校验哈希）；
- 只把 `dist/<presetId>.js` 粘进应用里的「导入自己的脚本」——这条路不经过索引，适合先验证解析对不对。

### 6.7 收尾：把状态写进 `description`

`description` 要能看出四件事：适用哪个系统/入口、使用前提（先登录再执行）、已知限制（总周数是假设值、
作息时间读不到、哪些功能没实测）、**实测到哪一步**（例如「已在浏览器里试跑（12 门课 / 跳过的行 0），
尚未在应用里完整导入过」）。占位条目没有实测，就按第 6.1 节只写「占位条目：…」，不要写实测结论。

## 7. 在 fork 里做这件事时，智能体的边界

适配必须在真实教务系统上验证，而智能体进不去那里。以下几条不是建议：

1. **不能声称做过你没做的验证。** 「已在真实系统上跑通」只有在**人**把 `Build-TestScript.ps1` 出的
   脚本粘进浏览器、摘要里出现「跳过的行: 0」之后才能写进 `description`；`-Check` 与 `node --test`
   通过只说明静态一致，不能写成「已验证」。
2. **信息通道只有脱敏报告与试跑摘要**（字段名、计数、值形状）。不要索取对方的原始响应、课表截图、
   Cookie、学号；课程名与教师名不要进代码、注释、`description`、Issue。有人把原始响应贴过来时，
   只用其中的键名与形状，值不要落盘。
3. **不许为了让结果好看而放宽解析。** `ctx.parseWeeks` / `ctx.parseSections` 抛错或返回 `null` 是
   刻意设计（第 10 节）：遇到它们要改取值、改族判断，或如实记成「跳过的行」；不要删校验、
   不要加兜底 `catch` 吞掉、不要「按最接近的区间猜一个」。
4. **改动范围**：只写 `schools/<id>/`、`presets/<id>/`，以及重新生成的 `source-index.json`。
   `lib/`、`families/`、`tools/`、`tests/` 属于框架层，按第 5 节的归属表决定能不能动。
   不要改 `_` 开头的骨架（会影响所有后来者），除非用户明确要求。
5. **不手改生成物**：`-Check` 失败就重新跑 `Build-SourceIndex.ps1`，不要去改 `source-index.json`
   里的哈希或行序。
6. **拿不准的地方留成「未实测」并说出来**，不要填一个看起来合理的值（第 6.1 节）。用户宁可看到
   「作息时间读不到」，也不要看到一张悄悄错掉的课表。
7. **安全规则对自用同样生效**：脚本在别人的登录会话里跑，同源、不做写操作、不读个人信息这三条
   不会因为「只是我自己用」而放宽。

## 8. 怎样验证（三层，缺一不可）

| 层次 | 做法 | 能证明什么 |
|---|---|---|
| 静态 | `Build-SourceIndex.ps1 -Check` + `node --test` | 发布物与来源一致、运行流程自身没坏 |
| 解析 | 用 `Build-TestScript.ps1` 拼出脚本，粘进浏览器控制台 | 字段映射、周次、节次解析对不对 |
| 端到端 | 在应用里导入一次，核对课表 | 载荷能被校验、能落库、课表内容正确 |

第一层由智能体自己跑；第二、三层必须在真实系统上由**人**操作（第 7 节），智能体只从摘要里读结论，
据此改取值或写文档。

**第二层的试跑**（也是给别人测时最省事的一层）：没有桥时脚本走试跑分支，只解析、打印摘要、不写库。
在桌面浏览器里登录教务系统并停在课表页，把脚本整段粘进控制台回车，就会得到一段摘要
（课程数、课时数、作息节次、**跳过的行与原因**、响应字段名）。摘要按设计**不含课程名与个人信息**，
可以直接贴到公开 Issue 里。

**注意**：应用里只在「一行都没解析出来」时才提示跳过的行；能解析出一部分时，被跳过的行是**静默**的。
所以「跳过的行 = 0」必须靠试跑摘要确认，不能只看应用有没有报错。

## 9. 完成标准（DoD）

### 自己用：能导入、课表对

- [ ] `pwsh ./tools/Build-SourceIndex.ps1 -Check` 通过（生成物与来源一致）
- [ ] 在真实教务系统上试跑过，且**跳过的行是 0**（或每条原因都解释得清）
- [ ] 在自己的应用里完整导入过一次，核对过门数、时段、周次、地点
- [ ] `config` 只含与族默认值不同的项
- [ ] `description` 写明适用系统、使用前提、已知限制、实测到哪一步
- [ ] 代码与族文档里没有真实校名/域名（只出现在 `schools/`、`presets/` 的元数据里）；
      没有个人信息，没有第三方请求

### 回贡上游（PR）

在上一节的基础上还要：

- [ ] `node --test` 通过
- [ ] `description` 里的实测结论与事实一致（没跑过的层不写「已验证」）
- [ ] `maintainer` 填了你的 GitHub ID（不再是「暂无」）
- [ ] 每一项 `config` 都能在该族 `CHANGEPOINTS.md` 里找到
- [ ] 实测推翻或补充了族的默认值时，同步更新 `CHANGEPOINTS.md` 的实测记录（**不具名**，
      写成「一所未具名部署」）
- [ ] 生成物已重新生成（`source-index.json`）
- [ ] 改动范围只有 `schools/<id>/`、`presets/<id>/`（+ 必要的族文件）与 `source-index.json`

## 10. 改这个仓库时容易踩的坑

改适配器前先看一眼，这几类都是「不报错但结果错」：

| 坑 | 症状 | 正确做法 |
|---|---|---|
| 分组键用了**时段** | 同一门课一周上两次 → 被拆成两门课 | `groupKey` 用课程身份（教学班 id，或课程名 + 教师） |
| 分组键用了**课程名**，但教务按教学班分别报 | 多个教学班 → 被并成一门课 | 同上，用教学班 id |
| 行头里的**时刻**被当成节次 | `第1-2节 08:00-09:40` → 节次解析出 8 | 用 `ctx.parseSections`，它先摘掉 `\d{1,2}:\d{2}` |
| 周次字段里**混着节次** | `1-16周[1-2节]` → 周次解析抛错 | 先摘掉 `[n-m节]` 再交给 `ctx.parseWeeks` |
| `weeksEncoding` 判错 | 位图被当文本（或反过来）→ 周次全错且不报错 | 用探测报告的 `binary(len=…)` 判断；声明 `bitmap` 但内容不是 0/1 时运行流程会抛错 |
| 节次非连续 | `1,3` 被折叠成 1-3，把没上的课画进去 | `ctx.parseSections` 对非连续返回 `null`，让这一行被记为跳过 |
| 调课/停课没合并 | 同一时段出现重叠课时 | 按 `KBID|星期|起节|止节` 归类，调整周次而不是新增时段（参考 `families/jwapp`） |
| 页面改坏了浏览器的内置方法（`filter` 永远返回空、`every` 永远返回真） | 行数组变成 0 行 → 「这个学期没有课表数据」；判断类代码也会得出与真实原因无关的结论 | 运行流程的关键路径不用 `Array.prototype` 上的方法（用显式循环）；`runImport` 开头会自检运行环境，被改坏就报出方法名并停下。排查时**不要**用「拿个临时对象手测一下」来排除它——污染可能只表现在特定调用上 |

## 11. 测试

两种范式，按被测对象选：

- **`lib/runner.js` 里的函数**：用 `new Function(runnerSource + 'return {...}')` 抽出函数来测
  （见 `tests/runner-sections.test.mjs`）。运行流程是浏览器脚本，不是模块。
- **`tools/probe/portal-recon.js` 里的纯函数**：文件在 Node 下走 `module.exports`，测试用
  `createRequire` 引进来（见 `tests/recon-redaction.test.mjs`）。
- **适配器合并与检查**：见 `tests/runner-adapter-guard.test.mjs`，它盯的是「适配器完好、合并后成员
  却丢了」这类与真实原因无关的报错。

**已知缺口**：时段合并（`mergeSessions`）与课程分组（`groupCourses`）目前没有单元测试。
它们是对数组的纯数据变换、不需要 DOM，而第 10 节里前两行那两个坑正是它们负责的。
补测试是受欢迎的改动。

## 12. 探测脚本的三条硬要求

`tools/probe/portal-recon.js` 会把它在页面上看到的东西整理成报告（报告可能被贴到公开场合），所以：

1. 不主动发请求；2. 不读凭据（Cookie、localStorage、表单）；3. 所有值都必须过 `brief()` 自检。

自检认不出的字符（`〇`、希腊字母、假名这类）要换成形状标记，并把码位写进报告的 `redaction.unresolved`：
**报告一定要出得来**（拿不到报告就无从定位是哪个字段出的问题），但原文一个字节都不许进去。只有报告
本身组装不出来时才中止输出（见 `abortOutput`）；这类失败不能被各处「出错了就降级」的 `catch` 吞掉
（用 `redactionError` 标记这类错误，见代码里的注释）。

`tests/recon-redaction.test.mjs` 与 `tests/probe-smoke.test.mjs` 里各有一条关键测试：
前者「夹具里放课程名/姓名/学号，断言报告里搜不到」，后者用假 DOM 把浏览器分支真跑一遍。
这两条不许绕过或放宽，并且报告里**永远不能出现原文**——规则外的字符只允许变成形状标记加码位。

## 13. 沟通与提交

- 提交信息：英文标题（`feat(family): …` / `fix(preset): …`）+ 中文正文，说明**适用系统、实测到哪一步、
  已知限制**。
- 新增族时必须同时给出 `CHANGEPOINTS.md`；改了族的默认值要同步改清单。
- 改了族的接口（`family.json` 的 `changePoints`）或新增/删除族，要同步更新 `README.md` 里的族表。
- 拿不准的时候**停下来问，不要猜**：猜出来的周次、猜出来的校区、猜出来的节次都会变成一张错的课表，
  而且不会报错。运行流程在解析不了时抛错，是刻意的设计——保持这个性质。
- 回贡的 PR 只带 `schools/<id>/`、`presets/<id>/`、必要的族文件与重新生成的 `source-index.json`；
  不要顺带格式化、重构或升级依赖。
