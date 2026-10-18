// SleepIn 导入脚本 · 族适配器：金智 jwapp（课表模块的 JSON 接口）
//
// 该族的行数组统一在 `datas.<模块>.rows` 里（所以 rowContainer 用 `datas.*.rows` 这个通配写法），
// 行内字段是一组固定缩写：课程名 KCM、教师 SKJS、星期 SKXQ、起止节次 KSJC/JSJC、周次 SKZC、教室 JASMC。
//
// 同一族里有几个「子形」（取主课表的接口不同：xskcb / cxxszhxqkb / kbapp 的 api 路径），
// 这里**不用代码分支**，而是让取值去表达：一个部署用一个子形，preset.json 里改 `scheduleAction`
// 与（必要时）`rowContainer` 即可。这样同一个适配器能服务三种子形，也不必让探测去区分它们
// ——探测只需要回答「我在不在金智的教务页面上」。
//
// 调课/停课是这一族最容易被漏掉的一部分：主课表只是「计划」，`changeAction` 返回的变更记录才是实情。
// 不处理它会安静地导入一张过期的课表，所以这里必须合并（见 mergeChangeRows）。
//
// 参考来源说明：只依据该族公开的接口形状（路径、参数名、响应键名与字段缩写）重写，
// 合并策略、字段退让与降级处理都是本项目的写法。

// 按周取课时最多遍历多少周：配置接口给出的总周数明显不合理时用它兜底，避免发出几百个请求。
const MAX_WEEKLY_FETCH_WEEKS = 60;

