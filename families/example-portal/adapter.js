// SleepIn 导入脚本 · 族适配器（示例，虚构）
//
// 这一份代码被同族的**所有**学校共用，所以它必须只读 config，不写死任何学校特有的取值。
// 想让某个部署跑通，先看这些取值能不能表达；表达不了再考虑具名覆盖（presets/<id>/override.js）。
//
// 运行流程由 lib/runner.js 提供，本文件只回答两件事：
//   · 怎么取数（探测、学期列表、课表、学期元信息）
//   · 一行里的值在哪（normalizeRow）
//
// 生成器会把本文件与 lib/runner.js、该校的 config 拼成一个 script.js。

const familyAdapter = {
  /**
   * 探测：从这里到底是哪一族。
   *
   * 优先用不需要请求的特征（页面路径、页面上的元素、全局变量）。一个都不命中时返回说明文字，
   * 让用户看到「为什么认不出来」，而不是一个没有反应的按钮。
   */
  async detect(ctx) {
    const path = ctx.pagePath();
    // 该族所有部署的地址里都带这一段；换了应用名也仍然在。
    if (path.indexOf('/portal/') < 0) {
      return '当前页面不在该教务系统的 /portal/ 路径下。';
    }
    return true;
  },

  /** 学年学期列表。 */
  async listSemesters(ctx) {
    const response = await ctx.http.postForm(
      ctx.config.basePath + '/' + ctx.config.semesterListAction,
      ''
    );
    const rows = ctx.rowsFrom(response.json());
    if (!rows.length) throw new Error('学期列表是空的');
    // 自己按代码倒序排，不依赖服务端排序是否如预期。
    return rows.slice().sort((a, b) => {
      const left = String(ctx.pickFrom(a, ctx.config.semesterFields.code) || '');
      const right = String(ctx.pickFrom(b, ctx.config.semesterFields.code) || '');
      return right.localeCompare(left);
    });
  },

  /** 学期标识，用于后续请求。 */
  semesterCode(semester, ctx) {
    return String(ctx.pickFrom(semester, ctx.config.semesterFields.code) || '');
  },

  /** 学期显示名。 */
  semesterLabel(semester, ctx) {
    const label = ctx.pickFrom(semester, ctx.config.semesterFields.label);
    return String(label || this.semesterCode(semester, ctx)).trim();
  },

  /**
   * 页面上当前选中的学期。
   *
   * 拿到了就不必再问用户；拿不到返回 null，由运行流程弹出选择框。
   * 这里示范的是「读页面上的下拉框与 data 属性」，不需要额外请求。
   */
  currentSemester(semesters, ctx) {
    if (typeof document === 'undefined') return null;

    const codes = semesters.map((semester) => this.semesterCode(semester, ctx));
    const seen = [];
    document.querySelectorAll('select').forEach((select) => seen.push(select.value));
    document.querySelectorAll('[data-value],[data-code]').forEach((element) => {
      seen.push(element.getAttribute('data-value'));
      seen.push(element.getAttribute('data-code'));
    });

    let hit = null;
    for (let i = 0; i < seen.length; i += 1) {
      if (seen[i] && codes.indexOf(String(seen[i])) >= 0) { hit = seen[i]; break; }
    }
    if (!hit) return null;
    for (let i = 0; i < semesters.length; i += 1) {
      if (this.semesterCode(semesters[i], ctx) === String(hit)) return semesters[i];
    }
    return null;
  },

  /** 主课表的原始行。 */
  async fetchSchedule(semester, ctx) {
    const body = ctx.config.semesterParam + '=' + encodeURIComponent(this.semesterCode(semester, ctx));
    const response = await ctx.http.postForm(
      ctx.config.basePath + '/' + ctx.config.scheduleAction,
      body
    );
    const rows = ctx.rowsFrom(response.json());
    if (!rows.length) throw new Error('课表接口没有返回 rows');
    return rows;
  },

  /**
   * 学期元信息：课表名称、总周数、开学日期。
   *
   * 拿不到就返回 null；运行流程会用学期显示名和应用的默认值兜底，不会因为这一项失败而中断导入。
   */
  async semesterMeta(semester, ctx) {
    const body = ctx.config.semesterParam + '=' + encodeURIComponent(this.semesterCode(semester, ctx));
    const response = await ctx.http.postForm(
      ctx.config.basePath + '/' + ctx.config.semesterMetaAction,
      body
    );
    const row = ctx.rowsFrom(response.json())[0];
    if (!row) return null;

    const meta = {};
    const name = this.semesterLabel(semester, ctx);
    if (name) meta.name = name;

    const totalWeeks = Number(ctx.pickFrom(row, 'totalWeeks'));
    if (Number.isFinite(totalWeeks) && totalWeeks > 0) meta.totalWeeks = totalWeeks;

    // 只取日期部分：后面可能跟着时间。
    const startDate = String(ctx.pickFrom(row, 'startDate') || '').match(/^\d{4}-\d{2}-\d{2}/);
    if (startDate) meta.startDate = startDate[0];

    return meta;
  },

  /**
   * 作息时间（节次 → 起止时刻）。
   *
   * 可选环节：该族的部署不一定都提供这个接口，拿不到时返回 null 或空数组都行，运行流程会当作
   * “该方案不提供作息时间”，用户就只能在应用里选一个已有作息表。
   *
   * 返回形状固定为 { period, start, end }，时刻用 'HH:mm'；不合法的条目由运行流程丢掉并记日志，
   * 不需要适配器自己过滤。
   */
  async timeSlots(semester, ctx) {
    const fields = ctx.config.sectionTimeFields || {};
    const response = await ctx.http.postForm(
      ctx.config.basePath + '/' + ctx.config.sectionTimesAction,
      ''
    );

    return ctx.rowsFrom(response.json()).map((row) => ({
      period: Number(ctx.pickFrom(row, fields.period)),
      start: ctx.pickFrom(row, fields.start),
      end: ctx.pickFrom(row, fields.end)
    }));
  },

  /**
   * 一行 → 一条课时（或 null / { skip: '原因' }）。
   *
   * 越界与缺字段交给运行流程统一判定，这里只负责把字段取出来、把周次按编码解成数组。
   */
  normalizeRow(row, ctx) {
    const weeks = ctx.parseWeeks(ctx.pick(row, 'weeks'));
    if (!weeks.length) return { skip: '周次为空或无法解析' };

    return {
      name: ctx.pick(row, 'name'),
      teacher: ctx.pick(row, 'teacher'),
      day: Number(ctx.pick(row, 'day')),
      from: Number(ctx.pick(row, 'from')),
      to: Number(ctx.pick(row, 'to')),
      location: ctx.pick(row, 'location') || null,
      weeks: weeks,
      groupKey: this.groupKeyOf(row, ctx)
    };
  },

  /**
   * 分组键：按 groupKeyOrder 依次退化。
   *
   * 教学班 ID 最准；没有它就用课程号 + 课序号；都没有才用课程名——
   * 用课程名会把两个教学班合成一门课，是丢课的主要来源，所以放在最后。
   */
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
    return 'name:' + String(ctx.pick(row, 'name') || '');
  }
};
