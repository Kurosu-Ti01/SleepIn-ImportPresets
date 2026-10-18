// 探测脚本的脱敏规则与报告组装。
//
// 为什么单独测：这个脚本的作用是让**别人的**数据离开他的电脑，而它的失败方式只有一种——
// 报告里带着课程名、姓名或学号被贴到公开场合。所以这里既测「该脱敏的脱了」，
// 也测「骨架化认不出的字符只留码位、原文不出去」。
//
// 运行：node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const probe = require('../tools/probe/portal-recon.js');

test('骨架化：保留形状与长度，丢掉内容', () => {
  assert.equal(probe.skeleton('高等数学'), '中中中中');
  assert.equal(probe.skeleton('张老师'), '中中中');
  assert.equal(probe.skeleton('1-16周(单)'), '9-99中(中)');
  assert.equal(probe.skeleton('111100000000000000'), '999999999999999999');
  assert.equal(probe.skeleton('08:00'), '99:99');
  assert.equal(probe.skeleton('星期一'), '中中中');
  // 全角数字先折半角，否则会被自检拦下来。
  assert.equal(probe.skeleton('１-１６周'), '9-99中');
  // 罗马数字、带圈数字、上标这类排版字符同样由 NFKC 折成半角，不需要兜底。
  assert.equal(probe.skeleton('Ⅱ'), 'aa');
  assert.equal(probe.skeleton('①'), '9');
  // 生僻姓名用字（辅助平面上的扩展 B 区）算汉字。
  assert.equal(probe.skeleton('𠀀'), '中');
  // 纯 ASCII 的值也要变成骨架，不能原样留下（英文姓名、邮箱就属于这一类）。
  assert.equal(probe.skeleton('Zhang San'), 'aaaaa aaa');
  assert.equal(probe.skeleton('a.b@c.edu.cn'), 'a.a@a.aaa.aa');
});

test('自检：脱不干净就抛错，而不是返回 false', () => {
  assert.equal(probe.assertRedacted('中中 99-99 aa'), true);
  assert.throws(() => probe.assertRedacted('高等数学'), /汉字/);
  assert.throws(() => probe.assertRedacted('zhang'), /字母/);
  assert.throws(() => probe.assertRedacted('2023'), /数字/);
  // 非拉丁字母同样算漏网：自检要拦下来。
  assert.throws(() => probe.assertRedacted('Привет'), /字母/);
  // 但 brief 不再抛错：它换成形状标记，并把码位记进清单（由 buildReport 写进报告）。
  assert.equal(probe.brief('Привет'), 'aaaaaa');
});

test('brief：压空白、截断，并且在返回前自检', () => {
  assert.equal(probe.brief('  高等   数学 '), '中中 中中');
  assert.equal(probe.brief('高等数学', 2), '中中…');
  // 自检认不出的字符换成形状标记，不再让整份报告作废。
  assert.equal(probe.brief('Кафедра'), 'aaaaaaa');
});

test('sanitizePath：路由与选择器要留住，长数字段（学号）要抹掉', () => {
  assert.equal(probe.sanitizePath('/jsxsd/xskb/xskb_list.do'), '/jsxsd/xskb/xskb_list.do');
  assert.equal(probe.sanitizePath('/v9/xskb2'), '/v9/xskb2');
  assert.equal(probe.sanitizePath('/kb/2023123456.html'), '/kb/9999999999.html');
  assert.equal(probe.sanitizePath('kb-table'), 'kb-table');
});

test('参数：键名留下，值只留形状', () => {
  assert.deepEqual(probe.parseParams('xnxq01id=2024-2025-1&zc=1'), ['xnxq01id=9999-9999-9', 'zc=9']);
  // URL 编码的中文参数值同样要脱敏。
  assert.deepEqual(probe.parseParams('xm=%E5%BC%A0%E4%B8%89'), ['xm=中中']);
  assert.deepEqual(probe.parseParams(''), []);
});

