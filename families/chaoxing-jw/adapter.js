// SleepIn 导入脚本 · 族适配器：超星教务（页面参数 + JSON 接口）
//
// 该族的特点是「请求参数大多来自页面」：学期、校区、学号常常只存在于页面上（下拉框或隐藏输入框），
// 没有对应的查询接口。所以这个适配器用运行流程给的 ctx.pageValue / ctx.pageOptions 读页面，
// 读不到才退回本地合成的候选。
//
// 校区是这一族多出来的一步交互：能读到就自动用页面上的，读不到就让用户选（ctx.ask），
// 再读不到就按空值请求——宁可少一个参数，也不要猜一个校区。
//
// 该族按「每节一行」返回，所以连排合并默认打开。
//
// 参考来源说明：只依据该族公开的页面结构与接口形状重写，页面读取、降级与校区交互都是本项目的写法。

const familyAdapter = {
  /** 探测：页面路径或页面内容里带超星的标记。 */
  async detect(ctx) {
    const path = String(ctx.pagePath() || '').toLowerCase();
    if (path.indexOf('chaoxing') >= 0) return true;
    if (ctx.hasElement("#xqdm") && ctx.hasElement("#xh")) return true;
    if (path.indexOf('login') >= 0) return '当前在登录页，请先登录并进入课表页面。';
    return '当前页面不像超星教务的课表页（路径里没有 chaoxing，页面上也没有学期与学号字段）。';
  },

  /** 学期：页面下拉框优先，其次本地合成。 */
  listSemesters(ctx) {
    const selectors = ctx.config.semesterSelectSelectors || [];
    for (let i = 0; i < selectors.length; i += 1) {
      const options = ctx.pageOptions(selectors[i]);
      if (options.length) return options.map((option) => ({ code: option.value, label: option.label }));
    }
    return synthesizeSemesters(ctx);
  },

  currentSemester(semesters, ctx) {
    const selectors = ctx.config.semesterSelectSelectors || [];
    for (let i = 0; i < selectors.length; i += 1) {
      const selected = ctx.pageValue(selectors[i]);
      if (!selected) continue;
      for (let j = 0; j < semesters.length; j += 1) {
        if (semesters[j].code === selected) return semesters[j];
      }
    }
    return null;
  },

  semesterCode(semester) {
    return semester.code;
  },

  semesterLabel(semester) {
    return semester.label;
  },

  async semesterMeta(semester, ctx) {
    const totalWeeks = Number(ctx.config.assumedTotalWeeks);
    return {
      name: semester.label,
      totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : null
    };
  },

  /** 课表：带上学期、学号与校区。校区拿不到就让用户选，不猜。 */
  async fetchSchedule(semester, ctx) {
    const campus = await this.resolveCampus(ctx);

    const params = [];
    params.push(String(ctx.config.semesterParam || 'xqdm') + '=' + encodeURIComponent(semester.code));
    const studentId = this.firstPageValue(ctx.config.studentIdSelectors, ctx);
    if (studentId) params.push(String(ctx.config.studentParam || 'xh') + '=' + encodeURIComponent(studentId));
    if (campus) params.push(String(ctx.config.campusParam || 'xqid') + '=' + encodeURIComponent(campus));

    const query = String(ctx.config.scheduleQuery || '').trim();
    const action = String(ctx.config.scheduleAction || '') + (query ? '?' + query : '');
    const response = await ctx.http.postForm(action, params.join('&'));

    const rows = rowsFor(response.json(), ctx);
    if (!rows.length) throw new Error('课表接口没有返回行');
    return rows;
  },

  /** 一行 → 一条课时。 */
  normalizeRow(row, ctx) {
    const from = Number(ctx.pick(row, 'from'));
    const to = Number(ctx.pick(row, 'to'));
    const sections = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from
      ? { from: from, to: to }
      : ctx.parseSections(ctx.pick(row, 'section'));
    if (!sections) return { skip: '节次字段缺失或不是连续节次' };

    const weeks = ctx.parseWeeks(ctx.pick(row, 'weeks'));
    if (!weeks.length) return { skip: '周次为空' };

    return {
      name: cleanFieldText(ctx.pick(row, 'name')),
      teacher: cleanTeacherName(ctx.pick(row, 'teacher')),
      day: Number(ctx.pick(row, 'day')),
      from: sections.from,
      to: sections.to,
      location: cleanFieldText(ctx.pick(row, 'location')),
      weeks: weeks,
      groupKey: groupKeyOf(row, ctx)
    };
  },

  /**
   * 作息时间：该族目前**不提供**。
   *
   * 超星的课表响应里到底有没有节次时间，只有实测才知道；在弄清楚之前返回空数组，应用会退化成
   * 「用我现有的作息表」。不猜一组时间，是因为错的作息表比没有作息表更糟（所有课都画错格子）。
   */
  async timeSlots(semester, ctx) {
    return [];
  },

  // ---------------------------------------------------------------- 内部工具

  /** 校区：页面上的值 → 让用户选 → 空。 */
  async resolveCampus(ctx) {
    const fromPage = this.firstPageValue(ctx.config.campusSelectSelectors, ctx);
    if (fromPage) return fromPage;

    const options = ctx.config.campusSelectSelectors || [];
    for (let i = 0; i < options.length; i += 1) {
      const list = ctx.pageOptions(options[i]);
      if (!list.length) continue;
      const index = await ctx.ask('选择校区', list.map((item) => item.label), 0);
      if (index === null || index === undefined) return null;
      return list[index] ? list[index].value : null;
    }
    return null;
  },

  firstPageValue(selectors, ctx) {
    const list = selectors || [];
    for (let i = 0; i < list.length; i += 1) {
      const value = ctx.pageValue(list[i]);
      if (value) return value;
    }
    return null;
  }
};

