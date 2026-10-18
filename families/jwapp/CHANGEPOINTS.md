# 变化点清单 · jwapp

对照本表逐项检查，比读整个适配器快。取值都能表达时**不需要写代码**，只改 `presets/<id>/preset.json`。

| 变化点 | 默认取值 | 说明 |
|---|---|---|
| `scheduleAction` | `…/xskcb/cxxszhxqkb.do` | 主课表接口；**子形不同就改这里**（`xskcb.do` / `kbapp/api/...` 均可） |
| `changeAction` | `…/xskcb/xsdkkc.do` | 调课/停课变更记录；留空则跳过合并（不推荐） |
| `semesterListAction` | `…/jshkcb/xnxqcx.do` | 学期列表 |
| `currentSemesterAction` | `…/jshkcb/dqxnxq.do` | 当前学期；读不到会退回让用户选 |
| `semesterMetaAction` | `…/jshkcb/cxjcs.do` | 总周数（`ZZC`）与开学日期（`XQKSRQ`） |
| `sectionTimesAction` | `…/jshkcb/jc.do` | 节次时间；拿不到就不提供作息时间 |
| `semesterListBody` | `*order=-DM` | 学期列表请求体 |
| `scheduleParam` | `XNXQDM` | 课表请求里学期参数的**参数名** |
| `scheduleWeekParam` | 空 | 主课表与调课接口**按周取数**时的周次参数名（如 `SKZC`），取值按 `1..总周数` 逐个传；留空 = 一次请求拿全一学期。若某部署的周次参数要的是日期或位图而不是周序号，这个取值装不下，得先补模型 |
| `semesterSplit` | `{year: XN, term: XQ}` | 配置接口要两个参数时的参数名 |
| `semesterField` / `semesterLabelField` | `DM` / `MC` | 学期行里的标识字段与显示名字段 |
| `rowContainer.path` | `datas.*.rows` | `*` 表示动态键名（该族的信封键就是模块名） |
| `weeksEncoding` | `auto` | 位图与文本都吃；若某部署混用，显式写 `bitmap` 或 `text` |
| `groupKeyOrder` | `classId`（= `KBID`） | 取不到时适配器退化为「课程名 + 星期 + 节次」 |
| `fields.*` | `KCM/SKJS/SKXQ/KSJC/JSJC/SKZC/JASMC/KBID` | 基准行字段 |
| `changeFields.*` | `XKCM/XSKJS/XSKXQ/XKSJC/XJSJC/XSKZC/XJASMC` | 调课行字段（X 前缀），空值会退回基准字段 |
| `changeTypeField` / `changeAddTypes` | `TKLXDM` / `01,03` | 判「追加新时段」还是「删原时段周次」 |
| `assumedTotalWeeks` | `16` | 配置接口拿不到总周数时的假设值 |

## 三个子形怎么切换（不用改代码）

| 子形 | 特征 | 要改的取值 |
|---|---|---|
| `wdkb` + `cxxszhxqkb.do` | 默认 | 无 |
| `wdkb` + `xskcb.do` | 主课表 action 不同 | `scheduleAction` |
| `wdkb` + `xsllsykb.do` | 主课表**按周**返回，调课接口同样按周（需要 `SKZC`） | `scheduleAction` + `scheduleWeekParam` |
| `kbapp` / `homeapp` | 路径里是 `/api/…/getMyScheduleDetail.do`，行数组在 `arrangedList` | `scheduleAction` + `rowContainer.path` + 必要时 `fields.*` |

## 已知的族内注意点

- **`xsllsykb.do` 子形按周返回**：不带 `scheduleWeekParam` 时只会拿到一周的课（不报错），要填 `SKZC` 按 `1..总周数` 逐周取。行内 `SKZC` 是**长度等于总周数的位图**（形如 `0100000…`，只有一个 1），所以这种子形用 `weeksEncoding: bitmap`。
- **学期元数据**：`cxjcs.do` 要 `XN` + `XQ` 两个参数；总周数是 `ZZC`，开学日期是 `XQKSRQ`。
- **族默认的节次接口 `jshkcb/jc.do` 在部分部署上不可用**（返回 403）。此时应用退化成「选用已有作息表」，课表本身不受影响。

## 未实测的部分

- 调课记录里表示「追加新时段」的类型码（默认 `01`/`03`）与 X 前缀字段名没有样本：变更接口返回 0 行时也无从核对；
- 节次时间接口的字段名（默认 `JC`/`QSSJ`/`JSSJ`）：`jc.do` 不可用的部署上拿不到样本；
- `kbapp` / `homeapp` 子形完全没有样本。

**变更行的时段键要算两次**：`slotKey` 读的是 `config.fields` 里的字段名，而变更行可能只填了 `config.changeFields` 的 X 前缀字段。所以 `mergeChangeRows` 先用原行算一次，算不出来再把变更行过 `changeRowToBaseRow` 再算一次——基准字段里可能是**原时段**，顺序不能反。改之前只算一次，那种部署的停课会被**静默忽略**（跳过的行仍然是 0）。这个形状用合成数据验过（停课周次能正确去掉）；**没有真实的变更行样本**。

**调课合并不能省**：不合并会安静地导入一张不含停课/调课的课表。合并失败时会往诊断日志里写一行，目前只在无桥试跑时可见。
