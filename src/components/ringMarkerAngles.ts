const FULL_TURN = Math.PI * 2;

/** Keep marker order while spacing their 44px tap targets around a closed ring. */
export function spreadRingMarkerAngles(desired: number[], radius: number): number[] {
  const count = desired.length;
  if (count < 2 || !Number.isFinite(radius) || radius <= 0) return [...desired];

  // The chord between 44px targets needs 48px for a small visible gap.
  // If there are too many markers to fit, distribute them as evenly as possible.
  const minimum = Math.min(2 * Math.asin(Math.min(1, 24 / radius)), FULL_TURN / count);
  const gaps = desired.map((angle, index) =>
    (desired[(index + 1) % count] + (index === count - 1 ? FULL_TURN : 0)) - angle,
  );
  const deficit = gaps.reduce((sum, gap) => sum + Math.max(0, minimum - gap), 0);
  if (deficit < 1e-9) return [...desired];

  // Shrink only the gaps with spare room, rather than distorting every slice.
  const spare = gaps.reduce((sum, gap) => sum + Math.max(0, gap - minimum), 0);
  const adjusted = gaps.map((gap) => minimum + Math.max(0, gap - minimum) * (1 - deficit / spare));
  const shifts = [0];
  for (let index = 1; index < count; index++) {
    shifts.push(shifts[index - 1] + adjusted[index - 1] - gaps[index - 1]);
  }
  // Center the displaced group around its original location.
  const center = shifts.reduce((sum, shift) => sum + shift, 0) / count;
  return desired.map((angle, index) => angle + shifts[index] - center);
}
