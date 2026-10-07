/** Deterministic migration rules shared by the preflight report and tests. */
export function lowestDerivedDay(memberDays) {
  const days = memberDays.filter((day) => Number.isInteger(day) && day > 0);
  return days.length ? Math.min(...days) : null;
}

export function proposedActiveGroupId(groupIds) {
  return groupIds.length === 1 ? groupIds[0] : null;
}
