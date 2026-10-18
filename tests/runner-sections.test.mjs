// 共享运行流程的单元测试：节次文本解析。
//
// 为什么单独测：`jcs` 这类字段各族写法不同，而把 `1,3`（不连续）误读成 1-3 会把没上的课画进课表——
// 又是一个不报错但结果错的失败方式。
//
// 运行：node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerSource = fs.readFileSync(path.join(here, '..', 'lib', 'runner.js'), 'utf8');

const { parseSectionsFromText } = new Function(
  runnerSource + '\nreturn { parseSectionsFromText: parseSectionsFromText };'
)();

test('连续区间：各种写法都要认', () => {
  const expected = { from: 1, to: 2 };
  assert.deepEqual(parseSectionsFromText('1-2'), expected);
  assert.deepEqual(parseSectionsFromText('1-2节'), expected);
  assert.deepEqual(parseSectionsFromText('第1-2节'), expected);
  assert.deepEqual(parseSectionsFromText('[1-2节]'), expected);
  assert.deepEqual(parseSectionsFromText('1~2'), expected);
  assert.deepEqual(parseSectionsFromText('1至2'), expected);
  assert.deepEqual(parseSectionsFromText(' 01 - 02 '), expected);
});

test('单独一节：from 与 to 相同', () => {
  assert.deepEqual(parseSectionsFromText('3'), { from: 3, to: 3 });
  assert.deepEqual(parseSectionsFromText('第3节'), { from: 3, to: 3 });
});

test('行头里同时写着节次与时刻时，时刻不算节次', () => {
  assert.deepEqual(parseSectionsFromText('第1-2节 08:00-09:40'), { from: 1, to: 2 });
  assert.deepEqual(parseSectionsFromText('第 3 节 10:00~10:45'), { from: 3, to: 3 });
  assert.deepEqual(parseSectionsFromText('1-2节（08:00-09:40）'), { from: 1, to: 2 });
});

test('非连续节次返回 null（不能折叠成区间）', () => {
  assert.equal(parseSectionsFromText('1,3'), null);
  assert.equal(parseSectionsFromText('1、3节'), null);
  assert.equal(parseSectionsFromText('1-2,4-5'), null);
});

test('越界与非法值返回 null', () => {
  assert.equal(parseSectionsFromText('0'), null);
  assert.equal(parseSectionsFromText('3-1'), null);
  assert.equal(parseSectionsFromText('1-99'), null);
  assert.equal(parseSectionsFromText('99'), null);
  assert.equal(parseSectionsFromText('第节'), null);
});

test('空值返回 null', () => {
  assert.equal(parseSectionsFromText(''), null);
  assert.equal(parseSectionsFromText(null), null);
  assert.equal(parseSectionsFromText(undefined), null);
});
