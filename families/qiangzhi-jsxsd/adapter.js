// SleepIn 导入脚本 · 族适配器：强智 jsxsd（课表页的 HTML 表格）
//
// 这一族没有 JSON 接口可用：课表就是一张 HTML 表格，所以解析分两步走
//   1. 表格 → 「格子」矩阵（用运行流程的 ctx.parseHtml / ctx.findTable / ctx.tableMatrix）；
//   2. 一个格子里可能塞着多门课（用分隔线分开），每门课的教师 / 教室 / 周次节次写在带 title 的
//      内联标签里 —— 这一步是纯字符串处理（parseCell），不依赖 DOM，因此可以单独测。
//
// 与常见写法的差别：
//   · 选择器一律走取值（`tableSelectors` 是候选列表，依次尝试），因为该族的部署换了模板但没换接口；
//   · 「节次」从格子里的 `[1-2节]` 抠，同样交给运行流程的 ctx.parseSections 校验范围与连续性；
//   · 作息时间优先从课表自己的表头里读（表头通常写着「第 1-2 节 08:00-09:40」），
//     读不到就不提供 —— 应用会退化成「用我现有的作息表」，不会编时间。
//
// 参考来源说明：只依据该族公开的页面结构（表格 id、内联标签的 title 文案、单元格分隔线）重写，
// 具体解析、退让与错误处理都是本项目的写法。