test('请求体：表单与 JSON 都只报「参数名 = 形状」', () => {
  assert.deepEqual(probe.describeBody('xnxq01id=2024-2025-1'), {
    kind: 'form',
    params: ['xnxq01id=9999-9999-9']
  });
  assert.deepEqual(probe.describeBody('{"xh":"2023123456","xqid":"01"}'), {
    kind: 'json',
    params: ['xh=9999999999', 'xqid=99']
  });
  assert.equal(probe.describeBody(''), null);
});

test('URL：拆出路径与参数名，并标出跨源请求', () => {
  const same = probe.redactUrl(
    'https://jw.example.edu.cn/jsxsd/xskb/xskb_list.do?xnxq01id=2024-2025-1&xh=2023123456',
    'https://jw.example.edu.cn'
  );
  assert.equal(same.path, '/jsxsd/xskb/xskb_list.do');
  assert.deepEqual(same.query, ['xnxq01id=9999-9999-9', 'xh=9999999999']);
  assert.equal(same.crossOrigin, false);

  const cross = probe.redactUrl('https://cdn.example.net/track.gif', 'https://jw.example.edu.cn');
  assert.equal(cross.crossOrigin, true);

  // 相对地址（页面脚本拼出来的）也要能处理。
  assert.equal(probe.redactUrl('/kbcx/xskbcx_cxXsgrkb.html', 'https://jw.example.edu.cn').path, '/kbcx/xskbcx_cxXsgrkb.html');
});

test('结构骨架：数组报长度与样本，对象报键', () => {
  const shape = probe.shapeOf({ kbList: [{ kcmc: '高等数学', xqj: '1', zcd: '1-16周' }] }, 0);
  assert.deepEqual(shape, {
    kbList: {
      __array: 1,
      sample: [{ kcmc: '中中中中', xqj: '9', zcd: '9-99中' }]
    }
  });
  assert.equal(probe.shapeOf([{ a: 1 }], 0).__array, 1);
  assert.equal(probe.shapeOf(null, 0), null);

  // 位图单独处理：0 与 1 的骨架化结果一样，光看骨架分不出位图和长数字串。
  assert.equal(probe.shapeOf('11110000000000000000', 0), 'binary(len=20,ones=4)');
  assert.equal(probe.shapeOf('0000000000', 0), 'binary(len=10,ones=0)');
  // 短数字串（如星期 "1"、节次 "1-2"）不走位图分支。
  assert.equal(probe.shapeOf('12345678', 0), '99999999');
});

test('行数组候选：给出可以直接写进 rowContainer 的路径', () => {
  const rows = (count) => Array.from({ length: count }, (_, i) => ({ kcmc: '课', xqj: i + 1, jcs: '1-2', zcd: '1-16' }));
  const found = probe.findRowArrays({ code: 0, data: { list: rows(8) } }, '', [], 0);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'data.list');
  assert.equal(found[0].count, 8);
  assert.equal(found[0].keys.includes('kcmc'), true);

  // 少于 5 项就不当候选：单条记录、配置数组之类的噪声太多。
  assert.deepEqual(probe.findRowArrays({ data: { list: rows(3) } }, '', [], 0), []);
});

test('响应分类：JSON 报结构，非 JSON 给一句可读说明', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ kcmc: '课', xqj: String(i + 1), jcs: '1-2', zcd: '1-16' }));
  const json = probe.classifyBody(JSON.stringify({ data: { list: rows } }), 'application/json');
  assert.equal(json.json.rowArrays[0].path, 'data.list');
  assert.equal(json.note, undefined);

  const text = probe.classifyBody('用户名或密码错误', 'text/plain');
  assert.equal(text.note, '既不是 JSON 也不是 HTML：中中中中中中中中');
});

test('HTML 分类在 Node 里优雅降级（表格分析需要浏览器）', () => {
  // Node 没有 DOMParser：这里只要求「不抛错、如实说明」，真正的表格分析在浏览器里跑。
  const result = probe.classifyBody('<table><tr><td>高等数学</td></tr></table>', 'text/html');
  assert.equal(result.html.tableCount, 0);
  assert.equal(result.html.looksLikeTimetable, false);
  assert.equal(result.html.note, 'HTML 解析失败（需要浏览器）');
});

