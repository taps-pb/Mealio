/** Step a server-provided owner-local calendar key without using device-local time. */
export function stepDayKey(day: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(days)) return day;
  const date = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return day;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dayTitle(day: string, today: string): string {
  if (day === today) return "Today";
  return day === stepDayKey(today, -1) ? "Yesterday" : "Selected day";
}

export function groupForDay<T extends { day: string }>(groups: T[], day: string): T | undefined {
  return groups.find((group) => group.day === day);
}
