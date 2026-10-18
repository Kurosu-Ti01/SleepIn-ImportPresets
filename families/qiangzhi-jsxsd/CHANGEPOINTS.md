# 变化点清单 · qiangzhi-jsxsd

对照本表逐项检查，比读整个适配器快。取值都能表达时**不需要写代码**，只改 `presets/<id>/preset.json`。

| 变化点 | 默认取值 | 说明 |
|---|---|---|
| `scheduleAction` | `/jsxsd/xskb/xskb_list.do` | 课表页接口（返回整页 HTML） |
| `semesterParam` | `xnxq01id` | 学期参数名 |
| `semesterSelectSelectors` | `#xnxq01id` 等 | 页面上学期下拉框的候选选择器（用于读候选与当前值） |
| `semesterYears` | `4` | 页面上没有下拉框时，本地合成几个学年 |
| `assumedTotalWeeks` | `20` | **总周数假设值**：该族不报告总周数，此值会显示在确认弹窗里 |
| `tableSelectors` | `#timetable` / `#kbtable` / … | 课表表格的候选选择器，**依次尝试**（模板不同的部署靠这个吃下） |
| `headerRowSectionSelectors` | `td:first-child` 等 | 行头（节次那一列）的选择器 |
| `blockSplitter` | `-----` | 一个格子里多门课之间的分隔线 |
| `fieldTitles.teacher` | `老师` / `教师` | 教师所在内联标签的 title 文案 |
| `fieldTitles.location` | `教室` | 教室所在标签的 title |
| `fieldTitles.weekSection` | `周次(节次)` 等 | 周次与节次所在标签的 title |
| `sectionPattern` | `\[(\d+)(?:-(\d+))?节\]` | 从「周次(节次)」里抠节次的正则 |
| `dayColumnOffset` | `1` | 第几列开始是周一（第一列是节次） |
| `sectionTimesFromTableHeader` | `true` | 是否从行头读作息时间（行头写成「第 1-2 节 08:00-09:40」时可用） |
| `mergeAdjacentSections` | `true` | 该族按「每节一行」返回，相邻节次需要合并成一个时段 |

## 未实测的部分（重要）

本适配器只依据该族**公开的页面结构**编写，没有在真实教务系统上跑过。第一次实测重点核对：

- 表格与单元格的选择器（默认 `#timetable` / `#kbtable` / `.kbcontent`）；
- 带 title 的内联标签到底用「老师」还是「教师」，以及「周次(节次)」的写法；
- 行头里是否真的写了起止时刻（`sectionTimesFromTableHeader` 拿不到时会退化成「不提供作息时间」）；
- 学期下拉框的 id 与选项值格式。

节次与周次都由共享运行流程解析（`ctx.parseSections` / `ctx.parseWeeks`），所以这一族的**解析规则不需要每校重写**；
真正需要对的是选择器与字段文案。
