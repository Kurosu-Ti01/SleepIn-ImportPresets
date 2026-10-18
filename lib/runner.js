// SleepIn 导入脚本 · 共享运行流程
//
// 由生成器内联进每一个「由族拼装」的脚本（形态 A/B）。它负责与学校无关的一切：
//   · 桥交互（提示 / 选择 / 确认 / 提交），没有桥时退化为「只解析、打印摘要」的试跑模式
//   · 请求封装、字段映射、周次解析（这几项由 config 的取值决定，而不是写死在代码里）
//   · 行归一化后的编排：跳过统计、按时段合并、payload 组装
//   · 失败时的可读原因；诊断信息只含字段**名字**，不含课程名、姓名、学号
//
// 族适配器只需要回答「怎么取数」和「一行里的值在哪」，因此形态 A 的学校完全不需要代码，
// 只改 preset.json 里的取值。可选地再给一份作息时间（`timeSlots`），应用就会多一个
// 「用方案提供的作息表」选项；不给也不会错，只是用户得自己选一个已有作息表。
//
// 生成器注入的调用形状（见 tools/Build-PresetIndex.ps1）：
//   (async () => {
//     const config = { ...族默认值 + 该校取值... };
//     <lib/runner.js>
//     <families/<id>/adapter.js>      // 必须定义 const familyAdapter = { ... }
//     <presets/<id>/override.js>      // 可选，定义 const presetOverrides = { ... }
//     await runImport({ adapter: familyAdapter, overrides: presetOverrides, config, presetName });
//   })();

/** 运行流程的接口版本。族适配器用 family.json 的 apiVersion 声明它按哪一版编写。 */
const RUNNER_API_VERSION = 1;

/** 最多列出多少条跳过原因，避免提示框被噪声撑满。 */
const MAX_SKIP_REASONS = 5;

/** 学期选择列表最多给几项。两级（学年 × 学期）交叉后会有十几项，所以留出余地。 */
const MAX_SEMESTER_CHOICES = 24;

/**
 * 跑一次导入。
 *
 * @param options.adapter 族适配器；必需成员缺失时直接报错，而不是跑到一半产出错误的课程表
 * @param options.overrides 该校的具名覆盖；只覆盖它自己声明的环节（形态 B）
 * @param options.config 族默认值与该校取值合并后的结果
 * @param options.presetName 方案名，用于提示文案
 */
/**
 * 合并族适配器与该校的具名覆盖（后面的来源覆盖前面的）。
 *
 * 不用 `Object.assign`：适配器本身完好、合并结果却可能是空对象，而那时页面上 `Object.assign`
 * 单拿一个普通对象试又是好的——它的失效与具体调用有关，不能押。显式复制自己的
 * 可枚举键，语义与 `Object.assign` 一致，但不依赖这个可以被页面改写的全局函数。
 */
function mergeSteps(adapter, overrides) {
  const steps = {};
  [adapter, overrides].forEach((source) => {
    if (!source) return;
    Object.keys(source).forEach((key) => {
      steps[key] = source[key];
    });
  });
  return steps;
}

/**
 * 页面环境自检：运行流程是在教务系统页面的 JS 环境里跑的，而页面可以改掉浏览器的内置方法。
 *
 * 页面可能把 `Array.prototype.filter` 改成永远返回空、`every` 改成永远返回真：现象是
 * 「这个学期没有课表数据」，以及一句与真实原因毫无关系的报错。这里只探测运行流程真正依赖的那几个
 * 方法（被改坏的、不用的方法就不管），一旦行为不对就明确报出来并停下，而不是继续产出一张空课表。
 */
function findBrokenBuiltins() {
  const probes = [
    ['Array.prototype.map', () => [1, 2].map((n) => n * 2).join(',') === '2,4'],
    ['Array.prototype.forEach', () => { let seen = 0; [1, 2].forEach(() => { seen += 1; }); return seen === 2; }],
    ['Array.prototype.indexOf', () => [1, 2].indexOf(2) === 1],
    ['Array.prototype.slice', () => [1, 2, 3].slice(1).length === 2],
    ['Array.prototype.concat', () => [1].concat([2]).length === 2],
    ['Array.prototype.sort', () => [2, 1].sort((a, b) => a - b).join(',') === '1,2'],
    ['Array.prototype.join', () => [1, 2].join('-') === '1-2'],
    ['Array.prototype.push', () => { const list = []; list.push(1); return list.length === 1; }],
    ['Array.isArray', () => Array.isArray([]) === true && Array.isArray('x') === false],
    ['Object.keys', () => Object.keys({ a: 1 }).join(',') === 'a'],
    ['JSON.stringify', () => JSON.stringify({ a: 1 }) === '{"a":1}'],
    ['String.prototype.replace', () => 'ab'.replace('a', 'c') === 'cb'],
    ['String.prototype.split', () => 'a,b'.split(',').length === 2],
    ['String.prototype.trim', () => ' a '.trim() === 'a']
  ];

  // 用下标赋值而不是 push：push 本身可能就是被改坏的那一个。
  const broken = [];
  for (let i = 0; i < probes.length; i += 1) {
    let ok = false;
    try {
      ok = probes[i][1]() === true;
    } catch (error) {
      ok = false;
    }
    if (!ok) broken[broken.length] = probes[i][0];
  }
  return broken;
}

