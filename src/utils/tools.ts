// 检查群组是否在允许的群组组合列表中，并返回首个匹配到的群组组合配置或者所有匹配到的群组组合配置
export function isGroupAllowed(groupId: string, allowedGroups: string[], debug: boolean = false): [boolean, Set<string>] {
  const isPrivate = groupId.startsWith("private:");
  const matchedGroups = new Set<string>();

  // 遍历每个allowedGroups元素
  for (const groupConfig of allowedGroups) {
    // 使用Set去重
    const groups = new Set(
      groupConfig.split(",")
        .map(g => g.trim())
        .filter(g => g)  // 移除空字符串
    );

    for (const group of groups) {
      // 检查全局允许
      if (!isPrivate && group === "all") {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
      // 检查全局私聊允许
      if (isPrivate && group === "private:all") {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
      // 精确匹配
      if (groupId === group) {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
    }
  }

  if (debug && matchedGroups.size > 0) {
    return [true, matchedGroups];
  }

  return [false, new Set()];
}
