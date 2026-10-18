# 变化点清单 · example-portal（示例族，虚构）

这份清单就是**贡献者的检查表**：脚本读不出课时，照着一项一项对照看哪一项和你的学校不一样，
而不是读完整个适配器再重写。左边是适配器声明的变化点，右边是它的默认值。

一个部署只要能靠「取值」表达差异，就**不需要写代码**：只改 `presets/<id>/preset.json` 里的
`config`。全部取值都对不上时，才写 `presets/<id>/override.js` 覆盖某个具名环节。

| 变化点 | 默认取值 | 能否覆盖 | 说明 |
|---|---|---|---|
| `basePath` | `/portal/api` | 是 | 接口前缀 |
| `semesterListAction` | `semester/list` | 是 | 取学年学期列表 |
| `scheduleAction` | `schedule/list` | 是 | 取主课表 |
| `semesterMetaAction` | `semester/config` | 是 | 取总周数与开学日期 |
| `sectionTimesAction` | `section/times` | 是 | 取作息时间（节次 → 起止时刻）；这个部署不提供时，把 `timeSlots` 覆盖成返回 `null` |
| `semesterParam` | `semester` | 是 | 请求体里学期参数的**参数名** |
| `sectionTimeFields.*` | `period` / `startTime` / `endTime` | 是 | 作息时间行里三个字段分别叫什么 |
| `rowContainer.path` | `data.*.rows` | 是 | 行数组在响应里的位置；`*` 表示「取该对象的第一个键」，用于动态键名的信封 |
| `weeksEncoding` | `auto` | 是 | `bitmap`（长度=学期周数，第 i 位=第 i+1 周）/ 文本范围 / `auto`（按内容判断） |
| `groupKeyOrder` | `classId` → `courseCode` → `name` | 是 | 分组键的退化顺序。用课程名会把两个教学班合成一门课 |
| `fields.*` | 见 `family.json` | 是 | 课程名 / 教师 / 星期 / 起止节次 / 周次 / 教室 / 教学班 / 课程号 分别对应哪个字段；支持 `a.b` 形式的嵌套路径 |
| `semesterFields.code` | `code` | 是 | 学期标识字段 |
| `semesterFields.label` | `name` | 是 | 学期显示名字段 |
| 星期基准 | 1 = 周一 | **否** | 探测器按这一条校验；不符时直接报错，而不是猜 |
| 探测特征 | 页面路径含 `/portal/` | 需要在适配器里改 | 见 `adapter.js` 的 `detect()`：只用一个不需要发请求的特征 |

> 作息时间是**可选**的：适配器提供它，应用就会在确认弹窗里多给一个「用方案提供的作息表」选项；
> 不提供也不会错，只是用户得自己选一个已有作息表。返回的时刻请用 `'HH:mm'`（`'8:00'` 也会被
> 接受）；不合法的条目由运行流程丢掉并记日志，不需要适配器自己过滤。

## 用取值表达不了时

可以覆盖的环节（在 `override.js` 里重新定义其中一个即可，其余仍用适配器的实现）：

| 环节 | 覆盖它的典型场景 |
|---|---|
| `detect` | 部署把接口挪到了别的路径前缀 |
| `listSemesters` / `semesterCode` / `semesterLabel` | 学期不是列表接口，而是「当前学期」接口 |
| `currentSemester` | 页面不是下拉框，而是别的控件 |
| `fetchSchedule` | 课表要按「学年 + 学期」两个参数请求，或需要先调一个初始化接口 |
| `normalizeRow` | 一行里同时装了多门课，或字段需要拼装 |
| `semesterMeta` | 总周数与开学日期在别的接口、或需要从日期反推 |
| `timeSlots` | 作息时间在别的接口、需要多个请求拼起来、或该部署根本不提供（返回 `null`） |

覆盖只改一个环节、并在文件顶部写清「为什么要覆盖」。凡是能收敛成取值的差异，评审时都会要求回到
`config`（见 README 的评审清单：能降档就降档）。
