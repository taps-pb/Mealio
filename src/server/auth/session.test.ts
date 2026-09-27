import { describe, expect, it } from "vitest";
import { isSessionCurrent } from "./session";

const now = new Date("2026-01-15T12:00:00.000Z");
const active = { sessionVersion: 1, expiresAt: new Date("2026-01-16T12:00:00.000Z") };

describe("isSessionCurrent", () => {
  it("accepts an unexpired matching version", () => {
    expect(isSessionCurrent(active, { sessionVersion: 1 }, now)).toBe(true);
  });
  it("rejects an expired or boundary-equal session", () => {
    expect(isSessionCurrent({ ...active, expiresAt: now }, { sessionVersion: 1 }, now)).toBe(false);
    expect(isSessionCurrent({ ...active, expiresAt: new Date(now.getTime() - 1) }, { sessionVersion: 1 }, now)).toBe(false);
  });
  it("rejects sessions after the admin version changes", () => {
    expect(isSessionCurrent(active, { sessionVersion: 2 }, now)).toBe(false);
  });
});
