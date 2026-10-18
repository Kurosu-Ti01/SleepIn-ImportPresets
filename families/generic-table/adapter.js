// SleepIn 导入脚本 · 族适配器：通用抓取（当前页面上的课表表格）
//
// 这是长尾的兜底：认不出是哪个教务系统时，让用户自己把课表页打开，脚本只负责把**当前页面上**
// 那张课表表格读出来。所以它不发任何请求，也没有学校身份 —— 对应应用里的「通用工具」分类。
//
// 它假设的是最常见的那种课表布局：一张表，行是节次（行头写着「第 1-2 节」），列是星期。
// 布局不同的学校用不了它 —— 那是正常的，这类学校需要自己的族或自己写脚本，而不是让这一份去猜。
//
// 参考来源说明：布局假设来自公开可见的课表页面形态，解析、退让与错误处理都是本项目的写法。

const familyAdapter = {
  /**
   * 探测：页面上有没有候选的课表表格。
   *
   * 只看页面本身，不需要请求 —— 用户此刻停在哪一页，就意味着他想导入哪一页。
   */
  async detect(ctx) {
    const document_ = ctx.parseHtml(ctx.pageHtml());
    const table = ctx.findTable(document_, ctx.config.tableSelectors || []);
    if (table) return true;
    return '当前页面上没有找到课表表格。请先在浏览器里打开自己的课表页面，再执行导入。';
  },

  /** 学期：通用抓取没有学校身份，也没有学期接口，所以候选本地合成。 */
  listSemesters(ctx) {
    return synthesizeSemesters(ctx);
  },

  semesterCode(semester) {
    return semester.code;
  },

  semesterLabel(semester) {
    return semester.label;
  },

  /** 当前学期按月份推：9 月—次年 1 月算第一学期，2—7 月算第二学期。 */
  currentSemester(semesters) {
    const now = new Date();
    const month = now.getMonth();
    const startYear = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const term = month >= 1 && month <= 6 ? '-2' : '-1';
    for (let i = 0; i < semesters.length; i += 1) {
      if (semesters[i].code === String(startYear) + term) return semesters[i];
    }
    return null;
  },

  async semesterMeta(semester, ctx) {
    const totalWeeks = Number(ctx.config.assumedTotalWeeks);
    return {
      name: semester.label,
      totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : null
    };
  },

  /** 课表：读当前页面上的表格，不发请求。 */
  async fetchSchedule(semester, ctx) {
    const document_ = ctx.parseHtml(ctx.pageHtml());
    const table = ctx.findTable(document_, ctx.config.tableSelectors || []);
    if (!table) {
      throw new Error('当前页面上没有找到课表表格（尝试的选择器：' + (ctx.config.tableSelectors || []).join(' / ') + '）');
    }

    const matrix = ctx.tableMatrix(table);
    this.sectionTimes = readSectionTimes(matrix, ctx);

    const rows = [];
    const offset = Number(ctx.config.dayColumnOffset);
    const dayCount = Number(ctx.config.dayCount) || 7;
    matrix.forEach((cells, rowIndex) => {
      if (!cells || cells.length <= offset) return;
      const rowSections = ctx.parseSections(headerText(cells[0], ctx));
      for (let column = offset; column < cells.length && column - offset < dayCount; column += 1) {
        const cell = cells[column];
        if (!cell || !ctx.cellText(cell)) continue;
        const day = column - offset + 1;
        const blocks = ctx.cellBlocks(ctx.cellHtml(cell), {
          blockSplitter: ctx.config.blockSplitter,
          titles: ctx.config.fieldTitles
        });
        blocks.forEach((block) => {
          rows.push({
            name: block.name,
            teacher: block.teacher,
            location: block.location,
            section: sectionFromText(block.weekSection, ctx) || sectionFromText(block.text, ctx),
            fallbackSection: rowSections,
            weeks: weeksOnly(block.weekSection || block.text, ctx),
            day: day,
            __row: rowIndex,
            __block: block.index
          });
        });
      }
    });
    return rows;
  },

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
      // 分组键是**课程身份**而不是格子位置：同一门课一周上两次必须折成一门课的两个时段。
      groupKey: 'name:' + String(row.name).trim() + '|teacher:' + String(row.teacher || '').trim()
    };
  },

  /** 作息时间：从表格的行头读（行头常写着「第 1-2 节 08:00-09:40」）。 */
  async timeSlots(semester, ctx) {
    return Array.isArray(this.sectionTimes) ? this.sectionTimes : [];
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

/** 行头文本：按取值的选择器找，找不到就用整格文本。 */
function headerText(cell, ctx) {
  if (!cell) return '';
  const selectors = ctx.config.headerRowSectionSelectors || [];
  for (let i = 0; i < selectors.length; i += 1) {
    const found = cell.querySelector ? cell.querySelector(selectors[i]) : null;
    if (found) return String(found.textContent || '').trim();
  }
  return String(cell.textContent || '').trim();
}

/** 从文本里抽 `[n-m节]`。 */
function sectionFromText(text, ctx) {
  const matched = new RegExp(String(ctx.config.sectionPattern || '\\[(\\d+)\\s*(?:-\\s*(\\d+))?\\s*节\\]'))
    .exec(String(text || ''));
  if (!matched) return null;
  return matched[2] ? matched[1] + '-' + matched[2] : matched[1];
}

/**
 * 周次文本：节次常与周次写在同一个字段里（`1-16周[1-2节]`），所以先摘掉节次那一段再交给周次解析。
 */
function weeksOnly(text, ctx) {
  const pattern = new RegExp(String(ctx.config.sectionPattern || '\\[(\\d+)\\s*(?:-\\s*(\\d+))?\\s*节\\]'), 'g');
  return String(text === null || text === undefined ? '' : text).replace(pattern, ' ').replace(/\s+/g, ' ').trim();
}

/** 行头里的「节次 → 起止时刻」。 */
function readSectionTimes(matrix, ctx) {
  if (ctx.config.sectionTimesFromTableHeader === false) return [];
  const slots = [];
  matrix.forEach((cells) => {
    if (!cells || !cells.length) return;
    const header = String(cells[0] && cells[0].textContent ? cells[0].textContent : '').trim();
    if (!header) return;
    const sections = ctx.parseSections(header);
    const times = header.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
    if (!sections || !times) return;
    slots.push({ period: sections.from, start: times[1], end: times[2] });
  });
  return slots;
}