test('厂商关键词只报命中了哪些词，不带出原文', () => {
  assert.deepEqual(probe.vendorMarks('正方教务管理系统'), ['正方', '教务']);
  assert.deepEqual(probe.vendorMarks('长沙理工大学 张三 的课表'), []);
});

test('完整报告：原始内容一个字节都不剩', () => {
  const report = probe.buildReport({
    page: {
      origin: 'https://jw.example.edu.cn',
      host: 'jw.example.edu.cn',
      path: '/jsxsd/xskb/xskb_list.do?xh=2023123456',
      titleMarks: ['jsxsd'],
      inFrame: false
    },
    vendorMarks: ['jsxsd'],
    globals: [],
    records: [
      {
        method: 'POST',
        url: 'https://jw.example.edu.cn/jsxsd/xskb/xskb_list.do?xnxq01id=2024-2025-1',
        status: 200,
        contentType: 'text/html;charset=UTF-8',
        count: 1,
        body: { kind: 'form', params: ['xnxq01id=9999-9999-9'] },
        text: '<table><tr><td>高等数学 张三 2023123456</td></tr></table>'
      },
      {
        method: 'POST',
        url: '/kbcx/xskbcx_cxXsgrkb.html',
        status: 200,
        contentType: 'application/json',
        count: 3,
        text: JSON.stringify({
          kbList: Array.from({ length: 6 }, () => ({ kcmc: '高等数学', xm: '张三', xqj: '1', jcs: '1-2', zcd: '1-16周' }))
        })
      }
    ]
  });
  const text = JSON.stringify(report);
  // 这一条是整个脚本存在的意义：报告里不能出现任何原始值。
  for (const secret of ['高等数学', '张三', '2023123456', '2024-2025-1']) {
    assert.equal(text.includes(secret), false, `报告里不该出现「${secret}」`);
  }

  // 该留的侦查信息要留全。
  assert.equal(report.requests[1].rowArrays[0].path, 'kbList');
  assert.equal(report.requests[1].json.kbList.sample[0].zcd, '9-99中');
  assert.equal(report.requests[0].count, 1);
  assert.equal(report.requests[1].count, 3);
  assert.deepEqual(report.requests[0].query, ['xnxq01id=9999-9999-9']);
  // 没有参数时整个字段省略，避免报告里出现一堆空数组。
  assert.equal(report.requests[1].query, undefined);
  assert.deepEqual(report.familyHints.map((hint) => hint.family), ['qiangzhi-jsxsd', 'zhengfang-v9']);
  assert.equal(report.redaction.selfCheckPassed, true);
});

test('报告组装遇到规则外的字符：照常产出，只留码位，不含原文', () => {
  const report = probe.buildReport({
    page: { origin: '', host: '', path: '/x', titleMarks: [], inFrame: false },
    vendorMarks: [],
    globals: [],
    records: [
      {
        method: 'GET',
        url: '/x',
        status: 200,
        contentType: 'application/json',
        text: JSON.stringify({ name: 'Кафедра', kcmc: '大学英语Ⅱ', zcd: '〇周' })
      }
    ]
  });

  // 报告出得来，但原文一个字节都不在里面。
  const text = JSON.stringify(report);
  assert.equal(text.includes('Кафедра'), false);
  assert.equal(text.includes('Ⅱ'), false);
  assert.equal(text.includes('〇'), false);
  // 罗马数字（Ⅱ）由 NFKC 折成字母，〇 走兜底换成数字标记。
  assert.equal(report.requests[0].json.name, 'aaaaaaa');
  assert.equal(report.requests[0].json.kcmc, '中中中中aa');
  assert.equal(report.requests[0].json.zcd, '9中');

  // 定位靠码位：同码位只记一次，不带内容。
  assert.equal(report.redaction.selfCheckPassed, false);
  const codepoints = report.redaction.unresolved.map((item) => item.codePoint);
  assert.equal(codepoints.includes('U+041A'), true);
  assert.equal(codepoints.includes('U+3007'), true);
  assert.equal(report.redaction.unresolved.every((item) => item.kind === '字母' || item.kind === '数字'), true);
  assert.equal(report.redaction.unresolved.find((item) => item.codePoint === 'U+3007').kind, '数字');
});
