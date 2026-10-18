// 探测脚本的浏览器分支：装得上、抓得到、出得了报告，并且报告里没有原始值。
//
// 为什么需要这个文件：这个脚本是要让**陌生人**在他自己的浏览器里粘的，而我们没有浏览器可以直接测。
// 用一层最小的假 DOM/假 XMLHttpRequest 把它跑起来，至少能挡住「一粘就崩」这类错误
// （实际上它抓到过一次：IIFE 声明了参数却没在调用时传，`root` 是 undefined）。
//
// 运行：node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probeSource = fs.readFileSync(path.join(here, '..', 'tools', 'probe', 'portal-recon.js'), 'utf8');

/** 课表行的夹具：故意塞进课程名、姓名、学号，用来验证它们不会出现在报告里。 */
const COURSE_NAME = '高等数学';
const STUDENT_NAME = '张三';
const STUDENT_ID = '2023123456';
const SEMESTER = '2024-2025-1';

class FakeXhr {
  constructor() {
    this.listeners = [];
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  send(body) {
    this.body = body;
  }

  addEventListener(type, handler) {
    if (type === 'loadend') this.listeners.push(handler);
  }

  getResponseHeader() {
    return 'application/json; charset=UTF-8';
  }

  /** 模拟响应到达。 */
  finish() {
    this.status = 200;
    this.responseText = JSON.stringify({
      data: {
        list: Array.from({ length: 6 }, (_, index) => ({
          kcmc: COURSE_NAME,
          xm: STUDENT_NAME,
          xqj: String((index % 5) + 1),
          jcs: '1-2',
          zcd: '11110000000000000000'
        }))
      }
    });
    this.listeners.forEach((handler) => handler());
  }
}

/** 把探测脚本装进一个最小的假浏览器里，返回它的全局对象与日志。 */
function bootProbe() {
  const window = {};
  const logs = [];
  const document = {
    title: `正方教务管理系统 - ${STUDENT_NAME} - 课表查询`,
    documentElement: { innerHTML: '<div>课表</div>' },
    createElement: () => ({ click() {} }),
    body: { appendChild() {}, removeChild() {} }
  };
  const location = {
    origin: 'https://jw.example.edu.cn',
    host: 'jw.example.edu.cn',
    pathname: '/jsxsd/xskb/xskb_list.do',
    search: `?xh=${STUDENT_ID}`
  };

  const factory = new Function(
    'window',
    'document',
    'location',
    'XMLHttpRequest',
    'DOMParser',
    'Blob',
    'URL',
    'fetch',
    'console',
    'copy',
    probeSource
  );
  factory(
    window,
    document,
    location,
    FakeXhr,
    function FakeDomParser() {
      return { querySelectorAll: () => [] };
    },
    function FakeBlob() {},
    { createObjectURL: () => 'blob:fake' },
    undefined,
    { log: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push('ERR ' + args.join(' ')) },
    undefined
  );
  return { window, logs };
}

test('能在浏览器里装上，并且重复粘贴是安全的', () => {
  const { window, logs } = bootProbe();
  assert.equal(typeof window.__sleepinRecon.version, 'number');
  assert.equal(window.__sleepinRecon.version, 1);
  assert.ok(logs.some((line) => line.includes('已就绪')), '应该给出下一步该做什么');

  // 第二次粘贴不能重新装一遍补丁（否则会把同一个请求记成两条）。
  const first = window.__sleepinRecon;
  bootProbe();
  assert.equal(typeof first.dump, 'function');
});

test('抓得到页面自己发的请求，并整理成脱敏报告', () => {
  const { window } = bootProbe();
  const probe = window.__sleepinRecon;

  const xhr = new FakeXhr();
  xhr.open('POST', `/jsxsd/xskb/xskb_list.do?xnxq01id=${SEMESTER}&xh=${STUDENT_ID}`);
  xhr.send(`xnxq01id=${SEMESTER}&zc=1`);
  xhr.finish();
  assert.equal(probe.status(), 1);

  // 课表也可能只写在页面的全局变量里，不发请求。
  window.kbList = Array.from({ length: 12 }, () => ({
    kcmc: COURSE_NAME,
    xm: STUDENT_NAME,
    xqj: '1',
    jcs: '1-2',
    zcd: '1-16周'
  }));
  probe.scan();

  const report = JSON.parse(probe.dump());

  // 侦查需要的信息要留全。
  assert.equal(report.requests[0].path, '/jsxsd/xskb/xskb_list.do');
  assert.deepEqual(report.requests[0].query, [`xnxq01id=9999-9999-9`, `xh=9999999999`]);
  assert.deepEqual(report.requests[0].requestBody.params, [`xnxq01id=9999-9999-9`, 'zc=9']);
  assert.equal(report.requests[0].json.data.list.__array, 6);
  assert.equal(report.requests[0].json.data.list.sample[0].kcmc, '中中中中');
  assert.equal(report.requests[0].json.data.list.sample[0].zcd, 'binary(len=20,ones=4)');
  assert.equal(report.requests[0].rowArrays[0].path, 'data.list');
  assert.equal(report.windowGlobals[0].name, 'kbList');
  assert.equal(report.windowGlobals[0].count, 12);
  assert.deepEqual(report.familyHints.map((hint) => hint.family), ['qiangzhi-jsxsd']);
  assert.equal(report.page.hostIsEduCn, true);
  // 域名本身仍然要脱敏。
  assert.equal(report.page.host.includes('example'), false);
});

test('报告里搜不到任何原始值（这是这个脚本唯一真正危险的失败方式）', () => {
  const { window } = bootProbe();
  const probe = window.__sleepinRecon;

  const xhr = new FakeXhr();
  xhr.open('POST', `/jsxsd/xskb/xskb_list.do?xh=${STUDENT_ID}`);
  xhr.send(`xnxq01id=${SEMESTER}`);
  xhr.finish();
  window.kbList = [{ kcmc: COURSE_NAME, xm: STUDENT_NAME, xqj: '1', jcs: '1-2', zcd: '1-16' }];
  probe.scan();

  const text = probe.dump();
  for (const secret of [COURSE_NAME, STUDENT_NAME, STUDENT_ID, SEMESTER]) {
    assert.equal(text.includes(secret), false, `报告里不该出现「${secret}」`);
  }
  // 页面标题里的厂商名要留下来（它不含身份），但标题原文不能留。
  assert.ok(JSON.parse(text).page.titleMarks.includes('正方'));
  assert.equal(text.includes('课表查询'), false);
});

test('规则外的字符不再让报告作废：换成形状标记、只留码位，并明确警告', () => {
  const { window, logs } = bootProbe();
  const probe = window.__sleepinRecon;

  // 西里尔字母不在骨架化规则里。
  const xhr = new FakeXhr();
  xhr.open('POST', '/x.do');
  xhr.send('');
  xhr.status = 200;
  xhr.responseText = JSON.stringify({ name: 'Кафедра' });
  xhr.listeners.forEach((handler) => handler());

  logs.length = 0;
  const text = probe.dump();
  const report = JSON.parse(text);

  // 报告出得来，但原文一个字节都不在里面。
  assert.equal(report.requests[0].json.name, 'aaaaaaa');
  for (const ch of ['К', 'ф', 'д']) assert.equal(text.includes(ch), false);
  // 定位靠码位：同码位只记一次。
  assert.equal(report.redaction.selfCheckPassed, false);
  assert.deepEqual(
    report.redaction.unresolved.map((item) => item.codePoint),
    ['U+041A', 'U+0430', 'U+0444', 'U+0435', 'U+0434', 'U+0440']
  );
  // 但必须明确警告用户。
  assert.ok(logs.some((line) => line.includes('警告')), '应该给出警告');
  assert.ok(logs.some((line) => line.includes('U+041A')), '警告里要带码位');
});

test('抓取阶段（请求体）的规则外字符同样只留码位，报告照常产出', () => {
  const { window, logs } = bootProbe();
  const probe = window.__sleepinRecon;

  const xhr = new FakeXhr();
  xhr.open('POST', '/x.do');
  // 表单值里出现无法骨架化的字符：失败发生在事件回调里，以前只能作废整份报告。
  xhr.send('name=Кафедра');
  xhr.status = 200;
  xhr.responseText = JSON.stringify({ ok: true });
  xhr.listeners.forEach((handler) => handler());

  logs.length = 0;
  const report = JSON.parse(probe.dump());
  assert.deepEqual(report.requests[0].requestBody.params, ['name=aaaaaaa']);
  assert.equal(report.redaction.selfCheckPassed, false);
  assert.equal(report.redaction.unresolved.some((item) => item.codePoint === 'U+041A'), true);
  assert.ok(logs.some((line) => line.includes('警告')));
});