async function runImport(options) {
  const config = options.config || {};
  const steps = mergeSteps(options.adapter, options.overrides);
  const presetName = options.presetName || '导入方案';

  // 没有桥就是在桌面浏览器里试跑：只解析并打印摘要，不写库。
  const hasBridge = !!(window.sleepinBridge && window.sleepinBridgePromise);

  const log = (message) => {
    if (hasBridge && typeof window.sleepinBridge.log === 'function') window.sleepinBridge.log(message);
    else console.log('[sleepin] ' + message);
  };
  const toast = (message) => {
    if (hasBridge) window.sleepinBridge.toast(message);
    else console.log('[提示] ' + message);
  };
  const alertDialog = async (title, message, confirmText) => {
    if (hasBridge) return await window.sleepinBridgePromise.alert({ title, message, confirmText });
    console.log('[提示] ' + title + '：' + message.replace(/\n/g, ' / '));
    return true;
  };
  const choose = async (title, options_, defaultIndex) => {
    if (hasBridge) {
      return await window.sleepinBridgePromise.choose({ title, options: options_, defaultIndex });
    }
    console.log('[选择] ' + title + ' → 试跑模式下自动选第 ' + (defaultIndex + 1) + ' 项');
    return defaultIndex;
  };
  const askText = async (title, hint, initialValue) => {
    if (hasBridge) {
      return await window.sleepinBridgePromise.prompt({
        title: title,
        hint: hint || '',
        initialValue: initialValue || ''
      });
    }
    console.log('[输入] ' + title + ' → 试跑模式下直接采用默认值 ' + (initialValue || '(空)'));
    return initialValue || null;
  };

  const brokenBuiltins = findBrokenBuiltins();
  if (brokenBuiltins.length) {
    await alertDialog(
      '这个页面的运行环境不对',
      '检测到浏览器内置方法被这个页面改坏了：' + brokenBuiltins.join('、') +
        '。继续下去会得到不可信的课表，已停止。把这句话发给方案维护者即可。',
      '知道了'
    );
    return;
  }

  // 判断环节齐不齐：用显式循环，不用 Array.prototype.filter / every。
  // 运行流程跑在教务系统页面的 JS 环境里，页面对内建方法的改动会直接改变判断结果——
  // 页面可能把 filter / every 改成恒定的返回值而适配器与合并结果都带着全部键，那种情况下判断
  // 会得出「六个环节全缺」这种与真实原因无关的结论。
  const requiredSteps = ['detect', 'listSemesters', 'semesterCode', 'semesterLabel', 'fetchSchedule', 'normalizeRow'];
  const missing = [];
  for (let i = 0; i < requiredSteps.length; i += 1) {
    if (typeof steps[requiredSteps[i]] !== 'function') missing.push(requiredSteps[i]);
  }
  if (missing.length) {
    // 适配器缺环节时明确报出来：静默跑下去只会产出错误的课程表。
    // 而且要分清两种完全不同的原因：适配器本身就缺，还是适配器没问题、合并这一步丢了。
    const adapter = options.adapter || {};
    const overrides = options.overrides || {};
    const adapterKeys = Object.keys(adapter);
    const overrideKeys = Object.keys(overrides);
    let adapterHasThem = true;
    for (let i = 0; i < requiredSteps.length; i += 1) {
      if (typeof adapter[requiredSteps[i]] !== 'function') { adapterHasThem = false; break; }
    }
    const detail = adapterHasThem
      ? '适配器本身有全部 ' + requiredSteps.length + ' 个环节，合并之后却没了。' +
        '合并结果 steps 的键：[' + Object.keys(steps).join('、') + ']；' +
        '具名覆盖 overrides 的键：[' + (overrideKeys.length ? overrideKeys.join('、') : '（空）') + ']；' +
        '适配器的键：[' + adapterKeys.join('、') + ']。'
      : '适配器缺少必需的环节：' + missing.join('、') +
        '。当前适配器对象（' + (typeof options.adapter) + '）的键：' +
        (adapterKeys.length ? adapterKeys.join('、') : '（空）');
    await alertDialog('方案不可用', detail, '知道了');
    return;
  }

  const ctx = buildContext({ config, log, ui: { ask: choose, askText: askText }, notify: toast });
  const diagnostics = { skipped: 0, skipReasons: new Map(), fieldNames: [] };

  try {
    const detected = await steps.detect(ctx);
    if (detected !== true) {
      await alertDialog(
        '认不出这个教务系统',
        '这个方案没有在你当前打开的页面上找到预期特征，可能页面不对、还没登录，或该系统版本不同。\n\n' +
          (typeof detected === 'string' ? detected + '\n\n' : '') +
          '当前页面：' + currentPagePath(),
        '知道了'
      );
      return;
    }

    const confirmed = await alertDialog(
      '从教务系统导入',
      '将读取本学期课程表。\n\n请确认已经登录，并停在课表页面。',
      '开始读取'
    );
    if (confirmed !== true) {
      toast('已取消导入');
      return;
    }

    const semester = await chooseSemester(steps, ctx, choose, toast);
    if (!semester) return;
    // 算一次就够了，而且必须带着 ctx：适配器的 semesterLabel 要读 config。
    const semesterLabel = String(steps.semesterLabel(semester, ctx) || '').trim();

    let rows;
    try {
      rows = await steps.fetchSchedule(semester, ctx);
    } catch (error) {
      toast('读取课表失败：' + describeError(error));
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      toast('这个学期没有课表数据');
      return;
    }
    diagnostics.fieldNames = describeFieldNames(steps, rows, ctx);

    const courses = groupCourses(rows, steps, ctx, diagnostics);
    if (!courses.length) {
      await alertDialog(
        '没有解析出课程',
        '读取到了 ' + rows.length + ' 行数据，但没有一行能组成课程（跳过 ' + diagnostics.skipped + ' 行）。\n' +
          describeSkipReasons(diagnostics),
        '知道了'
      );
      return;
    }

    let meta = null;
    if (typeof steps.semesterMeta === 'function') {
      try {
        meta = await steps.semesterMeta(semester, ctx);
      } catch (error) {
        // 学期元信息只是补充，缺了不影响导入：课表名与周数用应用默认值。
        log('学期信息读取失败，将使用默认值：' + describeError(error));
      }
    }

    // 作息时间同样可选：能拿到就在确认弹窗里多一个「用方案提供的作息表」选项，
    // 拿不到就只剩「用我现有的作息表」，由用户自己选。
    let timeSlots = { slots: [], dropped: 0 };
    if (typeof steps.timeSlots === 'function') {
      try {
        timeSlots = normalizeTimeSlots(await steps.timeSlots(semester, ctx));
        if (timeSlots.dropped > 0) log('作息时间里有 ' + timeSlots.dropped + ' 条不合法，已忽略。');
      } catch (error) {
        log('作息时间读取失败，将不提供作息表：' + describeError(error));
      }
    }

    const payload = buildPayload(courses, semesterLabel, meta, timeSlots.slots);
    // 不用 reduce：页面会改内建方法，而这里算错只会在摘要里静默地少几条课时。
    let sessionCount = 0;
    for (let i = 0; i < courses.length; i += 1) sessionCount += courses[i].sessions.length;
    toast('解析出 ' + courses.length + ' 门课程、' + sessionCount + ' 条课时');

    if (!hasBridge) {
      printDryRun({
        presetName: presetName,
        semesterLabel: semesterLabel,
        meta: meta,
        courses: courses,
        sessionCount: sessionCount,
        timeSlots: timeSlots,
        diagnostics: diagnostics
      });
      return;
    }

    try {
      const committed = (await window.sleepinBridgePromise.commit(payload)) === true;
      if (!committed) {
        toast('导入未完成');
        return;
      }
    } catch (error) {
      toast('导入失败：' + describeError(error));
      return;
    }

    toast('导入完成');
    window.sleepinBridge.finish();
  } catch (error) {
    // 兜底：任何一个环节抛错都要给用户一句能看懂的话，而不是让页面安静下来。
    await alertDialog('导入出错', '读取过程中出错：' + describeError(error), '知道了');
  }
}

