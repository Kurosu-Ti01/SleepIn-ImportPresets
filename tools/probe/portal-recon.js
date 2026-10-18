/**
 * SleepIn 教务系统探测脚本（在浏览器控制台里运行）
 *
 * 目的：把「这个学校的教务系统长什么样」整理成一段报告，让你可以安全地把它贴出来。
 * 用法与隐私说明见 tools/probe/README.md。
 *
 * 设计上有三条硬要求，改动时不要破坏：
 *   1. **不主动发任何请求**。它只观察页面自己发出的请求与响应。
 *   2. **不采集凭据与个人信息**。Cookie、localStorage、表单内容一律不读。
 *   3. **所有值都过一遍脱敏**，并在输出前做一次自检（见 assertRedacted）。自检认不出的字符会被换成
 *      形状标记，码位记进报告的 `redaction.unresolved`：**报告照常产出，原文一个字节都不进去**。
 *      出报告失败（而不是脱不干净）时仍然什么都不输出，见 abortOutput。
 *
 * 脱敏规则（骨架化）：汉字 → 中，字母 → a，数字 → 9，其它字符（标点、冒号、连字符）原样保留。
 * 汉字含 BMP 的表意区与辅助平面上的扩展区（生僻姓名用字）。
 * 于是 `1-16周(单)` 变成 `9-99中(中)`、`1111000000000000` 变成 `9999000000000000`、
 * `高等数学` 变成 `中中中中`：**形状与长度都保留了，内容一个字节都不剩**。
 * 写预设要的正是形状（是位图还是文本、是范围还是列表、是否含时刻），所以这样就够了。
 */
