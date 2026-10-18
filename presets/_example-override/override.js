// SleepIn 导入脚本 · 该校的具名覆盖（形态 B）
//
// 只写「族适配器装不下」的那一个环节，其余环节继续用 families/<familyId>/adapter.js 的实现。
// 生成器会把它接在适配器之后：这里重新定义的成员覆盖适配器的同名成员。
//
// 覆盖前请先问一句：这一处差异能不能用 config 的取值表达？能的话就改 preset.json 的 config，
// 不要写代码——取值能被下一所学校复用，代码不能。

const presetOverrides = {
  /**
   * 覆盖原因：该部署的课表接口把两门课拼在一行里（字段用 / 分隔），
   * 适配器默认的「一行一门课」装不下，所以在这里拆成两门。
   *
   * 拆行之后仍然复用运行流程的周次解析、越界判定与分组逻辑：只把字段取出来，不做别的。
   */
  normalizeRow(row, ctx) {
    const weeks = ctx.parseWeeks(ctx.pick(row, 'weeks'));
    if (!weeks.length) return { skip: '周次为空或无法解析' };

    // 该部署把课程名与教师按同一顺序用 / 拼接；数量不一致时按「多的那个」为准。
    const names = String(ctx.pick(row, 'name') || '').split('/').map((part) => part.trim());
    const teachers = String(ctx.pick(row, 'teacher') || '').split('/').map((part) => part.trim());
    if (names.length < 2) return null;

    // 一条原始行要产出多条课时时，返回数组是允许的：运行流程会逐条处理。
    return names.map((name, index) => ({
      name: name,
      teacher: teachers[index] || teachers[0] || null,
      day: Number(ctx.pick(row, 'day')),
      from: Number(ctx.pick(row, 'from')),
      to: Number(ctx.pick(row, 'to')),
      location: ctx.pick(row, 'location') || null,
      weeks: weeks,
      groupKey: this.groupKeyOf(row, ctx) + '#' + name
    }));
  }
};