// ---------------------------------------------------------------- 上下文

/**
 * 组装适配器能用的工具。
 *
 * 字段映射与周次编码都在这里落到取值上，适配器因此不必自己解析 config：
 * 换一所字段名不同的学校，改的是 preset.json，不是代码。
 */
function buildContext({ config, log, ui, notify }) {
  const parseWeeks = (raw) => parseWeeksByEncoding(raw, config.weeksEncoding);
  const pick = (row, name) => {
    const path = (config.fields || {})[name];
    if (!path) return undefined;
    return pickPath(row, path);
  };

  return {
    config,
    log,
    pick,
    pickFrom: (value, path) => pickPath(value, path),
    parseWeeks,
    parseSections: (raw) => parseSectionsFromText(raw),
    // 适配器自己也要交互时用：与运行流程共用同一套桥封装，没有桥时同样退化为「取默认值 + 打日志」。
    ask: ui.ask,
    askText: ui.askText,
    notify: (message) => notify(message),
    // 页面读值：有的族的学期、校区、学号只存在于页面上，没有接口。
    pagePath: () => currentPagePath(),
    pageHtml: () => (typeof document === 'undefined' ? '' : String(document.documentElement && document.documentElement.innerHTML || '')),
    hasElement: (selector) => typeof document !== 'undefined' && !!document.querySelector(selector),
    pageText: (selector) => pageElement(selector) && String(pageElement(selector).textContent || '').trim(),
    pageValue: (selector) => {
      const element = pageElement(selector);
      if (!element) return null;
      const value = element.value;
      return value === undefined || value === null ? String(element.textContent || '').trim() : String(value).trim();
    },
    pageAttr: (selector, name) => {
      const element = pageElement(selector);
      return element && element.getAttribute ? element.getAttribute(name) : null;
    },
    pageOptions: (selector) => {
      if (typeof document === 'undefined') return [];
      const elements = document.querySelectorAll(String(selector) + ' option');
      const options = [];
      for (let i = 0; i < elements.length; i += 1) {
        const value = String(elements[i].value === undefined ? '' : elements[i].value).trim();
        const label = String(elements[i].textContent || '').trim();
        if (value || label) options.push({ value: value, label: label || value });
      }
      return options;
    },
    // HTML 页面族（课表在表格里）用：解析、按候选选择器找表、取单元格矩阵。
    parseHtml: (html) => parseHtmlDocument(html),
    findTable: (doc, selectors) => findTableIn(doc, selectors),
    tableMatrix: (table) => tableMatrixOf(table),
    cellText: (cell) => String((cell && cell.textContent) || '').replace(/\s+/g, ' ').trim(),
    cellBlocks: (html, options) => cellBlocksOf(html, options),
    cellHtml: (cell) => String((cell && cell.innerHTML) || ''),
    rowsFrom: (json) => rowsFrom(json, config.rowContainer),
    http: {
      get: (path) => httpRequest(path, { method: 'GET' }),
      postForm: (path, body) => httpRequest(path, { method: 'POST', body: body || '' })
    }
  };
}