(function (root) {
  'use strict';

  var PROBE_VERSION = 1;
  var GLOBAL_NAME = '__sleepinRecon';

  // 报告要能贴在聊天窗口或 Issue 里，所以处处设上限。
  var MAX_CALLS = 40;
  var MAX_BODY_CHARS = 300000;
  var MAX_STR = 48;
  var MAX_KEYS = 60;
  var MAX_SAMPLE_ROWS = 3;
  var MAX_GLOBALS = 5;
  var MAX_ROW_ARRAYS = 6;
  var MAX_TABLES = 5;

  /**
   * 厂商关键词。页面标题与 HTML 里只报**命中了哪些词**，不报原文字。
   *
   * 这是「既要判断是哪家的系统、又不能把标题（可能含学生姓名）带出去」的折中：
   * 筛过一道之后，剩下的只有厂商名，没有个人信息。
   */
  var VENDOR_MARKS = [
    '正方', 'zhengfang', 'zfsoft',
    '强智', 'qiangzhi', 'jsxsd',
    '金智', 'jwapp', 'kingosoft',
    '东软', 'eams', 'urp',
    '超星', 'chaoxing', 'xuexitong',
    '树维', '青果', '新开普', '教务'
  ];

  /**
   * 已知族的指纹。**只是启发**：命中不等于就是那个族，最终要按报告里的请求与字段判断。
   * 这里只匹配路径与关键词，不匹配任何学校域名。
   */
  var FAMILY_HINTS = [
    { id: 'jwapp', test: /\/jwapp\//i, why: '路径包含 /jwapp/' },
    { id: 'eams-urp', test: /(\/eams\/|\/urp\/|eams|urp)/i, why: '路径包含 eams / urp' },
    { id: 'qiangzhi-jsxsd', test: /(\/jsxsd\/|jsxsd|xskb)/i, why: '路径包含 jsxsd / xskb' },
    { id: 'zhengfang-v9', test: /(\/kbcx\/|xskbcx|gnmkdm|kbcx)/i, why: '路径包含 kbcx / gnmkdm' },
    { id: 'chaoxing-jw', test: /(chaoxing|xuexitong|chaoxing\.com)/i, why: '路径或关键词命中超星' }
  ];

  // ---------------------------------------------------------------- 脱敏

  /**
   * 汉字：BMP 的扩展 A、统一表意区、兼容表意区，以及辅助平面上扩展 B 之后各区。
   * 辅助平面单独列出来是因为生僻姓名用字（`𠮷` 这类）落在那里；不列它的话这些字会走兜底，
   * 结果同样安全，只是形状上少一层信息。
   */
  var CJK_CLASS = '\\u3400-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{3ffff}';
  var CJK = new RegExp('[' + CJK_CLASS + ']', 'u');
  var CJK_ALL = new RegExp('[' + CJK_CLASS + ']', 'gu');
  /** 通用类别：判断骨架化认不出的字符算「字母」还是「数字」。 */
  var LETTER = /\p{L}/u;
  var NUMBER = /\p{N}/u;

  /**
   * 自检认不出的字符（`Ⅰ`、`①`、假名、西里尔字母……）：只记码位与类别，不记内容。
   *
   * 抓取阶段（请求体）与出报告阶段共用这份草稿；`buildReport` 在开始时就把它重建，
   * 所以重复出报告不会重复累积。
   */
  var unresolvedChars = [];

  /**
   * 脱敏自检专用错误。
   *
   * 它必须能与各处「出错了就降级」的 catch 区分开：那些 catch 是为了忍受教务系统返回的脏数据，
   * 而脱敏失败要走兜底（见 maskUnresolved），不能降级成一句 note 把原始内容留下来。
   */
  function redactionError(message) {
    var error = new Error(message);
    error.name = 'RedactionError';
    return error;
  }

  function isRedactionError(error) {
    return !!error && error.name === 'RedactionError';
  }

  /**
   * 自检：一段已经骨架化的文本里不允许再出现汉字、字母（除 `a`）、数字（除 `9`）。
   *
   * 它**抛错**而不是返回 false：调用方因此不可能「忘了处理返回值」而照常输出。唯一的调用点是
   * brief，它把失败交给兜底（见 maskUnresolved），值仍然不会原样出去。
   */
  function assertRedacted(text) {
    var rest = String(text).replace(/中/g, '');
    if (CJK.test(rest)) throw redactionError('脱敏自检失败：输出里仍有汉字');
    if (/[^\P{L}a]/u.test(rest)) throw redactionError('脱敏自检失败：输出里仍有字母');
    if (/[^\P{N}9]/u.test(rest)) throw redactionError('脱敏自检失败：输出里仍有数字');
    return true;
  }

  /** 骨架化：保留形状，丢掉内容。 */
  function skeleton(value) {
    var text = String(value === null || value === undefined ? '' : value);
    try {
      // 全角数字/字母先折成半角，否则它们会被自检当成「没脱干净」而整次失败。
      text = text.normalize('NFKC');
    } catch (error) {
      // 老环境没有 normalize：照旧处理，自检会拦住漏网的全角字符。
    }
    return text
      .replace(CJK_ALL, '中')
      .replace(/[A-Za-z]/g, 'a')
      .replace(/[0-9]/g, '9');
  }

  /** 记下一个自检认不出的字符：只留码位与类别，不留内容（同一码位只记一次）。 */
  function noteUnresolved(codePoint, kind) {
    for (var i = 0; i < unresolvedChars.length; i += 1) {
      if (unresolvedChars[i].codePoint === codePoint) return;
    }
    unresolvedChars.push({ codePoint: codePoint, kind: kind });
  }

  /** 字符 → `U+XXXX` 形式的码位（辅助平面上是五位十六进制）。 */
  function codePointOf(ch) {
    var hex = ch.codePointAt(0).toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return 'U+' + hex;
  }

  /**
   * 兜底：把自检认不出的字符换成形状标记（字母→a、数字→9、汉字→中），并把码位记进清单。
   *
   * 这里不抛错、也不原样放行。抛错会让整份报告消失，而拿不到报告就无从判断是哪个字段、哪个字符
   * 出的问题——定位只需要码位；照原样放行则等于把原始内容送出去，那一条不让步。
   */
  function maskUnresolved(text) {
    var out = '';
    Array.from(String(text)).forEach(function (ch) {
      if (ch === '中' || ch === 'a' || ch === '9') { out += ch; return; }
      // 汉字这一支是防御：正常路径下已经由 skeleton 换成「中」了。
      var kind = CJK.test(ch) ? '汉字' : (NUMBER.test(ch) ? '数字' : (LETTER.test(ch) ? '字母' : null));
      if (!kind) { out += ch; return; }
      noteUnresolved(codePointOf(ch), kind);
      out += kind === '数字' ? '9' : (kind === '字母' ? 'a' : '中');
    });
    return out;
  }

  /**
   * 骨架化 + 压空白 + 截断，并在返回前自检。所有「值」都必须从这里出去。
   *
   * 自检不过时不抛错，而是走兜底（见 maskUnresolved）：报告一定出得来，未知字符只剩码位。
   */
  function brief(value, max) {
    var limit = max || MAX_STR;
    var text = skeleton(value).replace(/\s+/g, ' ').trim();
    if (text.length > limit) text = text.slice(0, limit) + '…';
    try {
      assertRedacted(text);
    } catch (error) {
      if (!isRedactionError(error)) throw error;
      text = maskUnresolved(text);
    }
    return text;
  }

  /**
   * 路径里的长数字串打码。
   *
   * 路径整体**不骨架化**——它是判断「这是哪家的系统」的主要依据，骨架化之后就什么都看不出来了。
   * 但路径里可能出现学号（`/kb/2023123456.html`），所以把 5 位以上的数字串换成等长的 9：
   * 路由版本号（`v9`、`xskb2`）保留，学号消失。
   */
  function sanitizePath(path) {
    return String(path || '').replace(/\d{5,}/g, function (run) {
      return new Array(run.length + 1).join('9');
    });
  }

  /** `a=1&b=2` → `['a=9', 'b=9']`（值只保留形状）。 */
  function parseParams(text) {
    if (!text) return [];
    return String(text)
      .split('&')
      .filter(Boolean)
      .slice(0, 20)
      .map(function (part) {
        var at = part.indexOf('=');
        var key = sanitizePath(at < 0 ? part : part.slice(0, at));
        if (at < 0) return key;
        var raw = part.slice(at + 1);
        try {
          raw = decodeURIComponent(raw);
        } catch (error) {
          // 编码坏了就按原样骨架化。
        }
        return key + '=' + brief(raw, 24);
      });
  }

  /** 请求体只报「参数名 = 形状」，表单与 JSON 都处理。 */
  function describeBody(body) {
    if (!body || typeof body !== 'string') return null;
    var trimmed = body.trim();
    if (!trimmed) return null;
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try {
        var parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return { kind: 'json', params: Object.keys(parsed).slice(0, MAX_KEYS).map(function (key) { return key + '=' + brief(parsed[key], 24); }) };
        }
      } catch (error) {
        // 不是 JSON，按表单处理。
      }
    }
    return { kind: 'form', params: parseParams(trimmed) };
  }

  /** URL → { path, query, crossOrigin }。 */
  function redactUrl(raw, origin) {
    var text = String(raw || '');
    var crossOrigin = false;
    var rest = text;
    var matched = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i.exec(text);
    if (matched) {
      crossOrigin = !!origin && matched[1] !== origin;
      rest = text.slice(matched[1].length) || '/';
    }
    var at = rest.indexOf('?');
    return {
      path: sanitizePath(at < 0 ? rest : rest.slice(0, at)),
      query: at < 0 ? [] : parseParams(rest.slice(at + 1)),
      crossOrigin: crossOrigin
    };
  }

  // ---------------------------------------------------------------- 结构描述

  /**
   * JSON → 结构骨架：数组报长度与最多 3 个样本，对象报键，叶子值走 brief。
   *
   * 产出的是「键名 + 每个键的形状」，正好够判 `fields` 映射，又不含任何原始值。
   */
  function shapeOf(value, depth) {
    var level = depth || 0;
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      if (level > 3) return 'array(' + value.length + ')';
      return {
        __array: value.length,
        sample: value.slice(0, MAX_SAMPLE_ROWS).map(function (item) { return shapeOf(item, level + 1); })
      };
    }
    if (typeof value === 'object') {
      if (level > 3) return 'object';
      var out = {};
      Object.keys(value).slice(0, MAX_KEYS).forEach(function (key) {
        out[key] = shapeOf(value[key], level + 1);
      });
      return out;
    }
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return value ? 'bool:true' : 'bool:false';

    // 位图周次：只报长度与 1 的个数，不报 0/1 的原样。
    // 骨架化会把 0 和 1 都变成 9，位图与一长串数字就分不出来了，所以这里单独处理；
    // 而「哪几周有课」是学生自己的课表形状，没必要带出去。
    var text = String(value);
    if (/^[01]{8,}$/.test(text)) {
      var ones = 0;
      for (var bit = 0; bit < text.length; bit += 1) if (text.charAt(bit) === '1') ones += 1;
      return 'binary(len=' + text.length + ',ones=' + ones + ')';
    }
    return brief(value, 32);
  }

  /**
   * 找出「像课表行」的数组（≥5 项、每项都是至少 4 键的对象），报出它的路径。
   *
   * 这个路径就是要写进 `config.rowContainer.path` 的值，省掉一轮来回。
   */
  function findRowArrays(value, path, out, depth) {
    var list = out || [];
    var level = depth || 0;
    if (level > 4 || list.length >= MAX_ROW_ARRAYS) return list;

    if (Array.isArray(value)) {
      var first = null;
      for (var i = 0; i < value.length && i < MAX_SAMPLE_ROWS; i += 1) {
        var item = value[i];
        if (item && typeof item === 'object' && !Array.isArray(item)) { first = item; break; }
      }
      if (first && value.length >= 5) {
        list.push({
          path: path || '(root)',
          count: value.length,
          keys: Object.keys(first).slice(0, MAX_KEYS)
        });
      }
      value.slice(0, MAX_SAMPLE_ROWS).forEach(function (item, index) {
        findRowArrays(item, (path || '') + '[' + index + ']', list, level + 1);
      });
      return list;
    }

    if (value && typeof value === 'object') {
      Object.keys(value).slice(0, MAX_KEYS).forEach(function (key) {
        findRowArrays(value[key], path ? path + '.' + key : key, list, level + 1);
      });
    }
    return list;
  }

  /** HTML → 表格结构（几行几列、前几行的单元格骨架、表的 id/class）。 */
  function describeHtml(text) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
    } catch (error) {
      // Node 里没有 DOMParser；两个分支的形状要保持一致，调用方不用分开处理。
      return { tableCount: 0, tables: [], looksLikeTimetable: false, note: 'HTML 解析失败（需要浏览器）' };
    }

    var all = doc.querySelectorAll('table');
    var tables = [];
    for (var i = 0; i < all.length && tables.length < MAX_TABLES; i += 1) {
      var table = all[i];
      var rows = table.rows || [];
      var maxCells = 0;
      var head = [];
      for (var r = 0; r < rows.length && r < 4; r += 1) {
        var cells = rows[r].cells || [];
        if (cells.length > maxCells) maxCells = cells.length;
        head.push(Array.prototype.slice.call(cells, 0, 10).map(function (cell) {
          return brief(cell.textContent, 20);
        }));
      }
      tables.push({
        index: i,
        // 选择器要留着——它是 `tableSelectors` 的取值线索，所以只抹长数字段，不骨架化。
        id: sanitizePath(table.id || ''),
        className: sanitizePath(table.className || ''),
        tr: rows.length,
        maxCells: maxCells,
        head: head
      });
    }

    var heavy = tables.filter(function (table) { return table.tr >= 6 && table.maxCells >= 7; });
    return {
      tableCount: all.length,
      tables: tables,
      // 「6 行以上、7 列以上」是课表最常见的形状，值得单独标出来。
      looksLikeTimetable: heavy.length > 0
    };
  }

  /** 响应体 → 分类结果。JSON、HTML、其它三种。 */
  function classifyBody(text, contentType) {
    var body = String(text === null || text === undefined ? '' : text);
    if (!body) return { note: '响应体为空' };

    var type = String(contentType || '').toLowerCase();
    var looksJson = /json/.test(type) || /^[\s\r\n]*[[{]/.test(body);
    if (looksJson) {
      try {
        var parsed = JSON.parse(body);
        return {
          json: {
            shape: shapeOf(parsed, 0),
            rowArrays: findRowArrays(parsed, '', [], 0)
          }
        };
      } catch (error) {
        // 解析失败可以降级成一句说明；脱敏失败不行，必须往上抛。
        if (isRedactionError(error)) throw error;
        return { note: '像 JSON 但解析失败（可能是登录页或截断）' };
      }
    }

    if (/html|xml/.test(type) || /<table|<html|<div/i.test(body)) {
      return { html: describeHtml(body) };
    }

    return { note: '既不是 JSON 也不是 HTML：' + brief(body, 40) };
  }

  /** 在文本里找出命中的厂商关键词（只报词，不报原文）。 */
  function vendorMarks(text) {
    var haystack = String(text || '').toLowerCase();
    var hits = [];
    VENDOR_MARKS.forEach(function (mark) {
      if (hits.length >= 8) return;
      if (haystack.indexOf(mark.toLowerCase()) >= 0) hits.push(mark);
    });
    return hits;
  }

  /**
 * 收集报告里出现过的所有「厂商痕迹」，用来辅助判断族的归属。
 *
 * 接收的是原始 URL 列表（不是映射后的条目）：族指纹靠路径区分，而映射后的条目只保留了处理过的 path。
 * 这里只用来做正则匹配，匹配结果不会进报告。
 */
function familyHints(urls, page) {
    var corpus = [page.path, (page.titleMarks || []).join(' ')].join(' ');
    (urls || []).forEach(function (url) {
      corpus += ' ' + String(url || '');
    });
    var hints = [];
    FAMILY_HINTS.forEach(function (hint) {
      if (hint.test.test(corpus)) hints.push({ family: hint.id, why: hint.why });
    });
    return hints;
  }

  /**
   * 组装报告。输入是抓到的记录，输出是可直接序列化的对象。
   *
   * 值过不了脱敏自检时不再中止整份报告：认不出的字符换成形状标记，码位写进 `redaction.unresolved`
   * （见 brief / maskUnresolved）。
   */
  function buildReport(state) {
    // 从抓取阶段（请求体）记下的那份继续记；每次都重建，重复出报告不会重复累积。
    unresolvedChars = [];
    (state.unresolvedChars || []).forEach(function (item) { noteUnresolved(item.codePoint, item.kind); });

    var records = state.records.map(function (record) {
      var url = redactUrl(record.url, state.page.origin);
      var entry = {
        method: record.method,
        path: url.path,
        status: record.status,
        count: record.count || 1,
        contentType: brief(record.contentType || '', 40)
      };
      if (url.crossOrigin) entry.crossOrigin = true;
      if (url.query.length) entry.query = url.query;
      if (record.body) entry.requestBody = record.body;
      if (record.error) entry.error = brief(record.error, 60);

      var classified = classifyBody(record.text, record.contentType);
      if (classified.json) {
        entry.json = classified.json.shape;
        if (classified.json.rowArrays.length) entry.rowArrays = classified.json.rowArrays;
      }
      if (classified.html) entry.html = classified.html;
      if (classified.note) entry.note = classified.note;
      return entry;
    });

    var host = brief(state.page.host || '', 40);
    var unresolved = unresolvedChars.length ? unresolvedChars.slice() : null;

    return {
      probeVersion: PROBE_VERSION,
      generatedAt: new Date().toISOString(),
      page: {
        host: host,
        // 域名本身要脱敏（它就是学校身份），但「是不是 edu.cn」既不含身份、又直接关系到明文 HTTP 能否放行，
        // 所以单独报一个布尔值。
        hostIsEduCn: /\.edu\.cn$/i.test(String(state.page.host || '')),
        path: sanitizePath(state.page.path || ''),
        // 标题只报「命中了哪些厂商关键词」，不报原文字。
        titleMarks: state.page.titleMarks,
        inFrame: !!state.page.inFrame
      },
      requests: records,
      windowGlobals: state.globals,
      familyHints: familyHints(state.records.map(function (record) { return record.url; }), state.page),
      vendorMarks: state.vendorMarks,
      redaction: {
        policy: '汉字→中，字母→a，数字→9；长数字段（≥5 位）→ 等长 9；规则外的字符→形状标记',
        selfCheckPassed: !unresolved,
        // 只有兜底真的用上时才出现：码位 + 类别，不含内容。
        unresolved: unresolved || undefined
      }
    };
  }

  // ---------------------------------------------------------------- 导出（Node 侧测试用）

  var api = {
    PROBE_VERSION: PROBE_VERSION,
    VENDOR_MARKS: VENDOR_MARKS,
    skeleton: skeleton,
    brief: brief,
    assertRedacted: assertRedacted,
    isRedactionError: isRedactionError,
    sanitizePath: sanitizePath,
    parseParams: parseParams,
    describeBody: describeBody,
    redactUrl: redactUrl,
    shapeOf: shapeOf,
    findRowArrays: findRowArrays,
    describeHtml: describeHtml,
    classifyBody: classifyBody,
    vendorMarks: vendorMarks,
    buildReport: buildReport
  };

  var isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!isBrowser) {
    // Node：只把纯函数交出去（tests/recon-redaction.test.mjs 用）。
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  // ---------------------------------------------------------------- 浏览器侧

  if (root[GLOBAL_NAME]) {
    console.log('[SleepIn 探测] 已经装过了。进入课表页面后运行：' + GLOBAL_NAME + '.copy()');
    return;
  }

  var state = {
    records: [],
    globals: [],
    vendorMarks: [],
    // 抓取阶段（请求体）记下的无法脱敏的字符，出报告时合并进 redaction.unresolved。
    unresolvedChars: [],
    // 抓取过程中一旦发现脱敏失败就记在这里，dump() 会因此警告（但不中止输出）。
    redactionFailure: null,
    page: {
      origin: String(location.origin || ''),
      host: String(location.host || ''),
      path: String(location.pathname || '') + String(location.search || ''),
      // 顶层文档的字样；在 iframe 里运行时提示一下，因为漏掉的请求通常在别的 frame 上。
      inFrame: (function () { try { return window.top !== window.self; } catch (error) { return true; } })(),
      titleMarks: vendorMarks(document.title)
    }
  };

  /**
   * 抓取阶段也要过 brief（请求体里的参数值），而这时还没有报告可写：先把兜底记录收进 state，
   * 等出报告时与报告自己记下的合并。
   */
  function captureUnresolved(make) {
    unresolvedChars = [];
    var value = make();
    if (unresolvedChars.length) state.unresolvedChars = state.unresolvedChars.concat(unresolvedChars);
    return value;
  }

  function recordOf(entry) {
    var key = entry.method + ' ' + entry.url;
    for (var i = 0; i < state.records.length; i += 1) {
      if (state.records[i].method + ' ' + state.records[i].url === key) {
        // 同一个地址被反复请求（轮询）时只留一条，但记次数。
        state.records[i].count = (state.records[i].count || 1) + 1;
        state.records[i].status = entry.status;
        state.records[i].contentType = entry.contentType;
        state.records[i].text = entry.text;
        return;
      }
    }
    if (state.records.length >= MAX_CALLS) return;
    entry.count = 1;
    state.records.push(entry);
  }

  function patchXhr() {
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this[GLOBAL_NAME + '_url'] = url;
      this[GLOBAL_NAME + '_method'] = method;
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      var xhr = this;
      try {
        xhr.addEventListener('loadend', function () {
          try {
            recordOf({
              method: String(xhr[GLOBAL_NAME + '_method'] || 'GET').toUpperCase(),
              url: String(xhr[GLOBAL_NAME + '_url'] || ''),
              status: xhr.status,
              contentType: (xhr.getResponseHeader && xhr.getResponseHeader('content-type')) || '',
              text: String(xhr.responseText || '').slice(0, MAX_BODY_CHARS),
              body: captureUnresolved(function () { return describeBody(typeof body === 'string' ? body : ''); })
            });
          } catch (error) {
            // 请求照旧返回给页面。脱敏异常现在由 brief 自己兜底，这一层只是防御：真漏到这里就记下来，
            // 出报告时警告一次（不能在事件回调里把错误丢出去）。
            if (isRedactionError(error)) state.redactionFailure = error.message;
          }
        });
      } catch (error) {
        // 包装失败绝不能影响页面本身的请求。
      }
      return send.apply(this, arguments);
    };
  }

  function patchFetch() {
    var original = window.fetch;
    if (typeof original !== 'function') return;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : ((input && input.url) || '');
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var body = init && typeof init.body === 'string' ? init.body : '';
      var promise = original.apply(this, arguments);
      try {
        promise.then(function (response) {
          // 读副本，避免把页面自己要用的响应体吃掉。
          var clone = response.clone();
          clone.text().then(function (text) {
            try {
              recordOf({
                method: method,
                url: url,
                status: response.status,
                contentType: clone.headers.get('content-type') || '',
                text: String(text || '').slice(0, MAX_BODY_CHARS),
                body: captureUnresolved(function () { return describeBody(body); })
              });
            } catch (error) {
              // 同上：防御性的记录，不影响页面自己的 fetch。
              if (isRedactionError(error)) state.redactionFailure = error.message;
            }
          }, function () { /* 读不出来就算了 */ });
        }, function () { /* 请求本身失败，页面会自己处理 */ });
      } catch (error) {
        // 同上：观察者不能影响被观察者。
      }
      return promise;
    };
  }

  /**
   * 扫一遍 window 上的大数组。
   *
   * 有的教务系统把课表写在页面脚本的全局变量里（不发请求、也不在表格里），只靠抓请求会漏掉。
   * 只读自有可枚举属性、值一律骨架化，并且限制数量。
   */
  function scanGlobals() {
    var found = [];
    var keys;
    try {
      keys = Object.keys(window);
    } catch (error) {
      return found;
    }
    for (var i = 0; i < keys.length && found.length < MAX_GLOBALS && i < 4000; i += 1) {
      var key = keys[i];
      if (key.indexOf(GLOBAL_NAME) === 0) continue;
      var value;
      try {
        value = window[key];
      } catch (error) {
        continue;
      }
      if (!Array.isArray(value) || value.length < 5) continue;
      var first = null;
      for (var j = 0; j < value.length && j < MAX_SAMPLE_ROWS; j += 1) {
        var item = value[j];
        if (item && typeof item === 'object' && !Array.isArray(item)) { first = item; break; }
      }
      if (!first) continue;
      var itemKeys = Object.keys(first);
      if (itemKeys.length < 4) continue;
      try {
        found.push({
          name: sanitizePath(key),
          count: value.length,
          keys: itemKeys.slice(0, MAX_KEYS),
          sample: shapeOf(value.slice(0, 2), 0)
        });
      } catch (error) {
        // 单个变量出错不影响其它变量；但脱敏失败要往上报。
        if (isRedactionError(error)) throw error;
      }
    }
    return found;
  }

  function report() {
    state.vendorMarks = vendorMarks(document.title + ' ' + String(document.documentElement.innerHTML || '').slice(0, 40000));
    return buildReport(state);
  }

  /**
   * 生成报告并打印。
   *
   * 报告一定出得来：脱不掉的字符已经换成形状标记，码位写在 `redaction.unresolved` 里。
   * 只有报告根本组装不出来时才什么都不输出（见 abortOutput）。
   */
  function dump() {
    var built;
    try {
      built = report();
    } catch (error) {
      return abortOutput(error && error.message);
    }
    warnAboutRedaction(built);
    var text = JSON.stringify(built, null, 2);
    console.log('%c[SleepIn 探测] 下面是报告（已脱敏）。请整体复制，或运行 ' + GLOBAL_NAME + '.download() 存成文件：', 'font-weight:bold');
    console.log(text);
    return text;
  }

  /**
   * 报告里有兜底字符、或抓取阶段记到过脱敏异常时，明确警告一次。
   *
   * 报告本身不含原文（兜底只留码位），但用户需要知道「这份报告里有东西没按常规规则脱敏」，
   * 并把码位一起带上。
   */
  function warnAboutRedaction(built) {
    var unresolved = (built.redaction && built.redaction.unresolved) || [];
    if (state.redactionFailure) {
      console.warn('[SleepIn 探测] 警告：抓取阶段记录到一次脱敏异常（已按兜底处理）：' + state.redactionFailure);
    }
    if (!unresolved.length) return;
    console.warn(
      '[SleepIn 探测] 警告：有 ' + unresolved.length + ' 种字符不在常规脱敏规则内，' +
      '已换成形状标记，码位见 redaction.unresolved：' +
      unresolved.map(function (item) { return item.codePoint + '(' + item.kind + ')'; }).join(' ')
    );
    console.warn('[SleepIn 探测] 报告里没有原文，可以照常贴出；把这些码位一起带上就能定位。');
  }

  /** 中止输出：只在报告根本组装不出来时使用（例如报告结构里出现循环引用）。 */
  function abortOutput(reason) {
    console.error('[SleepIn 探测] 报告生成失败，已中止输出，不会显示任何报告内容。');
    console.error('[SleepIn 探测] 原因：' + (reason || '(未知)'));
    console.error('[SleepIn 探测] 请不要手动复制页面内容，把这句话记下来即可。');
    return null;
  }

  /** 存成文件：报告可能很长，走下载比走剪贴板稳。 */
  function download() {
    var built;
    try {
      built = report();
    } catch (error) {
      return abortOutput(error && error.message);
    }
    warnAboutRedaction(built);
    var blob = new Blob([JSON.stringify(built, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sleepin-portal-recon.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('[SleepIn 探测] 已请求下载 sleepin-portal-recon.json');
  }

  function copyReport() {
    var text = dump();
    if (!text) return;
    if (typeof copy === 'function') {
      copy(text);
      console.log('[SleepIn 探测] 已复制到剪贴板');
    } else {
      console.log('[SleepIn 探测] 当前环境没有 copy()，请手动选中上面的文本复制');
    }
  }

  root[GLOBAL_NAME] = {
    version: PROBE_VERSION,
    dump: dump,
    copy: copyReport,
    download: download,
    clear: function () {
      state.records = [];
      state.globals = [];
      state.unresolvedChars = [];
      state.redactionFailure = null;
      unresolvedChars = [];
      console.log('[SleepIn 探测] 已清空记录');
    },
    scan: function () { state.globals = scanGlobals(); return state.globals; },
    status: function () {
      console.log('[SleepIn 探测] 已记录 ' + state.records.length + ' 条请求；当前页面 ' + state.page.path);
      return state.records.length;
    },
    get: function () { return state; }
  };

  patchXhr();
  patchFetch();

  console.log('%c[SleepIn 探测] 已就绪。', 'font-weight:bold');
  console.log('接下来请：');
  console.log('  1. 在页面里正常登录，点到「课表查询」页面；');
  console.log('  2. 在课表页上改一下学年/学期，再点一次「查询」——脚本只能看到装好之后发出的请求，');
  console.log('     进页面时那次自动加载的请求已经过去了。忘了这步，报告里的 requests 会是空的；');
  console.log('  3. 如果课表在页面内的 iframe 里，请在上方的执行上下文下拉框里切到那个 iframe，再把这个脚本粘一次；');
  console.log('  4. 回来运行：' + GLOBAL_NAME + '.copy()   （或 ' + GLOBAL_NAME + '.download() 存成文件）');
  console.log('报告里只有字段名、参数名和值的形状，没有课程名、姓名、学号，也没有 Cookie。');
})(typeof window !== 'undefined' ? window : undefined);
