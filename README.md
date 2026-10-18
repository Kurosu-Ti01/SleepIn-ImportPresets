# SleepIn 导入方案源

本仓库是 [SleepIn](https://github.com/Kurosu-Ti01/SleepIn) 课程表「从教务系统导入课程表」功能的方案源：
应用读取这里发布的索引，在设备上组装或直接使用其中列出的脚本，用户就能在应用里选择对应学校的导入方案。

> **当前状态：模板 + 一批占位条目。** 结构、共享运行流程、生成器、校验与 CI 都已就位。
> 目前 `source-index.json` 里的绝大多数方案暂为占位方案。

---

## 目录

- [1. 这是什么](#1-这是什么)
  - [1.1 三个概念](#11-三个概念)
  - [1.2 发布形式](#12-发布形式)
  - [1.3 按「族」复用脚本](#13-按族复用脚本)
- [2. 快速开始](#2-快速开始)
  - [2.1 直接复用族脚本的学校（形态 A）](#21-直接复用族脚本的学校形态-a)
  - [2.2 需要覆写族脚本的某处的学校（形态 B）](#22-需要覆写族脚本的某处的学校形态-b)
  - [2.3 完全与族脚本异构的学校（形态 C）](#23-完全与族脚本异构的学校形态-c)
  - [2.4 本地校验与试跑](#24-本地校验与试跑)
- [3. 仓库结构](#3-仓库结构)
- [4. 应用怎么读取这个仓库](#4-应用怎么读取这个仓库)
  - [4.1 应用不内置方案](#41-应用不内置方案)
  - [4.2 方案源：`source-index.json`](#42-方案源source-indexjson)
  - [4.3 应用的校验与失败行为](#43-应用的校验与失败行为)
- [5. 适配器接口](#5-适配器接口)
  - [5.1 必需成员](#51-必需成员)
  - [5.2 可选成员](#52-可选成员)
  - [5.3 `ctx` 提供的能力](#53-ctx-提供的能力)
  - [5.4 已有族](#54-已有族)
- [6. 脚本产出的载荷](#6-脚本产出的载荷)
  - [6.1 形状](#61-形状)
  - [6.2 字段与限制](#62-字段与限制)
  - [6.3 `normalizeRow` 的返回约定](#63-normalizerow-的返回约定)
  - [6.4 运行流程替你做掉的事](#64-运行流程替你做掉的事)
  - [6.5 周次解析：最容易出错的地方](#65-周次解析最容易出错的地方)
- [7. 发布与 CI](#7-发布与-ci)
  - [7.1 一个发布工具，一个开发工具](#71-一个发布工具一个开发工具)
  - [7.2 发布工具会拒绝什么](#72-发布工具会拒绝什么)
  - [7.3 CI](#73-ci)
  - [7.4 版本与兼容](#74-版本与兼容)
- [8. 本地校验与试跑](#8-本地校验与试跑)
  - [不用进应用就能试跑](#不用进应用就能试跑)
- [9. 提交前检查清单](#9-提交前检查清单)
  - [首次实测要核对什么](#首次实测要核对什么)
- [10. 审阅与安全要求](#10-审阅与安全要求)
- [11. 参与贡献](#11-参与贡献)

---

## 1. 这是什么

### 1.1 三个概念

| 概念                   | 是什么                                                       | 在哪                                       |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| **族（family）**       | 一类教务系统的取数逻辑：怎么发请求、一行里的值在哪个字段     | `families/<id>/adapter.js` + `family.json` |
| **方案（preset）**     | 具体到一所学校：显示名、起始网址、族 + 该校取值              | `presets/<id>/preset.json`                 |
| **运行流程（runner）** | 与学校无关的一切通用逻辑：桥交互、请求封装、周次解析、时段合并、载荷组装 | `lib/runner.js`                            |

### 1.2 发布形式

**应用不内置任何方案**：它只从两个地方拿到方案——用户导入的源，或用户自己写的脚本。
因此这个仓库只对应用发布一种东西：

| 产物 | 文件 | 谁生成 | 谁消费 |
|---|---|---|---|
| **方案源** | `source-index.json`（schema 2） | `tools/Build-SourceIndex.ps1` | 应用读取后在设备上组装出最终脚本 |

源发布的是 `lib/runner.js`、`families/<id>/`、`schools/` 元数据，以及每个方案声明自己属于哪种组装形态
（`family` / `override` / `rewrite`）和它的 `config`。应用读取并逐个校验哈希后，在设备上组装。

除此之外还有一个开发时用的工具 `tools/Build-TestScript.ps1`：把同一份组装结果在本地拼成一个
自包含的 `.js` 文件，写到 `dist/`，用来在教务系统页面的控制台里试跑，
或者粘进应用里的「导入自己的脚本」用以测试。

### 1.3 按「族」复用脚本

假设使用同一套教务系统的不同学校导入逻辑因相同或相似，故而所以这里的组织方式是：

> 同一类教务系统的学校归为同一类，同一族的学校，
> 或可直接复用族脚本（记为形态 A）、
> 或仅需覆写族脚本的某处（记为形态 B）、
> 抑或是与现有族完全异构需要单独实现（记为形态 C）。

---

## 2. 快速开始

### 2.1 直接复用族脚本的学校（形态 A）

```powershell
# 1. 复制骨架并改名（目录名 = 内部 ID：小写字母、数字、连字符）
Copy-Item -Recurse presets/_example presets/my-university
Copy-Item -Recurse schools/_example schools/my-university

# 2. 编辑 presets/my-university/preset.json
#    · schoolId / name / description / maintainer
#    · startUrl：自己学校教务系统的登录页
#    · family：保持不变（或改成你那一族的 id）
#    · config：按 families/<id>/CHANGEPOINTS.md 逐项对照，只写与默认值不同的项

# 3. 重新生成并提交生成物
pwsh ./tools/Build-SourceIndex.ps1
```

`config` 里写了族没声明过的键会**直接报错**，而不是静默按默认值跑——静默的后果是产出一张错误的课程表。

### 2.2 需要覆写族脚本的某处的学校（形态 B）

先在 `families/<id>/CHANGEPOINTS.md` 里找那一项能不能用取值表达。能就用取值（下一所学校可以直接复用）；
确实不能时才加 `override.js`：

```powershell
Copy-Item presets/_example-override/override.js presets/my-university/override.js
```

`override.js` 里**只重新定义出问题的那一个环节**，其余环节仍用族适配器的实现，并在文件顶部写清「为什么要覆盖」。

### 2.3 完全与族脚本异构的学校（形态 C）

不写 `family`，自己提供 `presets/my-university/script.js`。发布工具不会改动它，只负责校验存在、把哈希写进源索引。

建议仍然以 `lib/runner.js` 为起点：桥交互、周次解析、时段合并、载荷组装都不必重写。

### 2.4 本地校验与试跑

```powershell
node --test                                   # 单元测试
pwsh ./tools/Build-SourceIndex.ps1 -Check     # 发布物与来源是否一致
```

详见[第 8 节](#8-本地校验与试跑)。

---

## 3. 仓库结构

```
source-index.json                 ← 生成物：唯一的发布物，让应用在设备上组装
lib/runner.js                     ← 共享运行流程（桥交互、请求、周次、合并、提交）
families/<familyId>/
├── adapter.js                    ← 族适配器：怎么取数、一行里的值在哪（同族共用一份）
├── family.json                   ← 变化点默认值（config 的默认值表）+ apiVersion
└── CHANGEPOINTS.md               ← 变化点清单（= 贡献者检查表）
presets/<presetId>/
├── preset.json                   ← 学校一行：元数据 + family + config
├── override.js                   ← 可选：只覆盖某一个具名环节（形态 B）
└── script.js                     ← 形态 C（rewrite）必须自带的手写脚本；形态 A/B 不需要
schools/<schoolId>/school.json    ← 学校显示名、可选官方代码与别名
schema/source-index.schema.json   ← source-index.json 的 JSON Schema
tools/Build-SourceIndex.ps1       ← 生成 source-index.json（唯一的发布物）
tools/Build-TestScript.ps1        ← 开发用：把某份方案拼成自包含脚本写到 dist/（不发布、不参与 CI）
tools/lib/ChangePoints.ps1        ← 变化点校验，发布工具与开发工具共用
tools/probe/                      ← 探测教务系统形状的脚本与说明（自己跑或请人代跑）
tests/                            ← 单元测试（node --test）
.github/workflows/validate.yml    ← CI：一个 -Check + node --test
```

**以 `_` 开头的 `presets/` 与 `schools/` 目录是骨架示例，不参与发布**（生成器的 `Get-NameList` 会跳过它们）。

`schools/<id>/school.json` 的字段：

```json
{
  "id": "example-university",
  "name": "示例高校",
  "code": "SAMPLE-001",
  "aliases": ["示例大", "Example University"]
}
```

`id` 必须与目录名一致（它会成为路径的一部分）；`code` 与 `aliases` 可选，只用于搜索与显示。

---

## 4. 应用怎么读取这个仓库

### 4.1 应用不内置方案

APK 内置本仓库方案源，初次执行时从本仓库拉取方案，之后按用户设置的周期在后台更新。
内置的地址就是：

```
https://raw.githubusercontent.com/Kurosu-Ti01/SleepIn-ImportPresets/main/source-index.json
```

用的是 `raw.githubusercontent.com`（而不是仓库页面地址）是因为页面地址会重定向，而重定向会改变
「相对路径基于哪里解析」这个基准。用户也可自行编写添加方案或方案源。

### 4.2 方案源：`source-index.json`

源索引只声明文件与哈希，最终脚本由应用生成：

```json
{
  "schemaVersion": 2,
  "indexVersion": 1,
  "runner": { "path": "lib/runner.js", "sha256": "…" },
  "families": [
    { "id": "zhengfang-v9",
      "metadata": { "path": "families/zhengfang-v9/family.json", "sha256": "…" },
      "adapter":  { "path": "families/zhengfang-v9/adapter.js",  "sha256": "…" } }
  ],
  "schools": [{ "id": "example-university", "name": "示例高校", "code": "SAMPLE-001", "aliases": ["示例大"] }],
  "presets": [
    { "id": "example-university-undergrad", "name": "示例高校 · 本科教务",
      "schoolId": "example-university", "group": "UNDERGRADUATE", "initial": "S",
      "startUrl": "https://jw.example.invalid/",
      "assembly": "family", "family": "zhengfang-v9",
      "config": { "assumedTotalWeeks": 18 },
      "description": "…", "maintainer": "…" }
  ]
}
```

`assembly` 由目录内容推导，**不用手写**：

| 目录里有什么 | `assembly` | 索引里发布什么 |
|---|---|---|
| `preset.json` 有 `family`，没有 `override.js` | `family` | 族 id + `config` |
| `preset.json` 有 `family`，且有 `override.js` | `override` | 族 id + `config` + `override.js` |
| `preset.json` 没有 `family`，但有自己的 `script.js` | `rewrite` | `script.js`（整份） |

**方案源**的产物可以直接交给应用：**填它的链接**，或者把**整个源目录**（`source-index.json` 与它引用的
`lib/`、`families/`、`presets/`）拷到手机上，在应用里用「从本地目录导入源」选那个目录。

两条路径走同一套校验与组装规则——**本地导入同样逐文件校验哈希**，所以改过文件就必须重新生成索引。

### 4.3 应用的校验与失败行为

| 情况 | 应用的反应 |
|---|---|
| 索引格式不对、`schemaVersion` 不支持 | 拒绝整次导入，给出原因 |
| 哈希不匹配 / 文件缺失 | 拒绝整次导入，并指出是哪个文件 |
| 组装脚本跑不起来（语法错误等） | 方案保留在列表里，点进去在 WebView 里报错 |
| 索引声明了族、但没有方案 | **正常结果**：族被缓存下来，可以在应用里「用本地缓存的族组装」复用 |

应用会在导入时缓存索引声明的每一个族和 runner，不论本次导入的方案是否引用它们——
这份缓存就是应用内「复用本地缓存的族」的输入。

---

## 5. 适配器接口

族适配器（`families/<id>/adapter.js`）必须定义 `const familyAdapter = { … }`。

### 5.1 必需成员

运行流程在开始时检查这 6 个成员，缺任何一个都会立刻报错并列出缺了谁，而不是跑到一半产出错误的课表。

| 成员 | 签名 | 作用 |
|---|---|---|
| `detect` | `(ctx) => true \| string` | 返回 `true` 表示认出来了；返回字符串则用这句话解释为什么认不出来（会显示给用户，并附上当前页面路径）。只用不需要发请求的特征 |
| `listSemesters` | `(ctx) => Array` | 返回学期行数组。可以是本地合成的若干项（如「近 4 学年 × 2 学期」） |
| `semesterCode` | `(semester, ctx) => string` | 学期标识，用于后续请求的参数 |
| `semesterLabel` | `(semester, ctx) => string` | 学期显示名（可读 `ctx.config`） |
| `fetchSchedule` | `(semester, ctx) => Array` | 返回课表的原始行数组（未归一化） |
| `normalizeRow` | `(row, ctx) => object \| Array \| { skip } \| null` | 一行 → 一条课时（或几条） |

### 5.2 可选成员

| 成员 | 签名 | 作用 |
|---|---|---|
| `currentSemester` | `(semesters, ctx) => semester \| null` | 页面当前选中的学期。**可以是异步的**（调用方会 `await`）。返回 `null` 时运行流程会弹选择框 |
| `semesterMeta` | `(semester, ctx) => { name?, totalWeeks?, startDate? }` | 学期元数据，填进载荷的 `timetable` |
| `describeFields` | `(rows, ctx) => string[]` | 诊断用的字段名清单。HTML 族可以拿它报「这次读了哪些 title 标签」，比报字段名有用 |
| `timeSlots` | `(semester, ctx) => [{ period, start, end }]` | 该教务系统的作息时间，时刻用 `'HH:mm'` |

> `timeSlots` 是**可选**的，但它直接决定用户体验：提供了，应用会在确认弹窗里多一个
> 「用方案提供的（新建作息表）」选项；不提供，用户就只能选一个已有的作息表。
> 参考仓库里 95% 的脚本都会写作息时间，所以**只有确认该教务系统真的不报时间时才省略它**。

### 5.3 `ctx` 提供的能力

`ctx` 在运行流程里构造（`buildContext`），字段映射与周次编码都已经落到取值上，
所以适配器**不需要自己解析 `config`**——换一所字段名不同的学校，改的是 `preset.json`，不是代码。

**取值与解析**

| 成员 | 说明 |
|---|---|
| `ctx.config` | 族默认值与该校取值合并后的结果 |
| `ctx.pick(row, name)` | 按 `config.fields` 的映射取值（逻辑名 → 实际字段，支持 `a.b` 嵌套） |
| `ctx.pickFrom(value, path)` | 按点分路径取值；`*` 表示「当前对象的第一个键」，用于取动态键名的行容器 |
| `ctx.parseWeeks(raw)` | 按 `config.weeksEncoding` 解析周次（见 [6.5](#65-周次解析最容易出错的地方)） |
| `ctx.parseSections(raw)` | 从文本里解析节次区间（`'第1-2节'` → `{ from, to }`），见 6.3 |
| `ctx.rowsFrom(json)` | 按 `config.rowContainer` 取出行数组（支持 `*` 表示动态键名） |

**请求**（只允许同源；传跨源绝对地址会**直接抛错**）

| 成员 | 说明 |
|---|---|
| `ctx.http.get(path)` | → `{ status, text, json() }`；自动带 `credentials: 'same-origin'`（教务系统靠 Cookie 判断登录态） |
| `ctx.http.postForm(path, body)` | 表单 POST，`Content-Type` 自动设为 `application/x-www-form-urlencoded` |

**页面读值**（有的族的学期、校区、学号只存在于页面上，没有接口）

| 成员 | 说明 |
|---|---|
| `ctx.pagePath()` | 当前页面的 `pathname + search`（便于定位「页面不对」这类问题） |
| `ctx.pageHtml()` | `document.documentElement.innerHTML` |
| `ctx.hasElement(selector)` | 是否存在 |
| `ctx.pageText(selector)` | 文本内容（压缩空白） |
| `ctx.pageValue(selector)` | 表单元素的 `value`；没有 `value` 时退回文本内容 |
| `ctx.pageAttr(selector, name)` | 属性值 |
| `ctx.pageOptions(selector)` | → `[{ value, label }]`（读 `<option>`），适合「页面上有学期/校区下拉框」的情况 |

**HTML 表格族**（课表在表格里的那类系统）

| 成员 | 说明 |
|---|---|
| `ctx.parseHtml(html)` | HTML 文本 → 可查询的文档（用页面自带的 `DOMParser`，不引入解析库） |
| `ctx.findTable(doc, selectors)` | 按**候选选择器依次尝试**找表；`selectors` 写错不会让整次失败 |
| `ctx.tableMatrix(table)` | → 行 × 列的单元格矩阵 |
| `ctx.cellText(cell)` | 单元格文本（压缩空白） |
| `ctx.cellHtml(cell)` | `cell.innerHTML` |
| `ctx.cellBlocks(html, options)` | 把一个单元格按分隔线拆成若干「课程块」，见下 |

`ctx.cellBlocks(html, options)` 处理 HTML 课表的共同形状：一个格子里用分隔线摆着几门课，
每门课的教师/教室/周次节次写在带 `title` 的内联标签里。它只负责「拆」与「取」，不解释含义：

```js
ctx.cellBlocks(ctx.cellHtml(cell), {
  blockSplitter: '-----',                                  // 取值：分隔线
  titles: { teacher: ['老师', '教师'], location: ['教室'], weekSection: ['周次(节次)'] }
});
// → [{ index, name, teacher, location, weekSection, text, html }]（name 为空块会被丢掉）
```

**交互与诊断**

| 成员 | 说明 |
|---|---|
| `ctx.ask(title, options, defaultIndex)` | 弹选择框 → 下标；没有桥时自动选默认项并打日志 |
| `ctx.askText(title, hint, initialValue)` | 弹输入框 → 文本；没有桥时返回默认值 |
| `ctx.notify(message)` | 状态提示（状态栏），不等结果 |
| `ctx.log(message)` | 诊断输出 |

> 需要用户输入的要求应尽量少：能在页面上读到的（`ctx.pageValue` / `ctx.pageOptions`）就别问用户。

### 5.4 已有族

| 族 | 覆盖的系统 | 载体 | 变化点清单 |
|---|---|---|---|
| `zhengfang-v9` | 正方教务 v9 的课表查询模块 | JSON | [CHANGEPOINTS](families/zhengfang-v9/CHANGEPOINTS.md) |
| `qiangzhi-jsxsd` | 强智 jsxsd 的课表页（HTML 表格，选择器回退） | HTML | [CHANGEPOINTS](families/qiangzhi-jsxsd/CHANGEPOINTS.md) |
| `jwapp` | 金智 jwapp 课表模块（含 `wdkb` / `kbapp` 子形，按取值切换） | JSON | [CHANGEPOINTS](families/jwapp/CHANGEPOINTS.md) |
| `eams-urp` | 东软 EAMS / URP 课表接口 | JSON | [CHANGEPOINTS](families/eams-urp/CHANGEPOINTS.md) |
| `chaoxing-jw` | 超星教务（参数多来自页面） | JSON | [CHANGEPOINTS](families/chaoxing-jw/CHANGEPOINTS.md) |
| `generic-table` | **通用抓取**：当前页面上的课表表格（长尾兜底，无学校身份） | HTML | [CHANGEPOINTS](families/generic-table/CHANGEPOINTS.md) |
| `example-portal` | 骨架示例（虚构，供新族参考） | JSON | [CHANGEPOINTS](families/example-portal/CHANGEPOINTS.md) |

`generic-table` 属于应用里的「通用工具」分类：它不发请求、没有学校身份，**不是正式方案**，
不应该被写进「已适配学校」的条目里。

---

## 6. 脚本产出的载荷

适配器最终只需要产出一件事：一张课表。运行流程把它组装成下面这个形状，交给应用校验并写入。

### 6.1 形状

```js
{
  schema: 1,
  timetable: { name: '2025 秋', totalWeeks: 18, startDate: '2025-09-01' }, // 可选
  periods: [ { period: 1, start: '08:00', end: '08:45' } ],                // 可选：该教务系统的作息时间
  courses: [
    {
      name: '某门课', teacher: '某老师', note: null, color: null,
      sessions: [
        { day: 1, from: 1, to: 2, location: '某楼 101', weeks: [1, 2, 3] }   // day: 1 = 周一
      ]
    }
  ]
}
```

- `timetable` 整体可以省略；省略时用应用自己的默认值（名称「导入的课程表」）。运行流程只在
  `semesterMeta` / `semesterLabel` 真的给出内容时才带上它，不会传一堆空字段。
- `periods` 传了就表示「这个教务系统自带上课时间」，应用会据此在确认弹窗里让用户选择是否新建作息表。

### 6.2 字段与限制

| 字段 | 规则 |
|---|---|
| `schema` | 必须是 `1`。新增可选字段不需要升版本（应用忽略未知键） |
| `courses` | 必须有且非空，**上限 1000 门** |
| `courses[i].sessions` | 必须有且非空 |
| `day` | 1–7（1 = 周一） |
| `from` / `to` | `from ≥ 1`；`to ≥ from`；`to ≤ 60` |
| `weeks` | 非空数组，每项 ≥ 1；**是数组，不是区间字符串** |
| `timetable.totalWeeks` | 1–30 |
| `timetable.startDate` | `yyyy-MM-dd` |
| `periods` | 可选；给了就要完整：`period` 在 1–60 且不重复，`start`/`end` 形如 `HH:mm`，`end` 晚于 `start` |

应用**故意不校验**的两件事（它们是「不匹配」而不是错误，所以照常写入并提示用户）：

- 课程用的节次是否在目标作息表里定义过 → 提示「第 N 节未在所选作息表中定义」+「去修改作息表」；
- 周次是否在学期总周数之内 → 提示「第 N 周超出课程表的 M 周」，**不裁剪**。

丢掉它们等于丢掉教务系统确实报出来的课，所以两边都选择「照常写入 + 明确告诉用户」。

### 6.3 `normalizeRow` 的返回约定

`normalizeRow` 可以返回：

| 返回 | 含义 |
|---|---|
| 一个对象 | 一条课时 |
| 对象数组 | 一行装多门课 |
| `{ skip: '原因' }` | 明确跳过，**原因会出现在提示与试跑摘要里** |
| `null` / `undefined` | 跳过（记为「字段缺失或越界」） |

一个对象里运行流程会用到的字段：

| 字段 | 必需 | 说明 |
|---|---|---|
| `name` | 是 | 课程名 |
| `day` / `from` / `to` | 是 | 必须落在合法范围，否则整行被记为跳过 |
| `weeks` | 是 | 非空数组 |
| `location` | 否 | 上课地点 |
| `teacher` | 否 | 授课教师；同一门课的多个教师会用「、」连接 |
| `groupKey` | 否 | **课程身份**。同一 `groupKey` 的行会被归为同一门课；不写则用 `name` |

> `groupKey` 值得认真对待：如果同一门课一周上两次（不同时段），用默认的 `name` 分组是对的；
> 但如果教务系统把「导论」拆成多个教学班分别报出，按 `name` 分组会把它们并成一门课。
> 反过来，如果用「时段」当分组键，同一门课的两次课会被拆成两门课——**这是实测中最容易犯的错**。

### 6.4 运行流程替你做掉的事

| 行为 | 说明 |
|---|---|
| 学期选择 | 有 `currentSemester` 就用它，否则弹选择框（最多 24 项） |
| 跳过统计 | 行被跳过时计数并**收集原因**（最多列 5 条，避免提示框被噪声撑满） |
| 时段合并（第一步） | 同一天、同起止、同地点、**只有周次不同**的行 → 合并，周次取并集（单双周分开返回的部署就是这样） |
| 时段合并（第二步） | **同一天 + 同地点 + 同周次集合 + 首尾相接**的相邻节次（1 与 2）→ 合并成一条 |
| 作息时间校验 | 不合法的条目**丢掉并记日志**（不是报错——作息表是附加信息，一条坏数据不该让整次导入失败） |
| 载荷组装 | 带上 `schema`、`timetable`、`periods`、`courses` |
| 提交 | 通过桥交给应用；用户确认后才写库 |

第二步合并可以用 `config.mergeAdjacentSections: false` 关掉：极少数教务把同一门课的两节安排成
「真的分成两节课」。

### 6.5 周次解析：最容易出错的地方

`ctx.parseWeeks(raw)` 按 `config.weeksEncoding` 解析，支持三种取值：

| `weeksEncoding` | 输入 | 例子 |
|---|---|---|
| `bitmap` | 0/1 位图，第 i 位 = 第 i+1 周 | `'111100000000000000'` |
| `text` | 范围串/列表/带单双周标记 | `'1-16周'`、`'1,3,5周'`、`'1-16周(单)'`、`'2-16周(双)'`、`'1-8周(单),9-16周(双)'`、`'3周改'` |
| `auto`（默认） | 按内容判断 | 长 0/1 串走 bitmap，否则走 text |

`text` 的解析规则：

- 先按 `,`、`，`、`、`、`;`、`；`、空白切段；**单双周标记只作用于它所在的那一段**（所以 `1-8周(单),9-16周(双)` 是对的）；
- 每段去掉括号、`周`、`改` 之后取数字：段内有 ≥2 个数字**且**带 `-`/`~`/`至` 才算区间，否则每个数字都当独立周次；
- `改`（调课周）只当普通周次——课表里没法表达「这一周被调走了」；
- 全角括号、裸的「单」/「双」都能识别。

**解析不了时抛错，而不是猜。** 这是刻意设计的：把 `第1-2节` 当成周次、或把 `1-16周(单)` 里的 `(单)`
丢掉，都会在**不报错**的情况下产出一张错误课表，比直接失败更糟。会抛错的情况包括：

| 输入 | 为什么 |
|---|---|
| 含「节」的文本 | 看起来是节次而不是周次 |
| 含 `HH:mm` 的文本 | 看起来是时刻而不是周次 |
| 超出 `1–60` 的周次 | 一定是把别的字段当成了周次 |
| 反向区间（`16-1`）、过大的区间 | 会产出上万条周次 |
| 声明 `bitmap` 但内容不是 0/1 | 把文本周次当位图展开会安静地算错 |
| 什么都解析不出来 | —— |

抛错会被运行流程记成一条**带原因**的跳过记录，出现在提示与试跑摘要里。

另外，`ctx.parseSections` 也是同一个原则：只接受「单节」与「连续区间」。
`1,3` 这种非连续写法**返回 `null`**，让这一行被记进「跳过的行」，而不是悄悄算成 1–3 把没上的课也画进去。
它还会先摘掉文本里的时刻，因为课表的行头常写成 `第1-2节 08:00-09:40`，直接抓数字会把 `08:00` 也当成节次。

---

## 7. 发布与 CI

### 7.1 一个发布工具，一个开发工具

```powershell
# 发布：生成 source-index.json（唯一的发布物，CI 校验的就是它）
pwsh ./tools/Build-SourceIndex.ps1
pwsh ./tools/Build-SourceIndex.ps1 -Check
pwsh ./tools/Build-SourceIndex.ps1 -IndexVersion 12   # 指定版本号（一般不需要）

# 开发：把某份方案拼成自包含脚本写到 dist/，用来在浏览器控制台里试跑
pwsh ./tools/Build-TestScript.ps1
pwsh ./tools/Build-TestScript.ps1 -Preset <presetId>
pwsh ./tools/Build-TestScript.ps1 -Preset <presetId> -Output .\tmp\try.js
```

`Build-TestScript.ps1` 不参与发布，也不在 CI 里跑；它拼出的字节与应用在设备上组装出来的应当一致。
它同样会校验变化点名字与 `apiVersion`，所以本地试跑之前就能发现写错的取值。

`-Check` 与正常生成做的是同一件事（先发现不一致，再决定是否写），所以 CI 用的就是 `-Check`。

### 7.2 发布工具会拒绝什么

`Build-SourceIndex.ps1`（CI 跑的就是它）会拒绝下面这些，都会指明是哪个目录的哪个字段：

- `id` 不符合 `^[a-z0-9][a-z0-9-]{1,63}$`（它会成为路径的一部分）
- `group` 不是 `UNDERGRADUATE` / `POSTGRADUATE` / `GENERAL`
- `initial` 不是单个大写字母
- `name` / `description` / `maintainer` 为空，或 `schoolId` 在 `schools/` 下不存在
- `startUrl` 不是 `https://` 开头
- `family` 指向的族不存在，或 `config` 里出现族没声明过的键
- 族要求的 `apiVersion` 高于 `lib/runner.js` 的 `RUNNER_API_VERSION`
- 既没有 `family`，也没有自己的 `script.js`

### 7.3 CI

`.github/workflows/validate.yml` 对每个提交运行 `Build-SourceIndex.ps1 -Check` 与 `node --test`：
只要 `source-index.json` 与来源不一致就失败，`config` 里写错变化点名字、族声明了高于
`RUNNER_API_VERSION` 的 `apiVersion` 也都在这里被拦下。这样不会出现「改了适配器但忘了重新生成索引」。

### 7.4 版本与兼容

| 字段 | 含义 |
|---|---|
| `source-index.json` 的 `schemaVersion` | 索引格式版本，当前为 `2`。字段增删要同时改应用侧的 `ImportSourceIndexParser` |
| `indexVersion` | **内容版本**，生成器在内容变化时自动递增。应用只要求它存在且 ≥1，**不用它拒绝旧版本**：重复导入同一来源是「整份替换」。递增仍然要做——它是排查「用户手上是哪一版」的唯一线索 |
| `family.json` 的 `apiVersion` | 该族按哪一版运行流程编写。**高于 `RUNNER_API_VERSION` 会被生成器拒绝**，避免旧应用跑到一半才失败 |

---

## 8. 本地校验与试跑

```powershell
node --test                                        # 单元测试
pwsh ./tools/Build-SourceIndex.ps1 -Check          # 发布物是否与来源一致
pwsh ./tools/Build-TestScript.ps1 -Preset <presetId>   # 拼出一份自包含脚本，供试跑
node --check presets/my-university/script.js       # 形态 C 手写脚本的语法自检
```

`tests/` 覆盖运行流程里最容易出错的三块：

`tests/` 分成两组：运行流程（`runner-*.test.mjs`）与探测脚本（`recon-redaction` / `probe-smoke`）。

| 文件 | 覆盖 |
|---|---|
| `tests/runner-weeks.test.mjs` | 周次解析（15 例）：位图、区间与列表、单周/双周、多段各自标记、`改`、以及**该抛错的各种误读** |
| `tests/runner-sections.test.mjs` | 节次解析（6 例）：连续区间的各种写法、单节、带时刻的行头、非连续写法返回 `null`、越界与空值 |
| `tests/runner-payload.test.mjs` | 载荷组装（6 例）：`periods` 传不传、`timetable` 字段来源、作息时间补零排序与丢弃计数 |
| `tests/recon-redaction.test.mjs` | 探测脚本的脱敏（14 例）：骨架化、位图单独处理、路径/参数/请求体的处理，以及**报告里搜不到原始值** |
| `tests/probe-smoke.test.mjs` | 探测脚本的浏览器分支（5 例）：装得上、抓得到、报告可解析、规则外的字符走兜底并给出警告 |

**已知缺口**：时段合并（`mergeSessions`）与课程分组（`groupCourses`）目前**没有单元测试**。
这两个函数是对数组的纯数据变换，不需要 DOM，补测试并不难；而它们正是「同一门课被拆成两门」这类问题的来源，
欢迎补上。

### 不用进应用就能试跑

在桌面浏览器里打开自己学校的教务系统并登录，用 `pwsh ./tools/Build-TestScript.ps1 -Preset <id>`
拼出脚本，把 `dist/<id>.js` 整段粘进 DevTools 控制台回车。

没有桥时脚本走**试跑分支**：只解析、打印一段摘要，不写任何数据。摘要刻意**不含课程名与个人信息**
（这是给贡献者贴到公开场合用的；字段名与计数才是有用信息）：

```json
{
  "注意": "当前不在应用内（没有桥），只解析未写库",
  "方案": "…", "学期": "…", "总周数": 18, "开学日期": "2025-09-01",
  "课程数": 12, "课时数": 30, "作息节次": 12, "被丢弃的作息条目": 0,
  "跳过的行": 2, "跳过原因": ["字段缺失或越界×2"],
  "响应字段名": ["kcmc", "xm", "xqj", "jcs", "zcd", "cdmc"],
  "首个时段": { "day": 1, "from": 1, "to": 2 }
}
```

摘要里出现「跳过的行」且原因集中在某一类，通常就是变化点没配对——回去看这个族的 `CHANGEPOINTS.md`。

---

## 9. 提交前检查清单

1. `node --test` 与两个 `-Check` 都通过。
2. 已经**在真实教务系统上跑通过一次**（见下）。没有实测过的学校条目**不要提交**。
3. 用 DevTools 试跑过，摘要里的课程数、课时数与跳过的行都合理。
4. `preset.json` 的 `config` 只写了与族默认值**不同**的项，并且每一项都在 `CHANGEPOINTS.md` 里。
5. `description` 写清了适用系统、使用前提与已知限制；`maintainer` 填了你的 GitHub ID。
6. 提交信息说明：适用系统、实测到哪一步、已知限制。

**没有实际验证过的学校条目不要提交**：发给用户的每一条都应该是能跑通的。

### 首次实测要核对什么

每个族的 `CHANGEPOINTS.md` 末尾都列了该族第一次上真实系统时要核对的项目
（接口路径、字段名、选择器、参数取值、总周数假设……）。这就是那份清单的用途。

---

## 10. 审阅与安全要求

脚本在用户的**登录会话里、应用的 WebView 内**执行，所以它是攻击面。合并前按以下标准审阅：

- 只访问**同源**的教务系统接口；不允许请求第三方域名（包括统计、CDN、短链）。
  （`ctx.http.*` 已经在代码里强制同源，但审阅时仍要看有没有绕过它的写法。）
- **不得**把用户凭据、Cookie、学号、姓名带出登录会话：不打印、不写进诊断信息、不发给第三方。
  诊断信息只应包含字段名与计数。唯一的例外是教务系统自己要求的请求参数——个别族需要从页面上
  读出学号并直接发给同一个教务系统才能取到课表，这类取值要在该族 `CHANGEPOINTS.md` 里注明。
  （课程载荷里的教师姓名属于课程信息。）
- 不得写入与课程表无关的内容；提交的载荷只能是课程与学期信息。
- 不得有绕过用户确认直接落库的路径。
- 任何写操作（选课、评教、申请、提交表单）一律不接受。

审阅重点按影响面排序：

1. **`lib/runner.js`** —— 所有方案共用，改动影响全部；
2. **`families/<id>/adapter.js`** —— 该族全部学校共用；
3. **`presets/<id>/override.js`** —— 只影响一所学校，但仍会执行任意代码；
4. **`config` 取值** —— 最容易审，也最应该优先接受贡献的方式。

发现问题请在 Issue 里指出；确认存在风险的方案会被移除，并在下一次 `indexVersion` 递增时下发给所有用户。

---

## 11. 参与贡献

欢迎提交 PR 贡献你的学校的导入方案🥰！