/** 按点分路径取值；`*` 表示「当前对象的第一个键」，用于取动态键名的行容器。 */
function pickPath(value, path) {
  let current = value;
  const segments = String(path).split('.');
  for (let i = 0; i < segments.length; i += 1) {
    if (current === null || current === undefined) return undefined;
    const segment = segments[i];
    if (segment === '*') {
      const keys = Object.keys(current);
      if (!keys.length) return undefined;
      current = current[keys[0]];
      continue;
    }
    current = current[segment];
  }
  return current;
}

/** 从响应里取出行数组；取不到时返回空数组，让调用方按「没有数据」处理。 */
function rowsFrom(json, container) {
  const path = container && container.path ? container.path : 'rows';
  const rows = pickPath(json, path);
  return Array.isArray(rows) ? rows : [];
}

/** 只读的诊断信息：字段名清单（不含任何值）。 */
function describeFieldNames(steps, rows, ctx) {
  if (typeof steps.describeFields === 'function') {
    const names = steps.describeFields(rows, ctx);
    if (Array.isArray(names)) return names.map((name) => String(name));
  }
  let first = null;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i] && typeof rows[i] === 'object') { first = rows[i]; break; }
  }
  if (!first) return [];
  return Object.keys(first).map((key) => String(key));
}

// ---------------------------------------------------------------- 周次

/** 一周最多到第几周。超出这个范围的"周次"一定是把别的字段当成了周次。 */
const MAX_WEEK_NUMBER = 60;

/** 节次号上限，与应用侧的 MAX_SUPPORTED_PERIOD_NUMBER 一致。 */
const MAX_PERIOD_NUMBER = 60;

/** 报错信息里附带的原文长度上限。周次文本不是个人信息，带一点原文才排查得动。 */
const MAX_WEEK_TEXT_PREVIEW = 24;

/**
 * 周次解析。编码是变化点：同一个族的部署之间可能是位图、范围串或带单双周标记的文本。
 *
 * 支持三种形态：
 *   bitmap  '111100000000000000'（第 i 位 = 第 i+1 周）
 *   text    '1-16周' / '1,3,5周' / '1-16周(单)' / '2-16周(双)' / '1-8周(单),9-16周(双)' / '3周改'
 *   auto    按内容判断（长 0/1 串走 bitmap，否则走 text）
 *
 * **解析不了时抛错，而不是猜。** 这是刻意设计的：把 `第1-2节` 当成周次、或把 `1-16周(单)`
 * 里的 `(单)` 丢掉，都会在**不报错**的情况下产出一张错误课表——比直接失败更糟。抛错会被运行流程
 * 记成一条带原因的跳过记录，并出现在提示与试跑摘要里。
 *
 * 已知近似：`改`（调课周）标记只当作普通周次，因为我们没有办法在课表里表达“这一周被调走了”。
 */
