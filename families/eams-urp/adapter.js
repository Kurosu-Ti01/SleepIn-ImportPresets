// SleepIn 导入脚本 · 族适配器：东软 EAMS / URP（课表接口）
//
// 该族的课表按「每节一行」返回，所以运行流程的连排合并（mergeAdjacentSections）默认打开：
// 同一门课同一天、周次与教室都相同的相邻两节会被折成一个时段，不然课表里会出现两行相邻的格子。
//
// 响应的形状在不同部署之间差别较大：有的直接返回 JSON，有的返回一段
// `var activities = {...};` 的脚本（页面自己解析的那种）。所以响应按取值 `responseShape` 走
// 两条路，字段映射与节次解析仍然共用一套。
//
// 参考来源说明：只依据该族公开的接口形状（路径、参数、响应里的变量名与字段名）重写，
// 宽松解析、字段退让与降级处理都是本项目的写法。

const familyAdapter = {
  /** 探测：页面路径里的模块名。 */
  async detect(ctx) {
    const path = String(ctx.pagePath() || '').toLowerCase();
    if (path.indexOf('/eams/') >= 0 || path.indexOf('courseTableForStd') >= 0) return true;
    if (path.indexOf('login') >= 0) return '当前在登录页，请先登录并进入课表页面。';
    return '当前页面不在课表模块（路径里没有 /eams/）。请先打开自己的课表页面。';
  },

  /** 学期：优先读页面下拉框，读不到就本地合成候选。 */
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

  /** 课表：POST 之后按取值解析响应，再交出「每节一行」的行数组。 */
  async fetchSchedule(semester, ctx) {
    const param = String(ctx.config.semesterParam || 'semester');
    const query = String(ctx.config.scheduleQuery || '').trim();
    const action = String(ctx.config.scheduleAction || '') + (query ? '?' + query : '');
    const response = await ctx.http.postForm(action, param + '=' + encodeURIComponent(semester.code));

    const json = parseResponseText(response.text, ctx);
    const rows = rowsFor(json, ctx);
    if (!rows.length) {
      throw new Error('课表响应里没有找到行数组（responseShape=' + String(ctx.config.responseShape || 'json') + '）');
    }
    return rows;
  },

  /** 一行 → 一条课时：优先用现成的起止节次，其次从节次文本解析。 */
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
      name: this.firstText(ctx.pick(row, 'name'), ctx.pickFrom(row, 'course.name')),
      teacher: this.cleanTeacher(ctx.pick(row, 'teacher')),
      day: Number(ctx.pick(row, 'day')),
      from: sections.from,
      to: sections.to,
      location: this.firstText(ctx.pick(row, 'location'), ctx.pickFrom(row, 'room.name')),
      weeks: weeks,
      groupKey: this.groupKeyOf(row, ctx)
    };
  },

  /** 作息时间：该族的课表页行头通常带起止时刻，从页面上读；读不到就不提供。 */
  async timeSlots(semester, ctx) {
    const selectors = ctx.config.sectionTimesSelectors || [];
    const slots = [];
    selectors.forEach((selector) => {
      if (slots.length) return;
      const text = ctx.pageText(selector);
      if (!text) return;
      const parts = String(text).split(/\s{2,}|\n/);
      const lines = [];
      for (let k = 0; k < parts.length; k += 1) {
        const line = parts[k].trim();
        if (line) lines[lines.length] = line;
      }
      lines.forEach((line, index) => {
        const times = line.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
        const sections = ctx.parseSections(line);
        if (!times) return;
        slots.push({
          period: sections ? sections.from : index + 1,
          start: times[1],
          end: times[2]
        });
      });
    });
    return slots;
  },

  // ---------------------------------------------------------------- 内部工具

  groupKeyOf(row, ctx) {
    const order = ctx.config.groupKeyOrder || [];
    const parts = [];
    order.forEach((field) => {
      const value = ctx.pick(row, field);
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        parts.push(field + ':' + String(value).trim());
      }
    });
    if (parts.length) return parts.join('|');

    // 兜底是「课程名 + 教师」而不是「课程名 + 时段」：按时段分会把同一门课一周的两次
    // 拆成两门课。
    const name = String(ctx.pick(row, 'name') || '').trim();
    const teacher = String(ctx.pick(row, 'teacher') || '').trim();
    return 'name:' + name + '|teacher:' + teacher;
  },

  /** 教师字段可能是数组（该族常见），也可能是带工号的字符串。 */
  cleanTeacher(value) {
    if (Array.isArray(value)) {
      const mapped = value.map((item) => this.cleanTeacher(item));
      const names = [];
      for (let i = 0; i < mapped.length; i += 1) {
        if (mapped[i]) names[names.length] = mapped[i];
      }
      return names.length ? names.join('、') : null;
    }
    const text = String(value === null || value === undefined ? '' : value).trim();
    if (!text) return null;
    return text.split(/[\/、,，]/)[0].trim() || null;
  },

  firstText() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return null;
  }
};

/** 学期候选：本地合成「学年 × 两学期」，学年以 9 月为界。 */
function synthesizeSemesters(ctx) {
  const years = Math.max(1, Math.min(6, Number(ctx.config.semesterYears) || 4));
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

/** 按取值解析响应：JSON，或页面里那种 `var xxx = {...};` 的脚本。 */
function parseResponseText(text, ctx) {
  const raw = String(text === null || text === undefined ? '' : text).trim();
  if (String(ctx.config.responseShape || 'json') === 'jsVariable') {
    const names = ctx.config.jsVariableNames || [];
    for (let i = 0; i < names.length; i += 1) {
      const name = String(names[i] || '').trim();
      if (!name) continue;
      const matched = new RegExp('(?:var|let|const)\\s+' + name + '\\s*=\\s*([\\s\\S]*?);\\s*(?:\\n|$)').exec(raw);
      if (matched) {
        const parsed = parseLooseJson(matched[1]);
        if (parsed) return parsed;
      }
    }
  }
  return parseLooseJson(raw);
}

/** 尽量把一段文本当 JSON 读：去掉尾部分号，失败再退让到「单引号当双引号」。 */
function parseLooseJson(text) {
  const trimmed = String(text === null || text === undefined ? '' : text).trim().replace(/;$/, '');
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // 继续尝试宽松解析
  }
  try {
    return JSON.parse(trimmed.replace(/'/g, '"'));
  } catch (error) {
    return null;
  }
}

/** 取行数组：声明的容器 → 同名嵌套 → 响应里唯一的数组字段。 */
function rowsFor(json, ctx) {
  const rows = ctx.rowsFrom(json);
  if (rows.length) return rows;

  const declared = (ctx.config.rowContainer || {}).path;
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
}