const familyAdapter = {
  /** 探测：页面路径里有没有 jwapp 这一段。 */
  async detect(ctx) {
    const path = String(ctx.pagePath() || '').toLowerCase();
    if (path.indexOf('/jwapp/') >= 0) return true;
    if (path.indexOf('login') >= 0 || path.indexOf('authserver') >= 0) {
      return '当前在登录/认证页。请先完成登录，并进入课表页面后再执行导入。';
    }
    return '当前页面不在金智教务系统里（路径里没有 /jwapp/）。';
  },

  /** 学期列表：该族有接口，直接问。 */
  async listSemesters(ctx) {
    const response = await ctx.http.postForm(
      String(ctx.config.semesterListAction || ''),
      String(ctx.config.semesterListBody || '')
    );
    const rows = this.rowsFor(response.json(), ctx);
    if (!rows.length) throw new Error('学期列表是空的');

    const codeField = String(ctx.config.semesterField || 'DM');
    const labelField = String(ctx.config.semesterLabelField || 'MC');
    const mapped = rows.map((row) => this.semesterFromRow(row, codeField, labelField));
    const withCode = [];
    for (let i = 0; i < mapped.length; i += 1) {
      if (mapped[i].code) withCode[withCode.length] = mapped[i];
    }
    return withCode.sort((a, b) => b.code.localeCompare(a.code));
  },

  /** 当前学期：有的部署只给「当前学期」这一个接口，用它省掉一次选择。 */
  async currentSemester(semesters, ctx) {
    const action = String(ctx.config.currentSemesterAction || '');
    if (!action) return null;
    try {
      const response = await ctx.http.postForm(action, '');
      const row = this.rowsFor(response.json(), ctx)[0];
      if (!row) return null;
      const code = String(ctx.pickFrom(row, String(ctx.config.semesterField || 'DM')) || '').trim();
      for (let i = 0; i < semesters.length; i += 1) {
        if (semesters[i].code === code) return semesters[i];
      }
      return null;
    } catch (error) {
      // 拿不到就当没有：运行流程会弹选择框，用户自己选。
      ctx.log('当前学期接口不可用：' + (error && error.message ? error.message : error));
      return null;
    }
  },

  semesterCode(semester) {
    return semester.code;
  },

  semesterLabel(semester) {
    return semester.label;
  },

  /**
   * 学期元信息：总周数与开学日期来自课表配置接口（要学年 + 学期两个参数）。
   */
  async semesterMeta(semester, ctx) {
    const action = String(ctx.config.semesterMetaAction || '');
    if (!action) return { name: semester.label };

    const response = await ctx.http.postForm(action, this.semesterSplitBody(semester, ctx));
    const row = this.rowsFor(response.json(), ctx)[0];
    if (!row) return { name: semester.label };

    const totalWeeks = Number(this.firstNumber(row, ['ZZC', 'ZC', 'zxs']));
    const startDate = String(this.firstValue(row, ['XQKSRQ', 'XQKSRQ_STR', 'KSRQ']) || '').match(/^\d{4}-\d{2}-\d{2}/);
    return {
      name: semester.label,
      totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : null,
      startDate: startDate ? startDate[0] : null
    };
  },

  /**
   * 课表行：主课表 + 变更记录。
   *
   * 两次请求都必须发：只取主课表会导入一张不含停课/调课的课表，而且不会报错。
   *
   * 有的部署的主课表接口是**按周**返回的：请求里要带周次，一学期得问 N 次。这种部署在
   * `scheduleWeekParam` 里填上周次参数名（如 `SKZC`），下面就会从第 1 周遍历到总周数，把每周的行
   * 拼在一起，同一时段的周次由运行流程的合并求并集。留空则保持「一次请求拿全」的行为。
   */
  async fetchSchedule(semester, ctx) {
    const param = String(ctx.config.scheduleParam || 'XNXQDM');
    const weekParam = String(ctx.config.scheduleWeekParam || '');
    const scheduleBody = param + '=' + encodeURIComponent(semester.code);

    const baseRows = await this.fetchRows(String(ctx.config.scheduleAction || ''), scheduleBody, weekParam, semester, ctx, '课表');
    if (!baseRows.length) throw new Error('课表接口没有返回行');

    const changeAction = String(ctx.config.changeAction || '');
    if (!changeAction) return baseRows;

    let changeRows = [];
    try {
      changeRows = await this.fetchRows(changeAction, scheduleBody, weekParam, semester, ctx, '调课/停课记录');
    } catch (error) {
      // 变更记录拿不到时继续导入计划课表，但要留下痕迹：用户可能在预览里看到过期的课表。
      ctx.log('调课/停课记录读取失败，本次只导入计划课表：' + (error && error.message ? error.message : error));
      return baseRows;
    }

    return this.mergeChangeRows(baseRows, changeRows, ctx);
  },

  /**
   * 取一个接口的行：`weekParam` 为空只请求一次，非空则按周遍历再拼起来。
   *
   * 某一周拿不到数据（该周没有课、接口报错）不该让整次导入失败：其余周次照常取，原因写进诊断日志。
   */
  async fetchRows(action, scheduleBody, weekParam, semester, ctx, label) {
    if (!weekParam) {
      const response = await ctx.http.postForm(action, scheduleBody);
      return this.rowsFor(response.json(), ctx);
    }

    const totalWeeks = await this.totalWeeks(semester, ctx);
    const rows = [];
    for (let week = 1; week <= totalWeeks; week += 1) {
      try {
        const response = await ctx.http.postForm(action, scheduleBody + '&' + weekParam + '=' + week);
        this.rowsFor(response.json(), ctx).forEach((row) => rows.push(row));
      } catch (error) {
        ctx.log(label + '第 ' + week + ' 周读取失败：' + (error && error.message ? error.message : error));
      }
    }
    return rows;
  },

  /**
   * 按周取数需要知道总周数：先问配置接口，拿不到再用 `assumedTotalWeeks` 的假设值。
   *
   * 运行流程稍后也会调一次 `semesterMeta`（填 timetable 用），这里不共享结果：多一次请求，换来
   * 「适配器自己就能算出总周数」，比在 ctx 上偷偷缓存干净。
   */
  async totalWeeks(semester, ctx) {
    let totalWeeks = NaN;
    try {
      const meta = await this.semesterMeta(semester, ctx);
      totalWeeks = Number(meta && meta.totalWeeks);
    } catch (error) {
      ctx.log('学期总周数读取失败，改用假设值：' + (error && error.message ? error.message : error));
    }
    if (!Number.isFinite(totalWeeks) || totalWeeks <= 0) totalWeeks = Number(ctx.config.assumedTotalWeeks);
    if (!Number.isFinite(totalWeeks) || totalWeeks <= 0) throw new Error('拿不到总周数，无法按周取课表');

    const weeks = Math.floor(totalWeeks);
    if (weeks > MAX_WEEKLY_FETCH_WEEKS) {
      ctx.log('总周数 ' + weeks + ' 超出按周取数的上限，只取前 ' + MAX_WEEKLY_FETCH_WEEKS + ' 周。');
      return MAX_WEEKLY_FETCH_WEEKS;
    }
    return weeks;
  },

  /**
   * 把变更记录合并进主课表。
   *
   * 两类变更，按 `changeTypeField` 区分：
   *   · 属于 `changeAddTypes`：这条记录描述一个新时段，字段用 X 前缀写，把它变成普通行后追加；
   *   · 其余：表示「原时段在这几周不上」，从匹配到的原行里删掉这些周次。
   *
   * 匹配键是「教学班 + 星期 + 起止节次」，所以同一门课的不同时段不会互相影响。
   */
  mergeChangeRows(baseRows, changeRows, ctx) {
    const addTypes = (ctx.config.changeAddTypes || []).map((value) => String(value));
    // 一个时段可能有多行（按周取数的部署里，同一个时段每周一行）。必须全部收下来，否则
    // 「停掉某几周」只会作用在其中一行上，其余周次会安静地留在课表里。
    const bySlot = new Map();
    baseRows.forEach((row) => {
      const key = this.slotKey(row, ctx);
      if (!key) return;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(row);
    });

    const added = [];
    changeRows.forEach((row) => {
      // 变更行的取值在 X 前缀字段上，先搬回基准字段：下面算时段键、当新时段用到的都是这一份。
      const converted = this.changeRowToBaseRow(row, ctx);

      const type = String(this.firstValue(row, [String(ctx.config.changeTypeField || 'TKLXDM')]) || '').trim();
      if (addTypes.indexOf(type) >= 0) {
        added.push(converted);
        return;
      }

      // 变更行按 `changeFields` 声明用 X 前缀字段，但基准字段里可能是**原时段**（有的部署两种都填），
      // 所以先用原行算（与此前行为一致），算不出来再退回 X 前缀——否则「只填了 X」的部署会被静默忽略。
      const bucket = bySlot.get(this.slotKey(row, ctx) || this.slotKey(converted, ctx));
      if (!bucket) return;

      // 周次既可能来自字段也可能来自上一次合并的结果，所以统一用「已算出的周次」再相减。
      const removed = this.weeksOf(row, ctx, true);
      if (!removed.length) return;
      bucket.forEach((base) => {
        const current = this.weeksOf(base, ctx);
        if (!current.length) return;
        // 算完的周次放在 __weeks 上，normalizeRow 会优先用它：原字段是位图还是文本由部署决定，
        // 不该为了「删几周」去改写门户自己的编码。
        const kept = [];
        for (let i = 0; i < current.length; i += 1) {
          if (removed.indexOf(current[i]) < 0) kept[kept.length] = current[i];
        }
        base.__weeks = kept;
      });
    });

    return baseRows.concat(added);
  },

  /** 一行 → 一条课时。节次与周次都交给共享库解析。 */
  normalizeRow(row, ctx) {
    if (Array.isArray(row.__weeks) && !row.__weeks.length) return { skip: '调课后没有剩余周次' };

    const weeks = Array.isArray(row.__weeks) ? row.__weeks : ctx.parseWeeks(ctx.pick(row, 'weeks'));
    if (!weeks.length) return { skip: '周次为空' };

    const from = Number(ctx.pick(row, 'from'));
    const to = Number(ctx.pick(row, 'to'));
    if (!Number.isInteger(from) || !Number.isInteger(to)) return { skip: '节次字段缺失' };

    return {
      name: ctx.pick(row, 'name'),
      teacher: this.cleanTeacher(ctx.pick(row, 'teacher')),
      day: Number(ctx.pick(row, 'day')),
      from: from,
      to: to,
      location: ctx.pick(row, 'location') || null,
      weeks: weeks,
      // 分组键是**课程身份**，不是时段：同一门课一周上两次要折成「一门课两个时段」，
      // 不能变成两门课。时段身份（slotKey）只在合并调课记录时用。
      groupKey: this.courseKey(row, ctx)
    };
  },

  /** 课程身份：教学班 → 课程名 + 教师。 */
  courseKey(row, ctx) {
    const order = Array.isArray(ctx.config.groupKeyOrder) ? ctx.config.groupKeyOrder : [];
    const parts = [];
    order.forEach((field) => {
      const value = ctx.pick(row, field);
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        parts.push(field + ':' + String(value).trim());
      }
    });
    if (parts.length) return parts.join('|');

    const name = String(ctx.pick(row, 'name') || '').trim();
    const teacher = String(ctx.pick(row, 'teacher') || '').trim();
    return 'name:' + name + '|teacher:' + teacher;
  },

  /**
   * 作息时间：该族的节次接口是独立的一个请求，拿得到就带上，拿不到就算了。
   */
  async timeSlots(semester, ctx) {
    const action = String(ctx.config.sectionTimesAction || '');
    if (!action) return [];

    const fields = ctx.config.sectionTimeFields || {};
    const response = await ctx.http.postForm(action, '');
    return this.rowsFor(response.json(), ctx).map((row, index) => {
      const declared = Number(ctx.pickFrom(row, fields.period));
      return {
        period: Number.isInteger(declared) && declared > 0 ? declared : index + 1,
        start: ctx.pickFrom(row, fields.start),
        end: ctx.pickFrom(row, fields.end)
      };
    });
  },

  // ---------------------------------------------------------------- 内部工具

  /** 学期行 → 学期对象；代码里常带「学年-学期」，顺便劈出两个参数给配置接口用。 */
  semesterFromRow(row, codeField, labelField) {
    const code = String(row[codeField] === undefined ? '' : row[codeField]).trim();
    const label = String(row[labelField] === undefined ? '' : row[labelField]).trim();
    const parts = code.split('-');
    return {
      code: code,
      label: label || code,
      year: parts.length >= 3 ? parts[0] + '-' + parts[1] : parts[0] || '',
      term: parts.length >= 3 ? parts[2] : ''
    };
  },

  /** 配置接口要的是「学年 + 学期」两个参数，参数名由取值决定。 */
  semesterSplitBody(semester, ctx) {
    const split = ctx.config.semesterSplit || {};
    const yearKey = String(split.year || 'XN');
    const termKey = String(split.term || 'XQ');
    return yearKey + '=' + encodeURIComponent(semester.year || '') + '&' + termKey + '=' + encodeURIComponent(semester.term || '');
  },

  /**
   * 匹配同一时段的键：教学班 + 星期 + 起止节次。读的是 `config.fields` 里的字段名。
   *
   * 变更行可能只填了 `config.changeFields` 的 X 前缀字段，所以调用方不能只算一次：先用原行算
   * （基准字段里可能是**原时段**），算不出来再把变更行过一遍 `changeRowToBaseRow` 再算。
   * 少了这一步，那种部署的停课/调课会被**静默忽略**（跳过的行仍然是 0）。
   */
  slotKey(row, ctx) {
    const classId = String(ctx.pickFrom(row, (ctx.config.fields || {}).classId) || '').trim();
    const day = String(ctx.pickFrom(row, (ctx.config.fields || {}).day) || '').trim();
    const from = String(ctx.pickFrom(row, (ctx.config.fields || {}).from) || '').trim();
    const to = String(ctx.pickFrom(row, (ctx.config.fields || {}).to) || '').trim();
    if (!classId || !day || !from) return null;
    return classId + '|' + day + '|' + from + '|' + to;
  },

  /** 一行的周次（数组）：可以直接从字段解析，也可以取上次合并的结果。 */
  weeksOf(row, ctx, forChangeRow) {
    if (!forChangeRow && Array.isArray(row.__weeks)) return row.__weeks;
    const path = forChangeRow
      ? (ctx.config.changeFields || {}).weeks
      : (ctx.config.fields || {}).weeks;
    if (!path) return [];
    const raw = ctx.pickFrom(row, path);
    if (raw === undefined || raw === null || raw === '') return [];
    try {
      return ctx.parseWeeks(raw);
    } catch (error) {
      return [];
    }
  },

  /**
   * 变更行 → 普通行：把 X 前缀字段搬到基准字段上。
   *
   * X 字段为空时退回基准字段（有的部署只填了其中一部分），这样 normalizeRow 只需要认识一种形状。
   */
  changeRowToBaseRow(row, ctx) {
    const base = ctx.config.fields || {};
    const change = ctx.config.changeFields || {};
    const converted = {};
    Object.keys(base).forEach((key) => {
      const changePath = change[key];
      const changeValue = changePath ? ctx.pickFrom(row, changePath) : undefined;
      const usable = changeValue !== undefined && changeValue !== null && String(changeValue).trim() !== '';
      converted[base[key]] = usable ? changeValue : ctx.pickFrom(row, base[key]);
    });
    return converted;
  },

  /** 取行数组：优先用声明的容器，其次类名相同的嵌套，最后是响应里唯一的数组字段。 */
  rowsFor(json, ctx) {
    const rows = ctx.rowsFrom(json);
    if (rows.length) return rows;

    const declared = (ctx.config.sectionTimesContainer || ctx.config.rowContainer || {}).path;
    if (declared) {
      const nested = ctx.pickFrom(json, 'data.' + declared);
      if (Array.isArray(nested)) return nested;
    }
    const keys = Object.keys(json || {});
    const arrays = [];
    for (let i = 0; i < keys.length; i += 1) {
      if (Array.isArray(json[keys[i]])) arrays[arrays.length] = json[keys[i]];
    }
    return arrays.length === 1 ? arrays[0] : [];
  },

  /** 教师可能带工号（"姓名/工号"），只留姓名。 */
  cleanTeacher(value) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    if (!text) return null;
    return text.split(/[\/、,，]/)[0].trim() || null;
  },

  /** 按候选字段名取第一个非空值。 */
  firstValue(row, names) {
    for (let i = 0; i < names.length; i += 1) {
      const value = row ? row[names[i]] : undefined;
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
  },

  /** 按候选字段名取第一个可用的数字。 */
  firstNumber(row, names) {
    const value = this.firstValue(row, names);
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }
};
