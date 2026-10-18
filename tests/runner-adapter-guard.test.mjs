// 共享运行流程的单元测试：适配器合并与检查失败时的报错。
//
// 为什么单独测：这里有两种原因完全不同的失败——族适配器本身缺环节，与适配器完好、合并那一步丢了成员。
// 旧实现用 Object.assign 合并，出现过「适配器完好、合并结果却是空对象」，而当时页面上
// Object.assign 单试又是好的；报成同一句「缺少必需的环节」把排查带偏过一次。所以：
//   1. 合并不能依赖 Object.assign（mergeSteps 自己复制可枚举键）；
//   2. 报错要能一眼看出是「适配器缺」还是「合并丢」，并列出三方的键。
//
// 运行：node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerSource = fs.readFileSync(path.join(here, '..', 'lib', 'runner.js'), 'utf8');

const { runImport, mergeSteps } = new Function(
  runnerSource + '\nreturn { runImport: runImport, mergeSteps: mergeSteps };'
)();

const FULL_ADAPTER = {
  detect() {},
  listSemesters() {},
  semesterCode() {},
  semesterLabel() {},
  fetchSchedule() {},
  normalizeRow() {},
  helper() {}
};

/** 装一个假桥，只为了接住 alertDialog 的文案。 */
async function withCapturedAlert(run) {
  const captured = [];
  global.window = {
    sleepinBridge: {},
    sleepinBridgePromise: {
      alert: async (payload) => {
        captured.push(payload);
        return true;
      }
    }
  };
  try {
    await run(captured);
  } finally {
    delete global.window;
  }
}

test('合并适配器与覆盖：语义与 Object.assign 一致，但不依赖它', () => {
  assert.deepEqual(Object.keys(mergeSteps({ a() {}, b: 1 }, { a: 2, c: 3 })), ['a', 'b', 'c']);
  assert.equal(mergeSteps({ a: 1 }, { a: 2 }).a, 2);
  assert.deepEqual(mergeSteps(null, { a: 1 }), { a: 1 });
  assert.deepEqual(mergeSteps({ a: 1 }, null), { a: 1 });

  // 页面把 Object.assign 改坏时，合并照样正确。
  const original = Object.assign;
  Object.assign = function () {
    return {};
  };
  try {
    const merged = mergeSteps(FULL_ADAPTER, { extra: 1 });
    assert.equal(typeof merged.detect, 'function');
    assert.equal(Object.keys(merged).length, 8);
  } finally {
    Object.assign = original;
  }
});

test('页面改坏运行流程依赖的内置方法时：明确报出是哪一个，而不是产出空课表', async () => {
  const originalMap = Array.prototype.map;
  Array.prototype.map = function () { return []; };
  try {
    await withCapturedAlert(async (captured) => {
      await runImport({ adapter: FULL_ADAPTER, overrides: {}, config: {}, presetName: 'x' });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].title, '这个页面的运行环境不对');
      assert.match(captured[0].message, /Array\.prototype\.map/);
    });
  } finally {
    Array.prototype.map = originalMap;
  }
});

test('页面的 Array.prototype.filter / every 被改坏时，环节齐全不会被误判成全缺', async () => {
  const originalFilter = Array.prototype.filter;
  const originalEvery = Array.prototype.every;
  // 旧补丁库常见的那种「无视回调、原样返回」/「永远为真」的实现。
  Array.prototype.filter = function () { return Array.prototype.slice.call(this); };
  Array.prototype.every = function () { return true; };
  try {
    await withCapturedAlert(async (captured) => {
      await runImport({ adapter: FULL_ADAPTER, overrides: {}, config: {}, presetName: 'x' });
      // 环节齐全 ⇒ 不应该弹「方案不可用」，而应该继续走到 detect（本例的 detect 故意不返回 true）。
      assert.equal(captured.length, 1);
      assert.notEqual(captured[0].title, '方案不可用');
      assert.equal(captured[0].title, '认不出这个教务系统');
    });
  } finally {
    Array.prototype.filter = originalFilter;
    Array.prototype.every = originalEvery;
  }
});

test('运行流程与族适配器不得依赖页面可以改写的数组方法（filter / find / reduce / every / some）', () => {
  const targets = [path.join(here, '..', 'lib', 'runner.js')];
  const familiesDir = path.join(here, '..', 'families');
  fs.readdirSync(familiesDir).forEach((name) => {
    const adapter = path.join(familiesDir, name, 'adapter.js');
    if (fs.existsSync(adapter)) targets.push(adapter);
  });

  // 为什么禁这几个：运行流程跑在教务系统页面的 JS 环境里，而页面会改内建方法
  //（页面上 filter 可能被改成永远返回空、every 永远返回真），改坏之后这些调用会静默给错结果。
  const forbidden = /\.(filter|find|reduce|every|some)\s*\(/;
  targets.forEach((file) => {
    const offenders = [];
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (forbidden.test(line)) offenders.push((index + 1) + ': ' + line.trim());
    });
    assert.deepEqual(offenders, [], file.replace(here, '') + ' 里还在依赖这些方法：\n' + offenders.join('\n'));
  });
});

test('适配器本身缺环节：报出缺了哪些，并列出它当前的键', async () => {
  await withCapturedAlert(async (captured) => {
    await runImport({ adapter: { detect() {} }, overrides: {}, config: {}, presetName: 'x' });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].title, '方案不可用');
    assert.match(captured[0].message, /适配器缺少必需的环节：listSemesters/);
    assert.match(captured[0].message, /当前适配器对象（object）的键：detect/);
  });
});

test('适配器完好、合并之后却没了：报出来的是这一条，并列出三方的键', async () => {
  const blank = {
    detect: null,
    listSemesters: null,
    semesterCode: null,
    semesterLabel: null,
    fetchSchedule: null,
    normalizeRow: null
  };
  await withCapturedAlert(async (captured) => {
    await runImport({ adapter: FULL_ADAPTER, overrides: blank, config: {}, presetName: 'x' });
    assert.equal(captured.length, 1);
    assert.match(captured[0].message, /适配器本身有全部 6 个环节，合并之后却没了/);
    assert.match(captured[0].message, /合并结果 steps 的键：\[detect、listSemesters/);
    assert.match(captured[0].message, /具名覆盖 overrides 的键：\[detect/);
    assert.match(captured[0].message, /适配器的键：\[detect、listSemesters/);
  });
});
