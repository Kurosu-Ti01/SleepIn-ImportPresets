// 共享运行流程的单元测试：payload 组装与作息时间校验。
//
// 为什么需要这一组：作息时间写错了不会报错，只会让用户看到错误的上下课时间；而运行流程承诺的
// 「坏条目丢掉但记账」也需要被盯住，否则它会退化成静默丢弃。
//
// 运行：node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerSource = fs.readFileSync(path.join(here, '..', 'lib', 'runner.js'), 'utf8');

const { buildPayload, normalizeTimeSlots } = new Function(
  runnerSource + '\nreturn { buildPayload: buildPayload, normalizeTimeSlots: normalizeTimeSlots };'
)();

const course = { name: '高等数学', sessions: [] };

test('payload 不含 periods 时就不传这个字段', () => {
  const payload = buildPayload([course], '2025 秋', { totalWeeks: 18 }, []);
  assert.equal('periods' in payload, false);
  assert.deepEqual(payload.timetable, { name: '2025 秋', totalWeeks: 18 });
});

test('payload 有 periods 时按原样带上', () => {
  const slots = [{ period: 1, start: '08:00', end: '08:45' }];
  const payload = buildPayload([course], '', null, slots);
  assert.deepEqual(payload.periods, slots);
  // 没有名称、没有元信息时 timetable 整体不传，而不是传空对象。
  assert.equal('timetable' in payload, false);
});

test('timetable 的字段来源：方案优先，学期显示名兜底', () => {
  assert.deepEqual(buildPayload([course], '兜底名', { name: '方案名' }, []).timetable, { name: '方案名' });
  assert.deepEqual(buildPayload([course], '兜底名', null, []).timetable, { name: '兜底名' });
  assert.deepEqual(
    buildPayload([course], '', { totalWeeks: 16, startDate: '2025-09-01' }, []).timetable,
    { totalWeeks: 16, startDate: '2025-09-01' }
  );
});

test('作息时间：补齐前导零并按时段排序', () => {
  const { slots, dropped } = normalizeTimeSlots([
    { period: 2, start: '8:55', end: '9:40' },
    { period: 1, start: '08:00', end: '08:45:00' }
  ]);
  assert.equal(dropped, 0);
  assert.deepEqual(slots, [
    { period: 1, start: '08:00', end: '08:45' },
    { period: 2, start: '08:55', end: '09:40' }
  ]);
});

test('作息时间：不合法的条目被丢掉并计数', () => {
  const { slots, dropped } = normalizeTimeSlots([
    { period: 1, start: '08:00', end: '08:45' },
    { period: 0, start: '08:00', end: '08:45' },          // 节次号越界
    { period: 99, start: '08:00', end: '08:45' },         // 超过上限
    { period: 3, start: '09:00', end: '08:45' },          // 结束早于开始
    { period: 4, start: '早上八点', end: '08:45' },        // 时刻无法识别
    { period: 5, start: '24:00', end: '24:45' },          // 小时越界
    { period: 6, start: '08:00' },                        // 缺结束时刻
    { start: '08:00', end: '08:45' },                     // 缺节次号
    { period: 1, start: '10:00', end: '10:45' }           // 与前面同节次
  ]);
  assert.deepEqual(slots, [{ period: 1, start: '08:00', end: '08:45' }]);
  assert.equal(dropped, 8);
});

test('作息时间：非数组按「没有提供」处理', () => {
  assert.deepEqual(normalizeTimeSlots(null), { slots: [], dropped: 0 });
  assert.deepEqual(normalizeTimeSlots(undefined), { slots: [], dropped: 0 });
  assert.deepEqual(normalizeTimeSlots({ period: 1 }), { slots: [], dropped: 0 });
});
