import { describe, expect, it } from "vitest";
import { isLoginBlocked, LOGIN_WINDOW_MS, nextLoginFailure } from "./rate-limit";

const now = new Date("2026-09-27T12:00:00.000Z");

describe("owner login limiter", () => {
  it("locks at the fifth failure", () => {
    const fifth = nextLoginFailure({ failures: 4, blockedUntil: null, updatedAt: now }, now);
    expect(fifth.failures).toBe(5);
    expect(fifth.blockedUntil).toEqual(new Date(now.getTime() + LOGIN_WINDOW_MS));
    expect(isLoginBlocked(fifth, new Date(now.getTime() + 1))).toBe(true);
  });

  it("resets on an expired block or elapsed window", () => {
    const old = new Date(now.getTime() - LOGIN_WINDOW_MS);
    expect(nextLoginFailure({ failures: 5, blockedUntil: old, updatedAt: old }, now).failures).toBe(1);
    expect(nextLoginFailure({ failures: 4, blockedUntil: null, updatedAt: old }, now).failures).toBe(1);
    expect(isLoginBlocked({ failures: 5, blockedUntil: now, updatedAt: old }, now)).toBe(false);
  });

  it("starts with one failure and never blocks before five", () => {
    const first = nextLoginFailure(undefined, now);
    expect(first.failures).toBe(1);
    expect(first.blockedUntil).toBeNull();
  });
});
