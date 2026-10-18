# 变化点清单 · eams-urp

| 变化点 | 默认取值 | 说明 |
|---|---|---|
| `scheduleAction` | `/eams/courseTableForStd.action` | 课表接口 |
| `scheduleQuery` | 空 | 需要固定查询串时填 |
| `semesterParam` | `semester` | 学期参数名 |
| `semesterSelectSelectors` | `#semester` 等 | 页面上学期下拉框的候选选择器 |
| `semesterYears` | `4` | 页面上没有下拉框时本地合成几个学年 |
| `assumedTotalWeeks` | `18` | 总周数假设值（该族不给，此值会显示在确认弹窗里） |
| `responseShape` | `json` | `json` 或 `jsVariable`（页面那种 `var activities = {…};`） |
| `jsVariableNames` | `activities` / `courseTable` / `kbData` | `jsVariable` 模式下依次尝试的变量名 |
| `rowContainer.path` | `activities` | 行数组位置；找不到时退让到同名嵌套与「响应里唯一的数组字段」 |
| `weeksEncoding` | `text` | 周次编码 |
| `fields.*` | `courseName` / `teachers` / `dayOfWeek` / `sections` / `startPeriod` / `endPeriod` / `weeks` / `room` / `teachingClassId` / `courseCode` | 字段映射 |
| `sectionTimesSelectors` | `#kbTable td:first-child` 等 | 从页面上读作息时间的候选选择器 |
| `mergeAdjacentSections` | `true` | 该族按「每节一行」返回，相邻节次需要合并 |

## 未实测的部分（重要）

只依据该族公开的接口形状编写，没有在真实教务系统上跑过。第一次实测重点核对：

- 课表接口的 action 与参数名（该族的 `courseTableForStd.action` 有时还要带学生 id 或 `ids`）；
- 响应到底是 JSON 还是 `var xxx = {…};`（先用 `responseShape: json` 试，报错再换 `jsVariable`）；
- 行数组的容器键名与字段名；
- 节次是「每节一行」还是「一条含起止节次」——两种都支持（有 `startPeriod`/`endPeriod` 就优先用它）。

宽松解析（`jsVariable` + 单引号退让）是为了容错，不是鼓励不规范：如果解析失败，错误信息会说明用的是哪种形状，
改取值即可，不需要改代码。
