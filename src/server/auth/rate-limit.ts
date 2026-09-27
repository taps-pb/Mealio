/** Persistent single-owner login failure bucket; the caller serializes DB updates. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type LoginBucket = { failures: number; blockedUntil: Date | null; updatedAt: Date };

export function isLoginBlocked(bucket: LoginBucket | undefined, now: Date): boolean {
  return !!bucket?.blockedUntil && bucket.blockedUntil > now;
}

export function nextLoginFailure(bucket: LoginBucket | undefined, now: Date): LoginBucket {
  const reset = !bucket || !!bucket.blockedUntil || now.getTime() - bucket.updatedAt.getTime() >= LOGIN_WINDOW_MS;
  const failures = (reset ? 0 : bucket.failures) + 1;
  return {
    failures,
    blockedUntil: failures >= 5 ? new Date(now.getTime() + LOGIN_WINDOW_MS) : null,
    updatedAt: now,
  };
}