/** 学期候选：本地合成「学年 × 两学期」，学年以 9 月为界。 */
function synthesizeSemesters(ctx) {
  const years = Math.max(1, Math.min(6, Number(ctx.config.semesterYears) || 3));
  const now = new Date();
  const firstYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

  const semesters = [];
  for (let offset = 0; offset < years; offset += 1) {
    const start = firstYear - offset;
    semesters.push({ code: start + '-1', label: start + '-' + (start + 1) + ' 学年 第一学期' });
    semesters.push({ code: start + '-2', label: start + '-' + (start + 1) + ' 学年 第二学期' });
  }
  return semesters;
}

/** 字段里可能内嵌 HTML（该族常见），去掉标签。 */
function cleanFieldText(value) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** 教师可能带工号或用顿号分隔多人。 */
function cleanTeacherName(value) {
  const text = cleanFieldText(value);
  if (!text) return null;
  return text.split(/[\/、,，]/)[0].trim() || null;
}

function groupKeyOf(row, ctx) {
  const order = ctx.config.groupKeyOrder || [];
  const parts = [];
  order.forEach((field) => {
    const value = ctx.pick(row, field);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      parts.push(field + ':' + String(value).trim());
    }
  });
  if (parts.length) return parts.join('|');
  return 'name:' + String(ctx.pick(row, 'name') || '').trim();
}

/** 取行数组：声明的容器 → 首键的嵌套（该族信封常是 `data`）→ 响应里唯一的数组字段。 */
function rowsFor(json, ctx) {
  const rows = ctx.rowsFrom(json);
  if (rows.length) return rows;

  const declared = (ctx.config.rowContainer || {}).path;
  if (declared) {
    const direct = ctx.pickFrom(json, declared);
    if (Array.isArray(direct)) return direct;
    const nested = ctx.pickFrom(json, 'data.' + declared);
    if (Array.isArray(nested)) return nested;
  }
  const keys = Object.keys(json || {});
  const arrays = [];
  for (let i = 0; i < keys.length; i += 1) {
    if (Array.isArray(json[keys[i]])) arrays[arrays.length] = json[keys[i]];
  }
  return arrays.length === 1 ? arrays[0] : [];
}
