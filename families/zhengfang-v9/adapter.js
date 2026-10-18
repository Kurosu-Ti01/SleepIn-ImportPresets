// SleepIn 导入脚本 · 族适配器：正方教务 v9（课表查询模块的 JSON 接口）
//
// 这一族的结构相对简单：课表查询接口一次就返回整学期的行数组，学期码由「学年 + 学期序号」拼成。
// 教务不报告总周数，所以由 family.json 里的 assumedTotalWeeks 声明一个假设值——它会在应用的确认
// 弹窗里显示出来，用户看得见、事后也能改，比悄悄猜一个数字诚实。
//
// 三个刻意的做法（与常见写法不同，理由都写在各自的注释里）：
//   1. 学期候选在本地合成，不让用户手输学年（listSemesters / currentSemester）；
//   2. 节次与周次的解析调用运行流程的 ctx.parseSections / ctx.parseWeeks，适配器不自己实现；
//   3. 作息时间拿不到就当没有：返回空数组或让请求失败，应用会退化成「用我现有的作息表」。
//
// 参考来源说明：本文件只依据「该族公开的接口形状」重写——请求路径、参数名、响应里的键名与字段名
// 是可观察的数据契约；具体实现、退让策略与错误处理都是本项目的写法。

const familyAdapter = {
  /**
   * 探测：判断当前页面是不是该族的课表查询页。
   *
   * 只用不需要发请求的特征（页面路径）。命中登录页时给一句能照做的提示，而不是笼统地说认不出来。
   */
  async detect(ctx) {
    const path = String(ctx.pagePath() || '').toLowerCase();
    if (path.indexOf('/kbcx/') >= 0) return true;
    if (path.indexOf('login') >= 0) {
      return '当前在登录页。请先完成登录，并进入「信息查询 → 学生课表查询」页面后再执行导入。';
    }
    return '当前页面不在课表查询路径（/kbcx/）下。请先进入学生课表查询页面。';
  },

  /**
   * 学期候选：本地合成「学年 × 两个学期」。
   *
   * 该族没有学期列表接口，所以候选只能自己算：学年以 9 月为界，从当前学年往回数
   * `semesterYears` 个。默认 4 学年 = 8 个候选，落在运行流程的选择上限之内。
   */
  listSemesters(ctx) {
    const years = Math.max(1, Math.min(6, Number(ctx.config.semesterYears) || 4));
    const now = new Date();
    const firstYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    const semesters = [];
    for (let offset = 0; offset < years; offset += 1) {
      const start = firstYear - offset;
      const label = start + '-' + (start + 1) + ' 学年';
      semesters.push({ xnm: String(start), xqm: '3', label: label + ' 第一学期' });
      semesters.push({ xnm: String(start), xqm: '12', label: label + ' 第二学期' });
    }
    return semesters;
  },

  /** 学期标识：该族的请求要 `xnm` 与 `xqm` 两个参数，所以合成一个可读的字符串。 */
  semesterCode(semester) {
    return semester.xnm + '-' + semester.xqm;
  },

  /** 学期显示名。 */
  semesterLabel(semester) {
    return semester.label;
  },

  /**
   * 当前学期：按月份推断，省掉一次选择。
   *
   * 9 月—次年 1 月算第一学期，2 月—7 月算第二学期；推不出来就交给运行流程弹选择框。
   */
  currentSemester(semesters, ctx) {
    const now = new Date();
    const month = now.getMonth();
    const startYear = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const xqm = month >= 1 && month <= 6 ? '12' : '3';

    for (let i = 0; i < semesters.length; i += 1) {
      if (semesters[i].xnm === String(startYear) && semesters[i].xqm === xqm) return semesters[i];
    }
    return null;
  },

  /** 主课表：一次 POST 拿回整学期的行。 */
  async fetchSchedule(semester, ctx) {
    const body = [
      'xnm=' + encodeURIComponent(semester.xnm),
      'xqm=' + encodeURIComponent(semester.xqm),
      'kzlx=ck',
      'xsdm=',
      'kclbdm='
    ].join('&');

    const response = await ctx.http.postForm(
      this.actionPath(ctx, 'scheduleAction', 'scheduleQuery'),
      body
    );
    return this.rowsFor(response.json(), ctx, ctx.config.rowContainer);
  },

  /**
   * 学期元信息。
   *
   * 该族只报告节次与周次，不报告总周数与开学日期，所以这里只声明族的假设值（取值可覆盖），
   * 不做推测：开学日期留空，应用会从今天开始算第一周，用户可在课程表里改。
   */
  async semesterMeta(semester, ctx) {
    const totalWeeks = Number(ctx.config.assumedTotalWeeks);
    return {
      name: this.semesterLabel(semester, ctx),
      totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : null
    };
  },

  /**
   * 作息时间（节次 → 起止时刻）。
   *
   * 这个接口在各部署之间的信封与字段名不一致，所以节次号优先取字段值，取不到就用行序（节次时间表
   * 通常从第一节开始按顺序排）。整段拿不到就让请求失败或返回空数组，应用会退化成「用我现有的作息表」，
   * 不会编时间。
   */
  async timeSlots(semester, ctx) {
    const fields = ctx.config.sectionTimeFields || {};
    const response = await ctx.http.postForm(
      this.actionPath(ctx, 'sectionTimesAction', 'sectionTimesQuery'),
      ''
    );

    return this.rowsFor(response.json(), ctx, ctx.config.sectionTimesContainer).map((row, index) => {
      const declared = Number(ctx.pickFrom(row, fields.period));
      return {
        period: Number.isInteger(declared) && declared > 0 ? declared : index + 1,
        start: ctx.pickFrom(row, fields.start),
        end: ctx.pickFrom(row, fields.end)
      };
    });
  },

  /**
   * 一行 → 一条课时。
   *
   * 节次与周次都交给共享库解析：识别不了就让运行流程把它记成一条「跳过的行」，
   * 而不是在这里各写一套猜测规则。
   */
  normalizeRow(row, ctx) {
    const sections = ctx.parseSections(ctx.pick(row, 'section'));
    if (!sections) return { skip: '节次字段不是连续节次' };

    const weeks = ctx.parseWeeks(ctx.pick(row, 'weeks'));
    if (!weeks.length) return { skip: '周次为空' };

    return {
      name: ctx.pick(row, 'name'),
      teacher: ctx.pick(row, 'teacher'),
      day: Number(ctx.pick(row, 'day')),
      from: sections.from,
      to: sections.to,
      location: ctx.pick(row, 'location') || null,
      weeks: weeks,
      groupKey: this.groupKeyOf(row, ctx)
    };
  },

  /**
   * 分组键：教学班 → 课程号 → 课程名 + 教师。
   *
   * 最后一级特意带上教师：该族并非每个部署都返回教学班字段，光靠课程名会把同一门课的两个教学班
   * 合并成一门（丢课），加上教师通常能把它们分开。
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

    const name = String(ctx.pick(row, 'name') || '').trim();
    const teacher = String(ctx.pick(row, 'teacher') || '').trim();
    return 'name:' + name + '|teacher:' + teacher;
  },

  // ---------------------------------------------------------------- 内部工具

  /** 拼出请求路径；配置里没有 query 就不带问号。 */
  actionPath(ctx, actionKey, queryKey) {
    const action = String(ctx.config[actionKey] || '');
    const query = String(ctx.config[queryKey] || '').trim();
    return query ? action + '?' + query : action;
  },

  /**
   * 从响应里取行数组。
   *
   * 该族的信封键名在不同部署之间不一致（课表多为 `kbList`，节次时间多为 `jcList`，也有整体套一层
   * `data` 的），所以按三级退让：声明的取值 → 同名的嵌套 → 响应里唯一的数组字段。
   *
   * 退让只决定「从哪一行开始」，不改变字段映射；键名全对不上时拿不到行，表现为「这个学期没有数据」，
   * 而不是一张错误的课表。
   *
   * 这里用手写循环而不是 `Array.prototype.filter`：运行流程跑在教务系统页面里，而页面会改内建方法
   * （页面可能把 `filter` 改成永远返回空），用它会静默地得到 0 行。
   */
  rowsFor(json, ctx, container) {
    const declared = container && container.path ? container.path : null;
    const paths = [];
    if (declared) paths.push(declared);
    if (declared) paths.push('data.' + declared);
    for (let i = 0; i < paths.length; i += 1) {
      const value = ctx.pickFrom(json, paths[i]);
      if (Array.isArray(value)) return value;
    }

    const keys = Object.keys(json || {});
    const arrays = [];
    for (let i = 0; i < keys.length; i += 1) {
      const value = json[keys[i]];
      if (Array.isArray(value)) arrays.push(value);
    }
    return arrays.length === 1 ? arrays[0] : [];
  }
};
