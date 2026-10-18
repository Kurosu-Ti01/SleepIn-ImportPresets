# 变化点清单 · chaoxing-jw

| 变化点 | 默认取值 | 说明 |
|---|---|---|
| `scheduleAction` | `/admin/api/schedule/list` | 课表接口（各部署路径差异大，需实测确认） |
| `semesterParam` | `xqdm` | 学期参数名 |
| `studentParam` | `xh` | 学号参数名。学号从页面上读出后**直接发给同一个课表接口**，不打印、不落盘（见 README 第 10 节的例外条款） |
| `campusParam` | `xqid` | 校区参数名 |
| `semesterSelectSelectors` | `#xqdm` 等 | 学期下拉框的候选选择器 |
| `campusSelectSelectors` | `#xqid` 等 | 校区下拉框的候选选择器 |
| `studentIdSelectors` | `#xh` 等 | 学号所在元素的候选选择器；**只**用于拼课表请求参数 |
| `semesterYears` | `3` | 页面上读不到学期时本地合成几个学年 |
| `assumedTotalWeeks` | `18` | 总周数假设值 |
| `rowContainer.path` | `data.list` | 行数组位置；找不到时退让到同名嵌套与「唯一的数组字段」 |
| `fields.*` | `courseName` / `teacherName` / `weekDay` / `sections` / `startSection` / `endSection` / `weekSections` / `roomName` / `classId` / `courseCode` | 字段映射 |
| `mergeAdjacentSections` | `true` | 相邻节次合并 |

## 该族特有的两点

1. **参数大多来自页面**。学期、校区、学号常常只存在于页面上的下拉框或隐藏输入框里，没有查询接口，
   所以适配器用 `ctx.pageValue` / `ctx.pageOptions` 读页面。
2. **校区是一步额外交互**。页面上能读到就用页面上的；读不到就弹选择框（`ctx.ask`）；再读不到就按空值请求
   —— 宁可少一个参数，也不猜一个校区。

## 未实测的部分（重要）

这一族是**最不确定**的一个：接口路径在不同部署之间差异很大，默认值很可能对不上。第一次实测时按顺序核对：

- 课表接口的真实路径与参数名（`scheduleAction` 默认值几乎肯定要改）；
- 行数组的容器与字段名；
- 学期 / 校区 / 学号在页面上的真实选择器；
- 节次字段是文本（`1-2节`）还是两个数字。

改不动的部分写 `override.js`；该族如果需要「分页式选择弹窗」或 iframe 取数，当前运行流程给不了，需要单独讨论。
