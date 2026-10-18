// 共享运行流程的单元测试：周次解析。
//
// 为什么必须有这一组：单双周标记被丢掉时**不会报错**，只会把单周课变成每周都上——这类错误
// 只能靠测试挡住。测试直接加载 lib/runner.js 本体（而不是副本），所以改坏共享代码会立刻失败。
//
// 运行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerSource = fs.readFileSync(path.join(here, '..', 'lib', 'runner.js'), 'utf8');

// runner.js 是「被拼进自包含脚本」的语句集合，没有顶层副作用，因此可以直接求值取内部函数。
const { parseWeeksByEncoding } = new Function(
  runnerSource + '\nreturn { parseWeeksByEncoding: parseWeeksByEncoding };'
)();

test('空值返回空数组（由适配器给出跳过原因）', () => {
  assert.deepEqual(parseWeeksByEncoding('', 'auto'), []);
  assert.deepEqual(parseWeeksByEncoding(null, 'auto'), []);
  assert.deepEqual(parseWeeksByEncoding(undefined, 'auto'), []);
  assert.deepEqual(parseWeeksByEncoding('   ', 'text'), []);
});

test('位图：第 i 位 = 第 i+1 周', () => {
  assert.deepEqual(parseWeeksByEncoding('111100000000000000', 'auto'), [1, 2, 3, 4]);
  assert.deepEqual(parseWeeksByEncoding('100000000000000001', 'bitmap'), [1, 18]);
});

test('位图全为 0 时返回空数组', () => {
  assert.deepEqual(parseWeeksByEncoding('00000000', 'auto'), []);
});

test('文本：区间与列表', () => {
  assert.deepEqual(parseWeeksByEncoding('1-4周', 'text'), [1, 2, 3, 4]);
  assert.deepEqual(parseWeeksByEncoding('1,3,5周', 'text'), [1, 3, 5]);
  assert.deepEqual(parseWeeksByEncoding('1，3、5周', 'text'), [1, 3, 5]);
  assert.deepEqual(parseWeeksByEncoding('1~4周', 'text'), [1, 2, 3, 4]);
  assert.deepEqual(parseWeeksByEncoding('1-4周,10周', 'text'), [1, 2, 3, 4, 10]);
});

test('单周：(单) / 单周 / 裸单 都要生效', () => {
  assert.deepEqual(parseWeeksByEncoding('1-8周(单)', 'text'), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeksByEncoding('1-8周（单）', 'text'), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeksByEncoding('1-8周单', 'text'), [1, 3, 5, 7]);
  // 只有「单周」两个字、没有任何周次数字：无法解析，应该报错而不是静默当成空。
  assert.throws(() => parseWeeksByEncoding('单周', 'auto'), /无法解析/);
});

test('双周：(双) / 裸双 都要生效', () => {
  assert.deepEqual(parseWeeksByEncoding('2-16周(双)', 'text'), [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual(parseWeeksByEncoding('1-8周（双）', 'text'), [2, 4, 6, 8]);
  assert.deepEqual(parseWeeksByEncoding('1-8周双', 'text'), [2, 4, 6, 8]);
});

test('单双周标记只作用于自己那一段', () => {
  // 第二段是 (双)，所以 9~16 里只留偶数：9 本身要被排除。
  assert.deepEqual(
    parseWeeksByEncoding('1-8周(单),9-16周(双)', 'text'),
    [1, 3, 5, 7, 10, 12, 14, 16]
  );
});

test('「改」（调课周）按普通周次处理', () => {
  assert.deepEqual(parseWeeksByEncoding('1-8周,3周改', 'text'), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('节次被当成周次时抛错', () => {
  assert.throws(() => parseWeeksByEncoding('第1-2节', 'auto'), /节次/);
  assert.throws(() => parseWeeksByEncoding('1-2节', 'text'), /节次/);
});

test('时刻被当成周次时抛错', () => {
  assert.throws(() => parseWeeksByEncoding('08:00-08:45', 'auto'), /时刻/);
});

test('无法解析时抛错，而不是返回空数组', () => {
  assert.throws(() => parseWeeksByEncoding('待定', 'text'), /无法解析/);
  assert.throws(() => parseWeeksByEncoding('待定', 'auto'), /无法解析/);
});

test('越界周次抛错', () => {
  assert.throws(() => parseWeeksByEncoding('1-99周', 'text'), /过大/);
  assert.throws(() => parseWeeksByEncoding('0-16周', 'text'), /超出/);
});

test('区间反向抛错', () => {
  assert.throws(() => parseWeeksByEncoding('16-1周', 'text'), /不合法/);
});

test('声明为 bitmap 但内容不是位图时抛错（不能静默按位图展开）', () => {
  assert.throws(() => parseWeeksByEncoding('1-8周', 'bitmap'), /不是位图格式/);
  assert.throws(() => parseWeeksByEncoding('3周改', 'bitmap'), /不是位图格式/);
});

test('auto 会把长 0/1 串判为位图、其余判为文本', () => {
  assert.deepEqual(parseWeeksByEncoding('101010101010101010', 'auto'), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepEqual(parseWeeksByEncoding('1-4周(双)', 'auto'), [2, 4]);
});
