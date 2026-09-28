/** Assign four palette slots around a closed ring without matching neighbors. */
export function ringColorIndices(count: number): number[] {
  const slots = Array.from({ length: count }, (_, index) => index % 4);
  if (count > 1 && slots[count - 1] === slots[0]) {
    // The last arc also touches the first. Prefer the earliest reusable color
    // that differs from both neighbors instead of repeating the first one.
    const safe = [1, 2, 3].find((slot) => slot !== slots[count - 2]);
    if (safe !== undefined) slots[count - 1] = safe;
  }
  return slots;
}