function parseWeeksByEncoding(raw, encoding) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!text) return [];
  const mode = encoding || 'auto';

  if (mode === 'bitmap' || (mode === 'auto' && /^[01]+$/.test(text))) {
    // 明确声明 bitmap 时也要校验形状：把一个文本周次当位图展开会安安静静地算错周次。
    if (!/^[01]+$/.test(text)) {
      throw new Error('周次不是位图格式，但 weeksEncoding 声明为 bitmap：' + preview(text));
    }
    const weeks = [];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '1') weeks.push(i + 1);
    return weeks;
  }

  // 看起来是节次或时刻，就不是周次。这两类误读是最危险的静默错误，宁可直接失败。
  if (/节/.test(text)) {
    throw new Error('周次字段看起来是节次而不是周次：' + preview(text));
  }
  if (/\d{1,2}:\d{2}/.test(text)) {
    throw new Error('周次字段看起来是时刻而不是周次：' + preview(text));
  }

  const weeks = new Set();
  // 先按分隔符切成段，单双周标记只作用于它所在的那一段（'1-8周(单),9-16周(双)'）。
  text.split(/[,，、;；\s]+/).forEach((part) => {
    if (!part) return;
    const normalized = part.replace(/[（）()]/g, ' ').replace(/周/g, ' ').replace(/改/g, ' ');
    const parity = /单/.test(normalized) ? 'odd' : (/双/.test(normalized) ? 'even' : null);

    const numbers = normalized.match(/\d+/g);
    if (!numbers) return;

    // 一段里有两个数字且带连字符就是区间，否则全部当独立周次。
    const isRange = numbers.length >= 2 && /[-~至]/.test(normalized);
    const candidates = isRange
      ? rangeOf(Number(numbers[0]), Number(numbers[1]), text)
      : numbers.map((value) => Number(value));

    candidates.forEach((week) => {
      if (!Number.isInteger(week) || week < 1 || week > MAX_WEEK_NUMBER) {
        throw new Error('周次超出 1-' + MAX_WEEK_NUMBER + ' 的合理范围：' + preview(text));
      }
      if (parity === 'odd' && week % 2 === 0) return;
      if (parity === 'even' && week % 2 === 1) return;
      weeks.add(week);
    });
  });

  if (!weeks.size) {
    throw new Error('周次无法解析：' + preview(text));
  }
  return [...weeks].sort((a, b) => a - b);
}

/** 展开一个区间；区间过大或反向直接报错，而不是产出上万条周次。 */function rangeOf(from, to, sourceText) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new Error('周次区间不合法：' + preview(sourceText));
  }
  if (to - from + 1 > MAX_WEEK_NUMBER) {
    throw new Error('周次区间过大：' + preview(sourceText));
  }
  const weeks = [];
  for (let week = from; week <= to; week += 1) weeks.push(week);
  return weeks;
}

/** 报错信息里的原文片段：截断、去换行，不夹带其它字段。 */
function preview(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > MAX_WEEK_TEXT_PREVIEW ? flat.slice(0, MAX_WEEK_TEXT_PREVIEW) + '…' : flat;
}

// ---------------------------------------------------------------- 作息时间

/**
 * 校验方案提供的作息时间。
 *
 * 与周次不同，这里**丢掉不合法的条目而不是报错**：作息表是附加信息，一条坏数据不应该让整次导入失败。
 * 但也不能静默消失，所以被丢掉的条数由调用方写进日志与试跑摘要。
 *
 * @returns { slots, dropped }：slots 按节次号排序，dropped 是被忽略的条数
 */
function normalizeTimeSlots(raw) {
  if (!Array.isArray(raw)) return { slots: [], dropped: 0 };

  const slots = [];
  const seenPeriods = new Set();
  let dropped = 0;

  raw.forEach((entry) => {
    const period = Number(entry && entry.period);
    const start = normalizeClock(entry && entry.start);
    const end = normalizeClock(entry && entry.end);
    const usable = Number.isInteger(period) &&
      period >= 1 &&
      period <= MAX_PERIOD_NUMBER &&
      start &&
      end &&
      start < end &&
      !seenPeriods.has(period);

    if (!usable) {
      dropped += 1;
      return;
    }
    seenPeriods.add(period);
    slots.push({ period: period, start: start, end: end });
  });

  slots.sort((a, b) => a.period - b.period);
  return { slots: slots, dropped: dropped };
}

/**
 * 'H:mm' / 'HH:mm' / 'HH:mm:ss' → 'HH:mm'；无法识别时返回 null。
 *
 * 统一补零后，字符串比较就是时间先后比较，不用再解析一次。
 */
function normalizeClock(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  const matched = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!matched) return null;

  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return null;
  return String(hour).padStart(2, '0') + ':' + matched[2];
}

// ---------------------------------------------------------------- 节次

/**
 * 节次文本 → { from, to }；无法识别时返回 null。
 *
 * 各族的写法不同：`1-2`、`1-2节`、`第1-2节`、`[1-2节]`、单独一节写 `3`。只接受「单节」与「连续区间」
 * 两种含义：非连续（`1,3`）无法用 payload 的 from/to 表达，返回 null 让运行流程把它记进「跳过的行」，
 * 而不是悄悄算成 1-3 把没上的课也画进去。
 */
function parseSectionsFromText(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!text) return null;

  // 先摘掉时刻：课表的行头常写成「第1-2节 08:00-09:40」，直接抓数字会把 08:00 也算成节次。
  const withoutTimes = text.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ');
  const numbers = withoutTimes.match(/\d+/g);
  if (!numbers) return null;

  // 逗号/顿号分隔的多个数字表示几节不连续的课，不能折叠成一个区间。
  const separated = /[、,，;；]/.test(withoutTimes);
  if (numbers.length > 2 || (numbers.length === 2 && separated)) return null;

  const from = Number(numbers[0]);
  const to = numbers.length === 2 ? Number(numbers[1]) : from;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 1 || to < from || to > MAX_PERIOD_NUMBER) return null;
  return { from: from, to: to };
}

// ---------------------------------------------------------------- 解析工具

