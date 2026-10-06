/** Presentation only. Draft instants and account-timezone grouping are unchanged. */
export function mealEntryTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "Choose date & time";
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const day = sameDay(date, now) ? "Today" : sameDay(date, yesterday) ? "Yesterday" : date.toLocaleDateString(undefined, {
    day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day} · ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
