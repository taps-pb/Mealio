import { describe, expect, it } from "vitest";
import { generateSessionToken, hashPassword, hashToken, sessionExpiry, verifyPassword } from "./crypto";

describe("password hashing", () => {
  it("roundtrips with Argon2id", async () => {
    const hash = await hashPassword("example test-only passphrase");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword("example test-only passphrase", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("rejects empty input and malformed stored hashes", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(verifyPassword("", "hash")).resolves.toBe(false);
    await expect(verifyPassword("example", "invalid")).resolves.toBe(false);
  });
});

describe("session tokens", () => {
  it("generates distinct opaque tokens and stores only stable digests", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    expect(first).not.toBe(second);
    expect(first).toHaveLength(43);
    expect(hashToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(first)).toBe(hashToken(first));
    expect(hashToken(first)).not.toBe(hashToken(second));
  });

  it("expires after 30 days", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