/** 页面元素查询；没有 document（试跑模式）时返回 null。 */
function pageElement(selector) {
  if (typeof document === 'undefined' || !selector) return null;
  return document.querySelector(String(selector));
}

/**
 * 把 HTML 文本解析成可查询的文档。
 *
 * 用页面自带的 DOMParser（WebView 里一定有），所以不引入任何解析库；拿不到解析器时返回 null，
 * 调用方据此给出可读的失败原因，而不是直接崩。
 */
function parseHtmlDocument(html) {
  const text = String(html === null || html === undefined ? '' : html);
  if (!text.trim()) return null;
  if (typeof DOMParser === 'undefined') return null;
  try {
    return new DOMParser().parseFromString(text, 'text/html') || null;
  } catch (error) {
    return null;
  }
}

/**
 * 按候选选择器依次找第一个命中的元素。
 *
 * 同一个族的部署换了页面模板但没换接口，所以「多写几个选择器依次试」比写死一个稳。
 * 都不命中时返回 null，由调用方决定怎么报。
 */
function findTableIn(doc, selectors) {
  if (!doc || typeof doc.querySelector !== 'function') return null;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (let i = 0; i < list.length; i += 1) {
    const selector = String(list[i] || '').trim();
    if (!selector) continue;
    let found = null;
    try {
      found = doc.querySelector(selector);
    } catch (error) {
      // 取值里写错了选择器不应该让整次导入失败：跳过它继续试下一个。
      found = null;
    }
    if (found) return found;
  }
  return null;
}

/** 表格 → 单元格矩阵（行 × 列），依赖 HTMLTableElement 的 rows/cells。 */
function tableMatrixOf(table) {
  if (!table || !table.rows) return [];
  const matrix = [];
  for (let i = 0; i < table.rows.length; i += 1) {
    const row = table.rows[i];
    const cells = [];
    if (row.cells) {
      for (let j = 0; j < row.cells.length; j += 1) cells.push(row.cells[j]);
    }
    matrix.push(cells);
  }
  return matrix;
}

/** 去掉标签与实体，压缩空白。 */
function plainTextOf(html) {
  return String(html === null || html === undefined ? '' : html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉标签后的第一段非空文本（HTML 课表里它通常是课程名）。 */
function firstPlainLine(html) {
  const parts = String(html === null || html === undefined ? '' : html)
    .replace(/<[^>]*>/g, '\n')
    .split('\n');
  for (let i = 0; i < parts.length; i += 1) {
    const line = parts[i].trim();
    if (line) return line;
  }
  return '';
}

/** 读带 title 的内联标签内容；title 可能有多个候选文案，依次试。 */
function readTitled(html, titles) {
  const list = Array.isArray(titles) ? titles : [titles];
  for (let i = 0; i < list.length; i += 1) {
    const title = String(list[i] || '').trim();
    if (!title) continue;
    const pattern = '<[^>]*title\\s*=\\s*["\']' + escapeRegExpText(title) + '["\'][^>]*>([\\s\\S]*?)<\\/';
    const matched = new RegExp(pattern, 'i').exec(html);
    if (matched) return plainTextOf(matched[1]);
  }
  return '';
}

/** 把配置里的文案转义成正则字面量（title 文案里常带括号）。 */
function escapeRegExpText(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把一个表格单元格拆成若干「课程块」。
 *
 * HTML 课表族的共同形状：一个格子里用分隔线摆着几门课，每门课的教师/教室/周次节次写在带 title 的
 * 内联标签里。这里只负责「拆」与「取」，不解释字段含义 —— 拆法（分隔线）与标签文案都是取值，由族传进来。
 */
function cellBlocksOf(html, options) {
  const splitter = String((options && options.blockSplitter) || '-----');
  const titles = (options && options.titles) || {};

  const blocks = String(html === null || html === undefined ? '' : html)
    .split(splitter)
    .map((blockHtml, index) => ({
      index: index,
      name: firstPlainLine(blockHtml),
      teacher: readTitled(blockHtml, titles.teacher),
      location: readTitled(blockHtml, titles.location),
      weekSection: readTitled(blockHtml, titles.weekSection),
      text: plainTextOf(blockHtml),
      html: blockHtml
    }));

  // 名字为空的块丢掉（分隔线两边的留白就是这样）。不用 filter：页面会改内建方法。
  const named = [];
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].name) named.push(blocks[i]);
  }
  return named;
}

/**
 * 把适配器给的地址解析成可请求的路径。
 *
 * 相对路径一直允许；绝对地址只允许**同源**——有的部署把地址从页面 URL 拼出来，同源绝对地址是
 * 它的正常写法。跨源一律拒绝：脚本只访问教务系统自己的接口这条约定由代码保证，不靠人工审阅。
 */