const familyAdapter = {
  /** 探测：jsxsd 的课表页路径。 */
  async detect(ctx) {
    const path = String(ctx.pagePath() || '').toLowerCase();
    if (path.indexOf('/jsxsd/') >= 0 || path.indexOf('/xskb/') >= 0) return true;
    return '当前页面不在课表页（/jsxsd/ 或 /xskb/）下。请在浏览器里打开「学生课表查询」页面。';
  },

  /**
   * 学期：优先读页面上的学期下拉框（该族几乎每个部署都有），读不到就本地合成候选。
   */
  listSemesters(ctx) {
    const selectors = ctx.config.semesterSelectSelectors || [];
    for (let i = 0; i < selectors.length; i += 1) {
      const options = ctx.pageOptions(selectors[i]);
      if (options.length) {
        return options.map((option) => ({ code: option.value, label: option.label }));
      }
    }
    return synthesizeSemesters(ctx);
  },

  semesterCode(semester) {
    return semester.code;
  },

  semesterLabel(semester) {
    return semester.label;
  },

  /** 当前学期：页面上选中的那个优先。 */
  currentSemester(semesters, ctx) {
    const selectors = ctx.config.semesterSelectSelectors || [];
    for (let i = 0; i < selectors.length; i += 1) {
      const selected = ctx.pageValue(selectors[i]);
      if (selected) {
        for (let j = 0; j < semesters.length; j += 1) {
          if (semesters[j].code === selected) return semesters[j];
        }
      }
    }
    return null;
  },

  async semesterMeta(semester, ctx) {
    const totalWeeks = Number(ctx.config.assumedTotalWeeks);
    return {
      name: this.semesterLabel(semester, ctx),
      totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : null
    };
  },

  /**
   * 课表：POST 之后拿回整页 HTML，再从表格里把「格子」变成一行一行。
   *
   * 这一步只做「格子 → 行对象」，字段解析留在 normalizeRow；两者分开是为了让变化点表能解释清楚
   * 哪一项属于模板、哪一项属于字段。
   */
  async fetchSchedule(semester, ctx) {
    const param = String(ctx.config.semesterParam || 'xnxq01id');
    const body = param + '=' + encodeURIComponent(semester.code) + '&zc=&demo=&cj0701id=';
    const response = await ctx.http.postForm(String(ctx.config.scheduleAction || ''), body);

    const html = response.text;
    const document_ = ctx.parseHtml(html);
    const table = ctx.findTable(document_, ctx.config.tableSelectors || []);
    if (!table) {
      throw new Error('课表页里没有找到课表表格（尝试的选择器：' + (ctx.config.tableSelectors || []).join(' / ') + '）');
    }

    // 表头里的节次时间顺手记下来，timeSlots 会用它。
    this.sectionTimes = this.readSectionTimes(ctx.tableMatrix(table), ctx);

    const rows = [];
    const matrix = ctx.tableMatrix(table);
    const offset = Number(ctx.config.dayColumnOffset);
    matrix.forEach((cells, rowIndex) => {
      if (!cells || cells.length <= offset) return;
      const rowSections = ctx.parseSections(this.rowHeaderText(cells[0], ctx));
      for (let column = offset; column < cells.length; column += 1) {
        const day = column - offset + 1;
        if (day > 7) continue;
        const cell = cells[column];
        if (!cell || !ctx.cellText(cell)) continue;
        this.parseCell(cell, day, rowSections, rowIndex, ctx).forEach((entry) => rows.push(entry));
      }
    });
    return rows;
  },

  /**
   * 诊断用的字段清单：HTML 族没有「字段」可言，换成「这次读了哪些带 title 的标签」，
   * 模板对不上时贡献者一眼就能看出该改哪一项。
   */
  describeFields(rows, ctx) {
    const titles = (ctx.config && ctx.config.fieldTitles) || {};
    const asList = (value) => (Array.isArray(value) ? value : (value ? [value] : []));
    return [
      'title:' + (asList(titles.teacher).join('/') || '老师'),
      'title:' + (asList(titles.weekSection).join('/') || '周次(节次)'),
      'title:' + (asList(titles.location).join('/') || '教室')
    ];
  },

  /**
   * 一个格子 → 若干行。
   *
   * 拆分细节（分隔线与带 title 的标签）交给共享库的 ctx.cellBlocks，这里只把「课程块」映射成行对象。
   */
  parseCell(cell, day, rowSections, rowIndex, ctx) {
    const blocks = ctx.cellBlocks(ctx.cellHtml(cell), {
      blockSplitter: ctx.config.blockSplitter,
      titles: ctx.config.fieldTitles
    });

    return blocks.map((block) => ({
      name: block.name,
      teacher: block.teacher,
      location: block.location,
      // 节次：格子里的 `[n-m节]` 优先，没有就用行头（表头那一列）的节次。
      section: this.sectionFromText(block.weekSection, ctx),
      fallbackSection: rowSections,
      weeks: this.weeksOnly(block.weekSection || block.text, ctx),
      day: day,
      __row: rowIndex,
      __block: block.index
    }));
  },

  /**
   * 单元格文本 → 一条课时。
   *
   * 节次先取格子里的，再退回行头；两者都没有就跳过（记进「跳过的行」，可见而不是静默）。
   */
  normalizeRow(row, ctx) {
    const sections = ctx.parseSections(row.section) || row.fallbackSection;
    if (!sections) return { skip: '没找到节次（格子与行头都没有）' };

    const weeks = ctx.parseWeeks(row.weeks);
    if (!weeks.length) return { skip: '周次为空' };

    return {
      name: row.name,
      teacher: row.teacher || null,
      day: Number(row.day),
      from: sections.from,
      to: sections.to,
      location: row.location || null,
      weeks: weeks,
      // 分组键是**课程身份**而不是格子位置：同一门课一周上两次（可能在不同格子、不同天）
      // 必须折成一门课的两个时段，按格子分会让它变成两门课。
      groupKey: 'name:' + String(row.name).trim() + '|teacher:' + String(row.teacher || '').trim()
    };
  },

  /**
   * 作息时间：从课表自己的表头里读。
   *
   * 该族的课表行头通常写着「第 1-2 节 08:00-09:40」，所以不需要额外请求；读不到就返回空数组，
   * 由应用退化成「用我现有的作息表」。
   */
  async timeSlots(semester, ctx) {
    return Array.isArray(this.sectionTimes) ? this.sectionTimes : [];
  },

  // ---------------------------------------------------------------- 内部工具

  /** 从表头的行头单元格里抽「节次 → 起止时刻」。 */
  readSectionTimes(matrix, ctx) {
    if (ctx.config.sectionTimesFromTableHeader === false) return [];
    const slots = [];
    matrix.forEach((cells) => {
      if (!cells || !cells.length) return;
      const header = ctx.cellText(cells[0]);
      if (!header) return;
      const sections = ctx.parseSections(header);
      const times = header.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
      if (!sections || !times) return;
      // 行头写的是「第 1-2 节」这样的大节时，只记第一节的开始与最后一节的结束。
      slots.push({ period: sections.from, start: times[1], end: times[2] });
    });
    return slots;
  },

  /** 行头文本：优先按取值里的选择器找，找不到就用整格文本。 */
  rowHeaderText(cell, ctx) {
    if (!cell) return '';
    const selectors = ctx.config.headerRowSectionSelectors || [];
    for (let i = 0; i < selectors.length; i += 1) {
      const found = cell.querySelector ? cell.querySelector(selectors[i]) : null;
      if (found) return String(found.textContent || '').trim();
    }
    return String(cell.textContent || '').trim();
  },

  /** 从文本里抽 `[n-m节]` 那一段。 */
  sectionFromText(text, ctx) {
    const matched = new RegExp(String(ctx.config.sectionPattern || '\\[(\\d+)\\s*(?:-\\s*(\\d+))?\\s*节\\]'))
      .exec(String(text || ''));
    if (!matched) return null;
    return matched[2] ? matched[1] + '-' + matched[2] : matched[1];
  },

  /**
   * 周次文本：该族常把节次写在同一个字段里（`1-16周[1-2节]`），所以先摘掉节次那一段再交给周次解析。
   * 不摘的话周次解析会看到「节」而直接报错——那是它刻意设计的「宁可失败也不猜」。
   */
  weeksOnly(text, ctx) {
    const pattern = new RegExp(String(ctx.config.sectionPattern || '\\[(\\d+)\\s*(?:-\\s*(\\d+))?\\s*节\\]'), 'g');
    return String(text === null || text === undefined ? '' : text).replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  }
};

/** 学期候选：本地合成「学年 × 两学期」，学年以 9 月为界。 */function synthesizeSemesters(ctx) {
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