function resolveRequestTarget(path) {
  const target = String(path);
  if (!/^https?:\/\//i.test(target) && !target.startsWith('//')) return target;

  const origin = typeof location === 'undefined' ? '' : String(location.origin || '');
  if (!origin || origin === 'null') {
    throw new Error('适配器只能请求同源地址，收到：' + target);
  }

  const absolute = target.startsWith('//')
    ? String(typeof location === 'undefined' ? '' : location.protocol || '') + target
    : target;
  if (absolute !== origin && absolute.indexOf(origin + '/') !== 0) {
    throw new Error('适配器只能请求同源地址，收到：' + target);
  }
  return target;
}

// ---------------------------------------------------------------- 取数

/**
 * 一次同源请求。
 *
 * 跨源请求一律拒绝（见 [resolveRequestTarget]）：脚本只应该访问教务系统自己的接口。
 */
async function httpRequest(path, options) {
  const target = resolveRequestTarget(path);

  const init = {
    method: options.method,
    // 教务系统靠 Cookie 判断登录态，缺了它所有请求都会返回登录页。
    credentials: 'same-origin',
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
  };
  if (options.method === 'POST') {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    init.body = options.body;
  }

  const response = await fetch(target, init);
  const text = await response.text();
  if (!(response.status >= 200 && response.status <= 299)) {
    throw new Error(target + ' 返回 HTTP ' + response.status + '（' + shortText(text) + '）');
  }
  return { status: response.status, text: text, json: () => parseJson(text) };
}

/** 解析 JSON，并把「返回的是登录页」这类情况说清楚。 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('返回的不是 JSON（' + shortText(text) + '）');
  }
}

function shortText(text) {
  const normalized = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  if (!normalized) return '空响应';
  return normalized.length > 60 ? normalized.slice(0, 60) + '…' : normalized;
}

// ---------------------------------------------------------------- 学期

/**
 * 选学期：优先用页面上已经选中的那个，拿不到再让用户从最近的若干个里挑。
 */
async function chooseSemester(steps, ctx, choose, toast) {
  let semesters;
  try {
    semesters = await steps.listSemesters(ctx);
  } catch (error) {
    toast('读取学期列表失败：' + describeError(error));
    return null;
  }
  if (!Array.isArray(semesters) || !semesters.length) {
    toast('没有读到任何学年学期');
    return null;
  }

  if (typeof steps.currentSemester === 'function') {
    // 允许异步：有的族要发一个「当前学期」接口才知道，不能把 Promise 当成学期用。
    const current = await steps.currentSemester(semesters, ctx);
    if (current) return current;
  }

  const top = semesters.slice(0, MAX_SEMESTER_CHOICES);
  const labels = top.map((semester) => String(steps.semesterLabel(semester, ctx)));
  const index = await choose('选择要导入的学期', labels, 0);
  if (index === null || index === undefined) {
    toast('已取消导入');
    return null;
  }
  return top[index] || null;
}

// ---------------------------------------------------------------- 行 → 课程

/**
 * 归一化并分组。
 *
 * 分组键用适配器给的值：不同教学班是两门课，合并了会丢课。键相同的行折成同一门课的多个时段。
 * `normalizeRow` 可以返回单个对象、对象数组（一行装多门课）、`{ skip: '原因' }` 或 null。
 */
function groupCourses(rows, steps, ctx, diagnostics) {
  const byCourse = new Map();

  // 一条原始行可能装着多门课，所以归一化的结果按数组处理：返回单个对象、返回数组、
  // 返回 { skip } 或 null 都要合法。
  const accept = (normalized) => {
    if (normalized && normalized.skip) {
      countSkip(diagnostics, String(normalized.skip));
      return;
    }
    if (!normalized) {
      countSkip(diagnostics, '字段缺失或越界');
      return;
    }

    const name = String(normalized.name || '').trim();
    const day = Number(normalized.day);
    const from = Number(normalized.from);
    const to = Number(normalized.to);
    const weeks = Array.isArray(normalized.weeks) ? normalized.weeks : [];
    if (!name || !(day >= 1 && day <= 7) || !(from >= 1) || !(to >= from) || !weeks.length) {
      countSkip(diagnostics, '字段缺失或越界');
      return;
    }

    const key = String(normalized.groupKey || name);
    if (!byCourse.has(key)) {
      byCourse.set(key, { name: name, teachers: new Set(), sessions: [] });
    }
    const course = byCourse.get(key);
    if (normalized.teacher) course.teachers.add(String(normalized.teacher).trim());
    course.sessions.push({
      day: day,
      from: from,
      to: to,
      location: normalized.location ? String(normalized.location).trim() : null,
      weeks: weeks
    });
  };

  rows.forEach((row) => {
    let normalized;
    try {
      normalized = steps.normalizeRow(row, ctx);
    } catch (error) {
      countSkip(diagnostics, '归一化出错：' + describeError(error));
      return;
    }

    const items = Array.isArray(normalized) ? normalized : [normalized];
    if (!items.length) {
      countSkip(diagnostics, '归一化没有返回内容');
      return;
    }
    items.forEach(accept);
  });

  return [...byCourse.values()].map((course) => ({
    name: course.name,
    teacher: course.teachers.size ? [...course.teachers].join('、') : null,
    note: null,
    color: null,
    sessions: mergeSessions(course.sessions, ctx.config.mergeAdjacentSections)
  }));
}

/**
 * 合并同一门课的时段。
 *
 * 两步，对应「同一节课被拆成多条」的两种常见形态：
 *   1. 同一时段（同一天、同起止、同地点）只有周次不同的行——单双周分开返回的部署就是这样；
 *   2. 首尾相接的相邻节次（1 与 2）——按「每节一行」返回的课表就是这样，
 *      只有时间、周次、地点都相同才算同一节课。
 *
 * 第二步可以用 `mergeAdjacentSections: false` 关掉：极少数教务把同一门课的两节安排成“真的分成两节课”。
 */
function mergeSessions(sessions, mergeAdjacent) {
  const bySlot = new Map();
  sessions.forEach((session) => {
    const key = [session.day, session.from, session.to, session.location || ''].join('|');
    if (!bySlot.has(key)) bySlot.set(key, Object.assign({}, session, { weeks: new Set() }));
    session.weeks.forEach((week) => bySlot.get(key).weeks.add(week));
  });

  const merged = [...bySlot.values()].map((session) => ({
    day: session.day,
    from: session.from,
    to: session.to,
    location: session.location,
    weeks: [...session.weeks].sort((a, b) => a - b)
  }));
  if (mergeAdjacent === false) return merged;

  const byDayAndWeeks = new Map();
  merged.forEach((session) => {
    const key = [session.day, session.location || '', session.weeks.join(',')].join('|');
    if (!byDayAndWeeks.has(key)) byDayAndWeeks.set(key, []);
    byDayAndWeeks.get(key).push(session);
  });

  const result = [];
  byDayAndWeeks.forEach((group) => {
    group.sort((a, b) => a.from - b.from || a.to - b.to);
    let current = null;
    group.forEach((session) => {
      if (current && session.from <= current.to + 1) {
        current = Object.assign({}, current, { to: Math.max(current.to, session.to) });
        return;
      }
      if (current) result.push(current);
      current = Object.assign({}, session);
    });
    if (current) result.push(current);
  });

  return result.sort((a, b) => a.day - b.day || a.from - b.from);
}

function countSkip(diagnostics, reason) {
  diagnostics.skipped += 1;
  const key = reason || '未知原因';
  diagnostics.skipReasons.set(key, (diagnostics.skipReasons.get(key) || 0) + 1);
}

function describeSkipReasons(diagnostics) {
  if (!diagnostics.skipReasons.size) return '';
  const lines = [...diagnostics.skipReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SKIP_REASONS)
    .map(([reason, count]) => '· ' + reason + '（' + count + ' 行）');
  return '跳过原因：\n' + lines.join('\n');
}

// ---------------------------------------------------------------- 组装与输出

function buildPayload(courses, semesterLabel, meta, periods) {
  const payload = { schema: 1, courses: courses };
  const timetable = {};

  // 方案能给就用方案给的名称；给不了就用学期显示名（两者都可能为空，那就整体不传）。
  const name = meta && meta.name ? String(meta.name).trim() : semesterLabel;
  if (name) timetable.name = name;
  if (meta && Number(meta.totalWeeks) > 0) timetable.totalWeeks = Number(meta.totalWeeks);
  if (meta && meta.startDate) timetable.startDate = String(meta.startDate);

  // 整体为空就不传，让应用用自己的默认值，而不是传一堆空字段。
  if (Object.keys(timetable).length) payload.timetable = timetable;

  // 作息时间：传了就表示“这个教务系统自带上课时间”，应用会在确认弹窗里让用户选要不要新建作息表。
  if (Array.isArray(periods) && periods.length) payload.periods = periods;
  return payload;
}

/**
 * 试跑输出。
 *
 * 刻意不含课程名与任何个人信息：这是给贡献者贴到公开场合用的，字段名与计数才是有用信息。
 */
function printDryRun(report) {
  let first = null;
  for (let i = 0; i < report.courses.length; i += 1) {
    if (report.courses[i].sessions.length) { first = report.courses[i]; break; }
  }
  console.log(JSON.stringify({
    注意: '当前不在应用内（没有桥），只解析未写库',
    方案: report.presetName,
    学期: report.semesterLabel,
    总周数: report.meta && report.meta.totalWeeks ? report.meta.totalWeeks : null,
    开学日期: report.meta && report.meta.startDate ? report.meta.startDate : null,
    课程数: report.courses.length,
    课时数: report.sessionCount,
    作息节次: report.timeSlots ? report.timeSlots.slots.length : 0,
    被丢弃的作息条目: report.timeSlots ? report.timeSlots.dropped : 0,
    跳过的行: report.diagnostics.skipped,
    跳过原因: [...report.diagnostics.skipReasons.entries()].map(([reason, count]) => reason + '×' + count),
    响应字段名: report.diagnostics.fieldNames,
    首个时段: first
      ? {
          day: first.sessions[0].day,
          from: first.sessions[0].from,
          to: first.sessions[0].to,
          周次数: first.sessions[0].weeks.length,
          周次前几位: first.sessions[0].weeks.slice(0, 6)
        }
      : null
  }, null, 1));
}

function describeError(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

function currentPagePath() {
  if (typeof location === 'undefined') return '(未知)';
  return String(location.pathname || '') + String(location.search || '');
}
