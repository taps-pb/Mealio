import { describe, expect, it } from "vitest";
import { acceptsSameOriginMutation } from "./request-origin";

const accepted = (url: string, origin?: string, fetchSite?: string) => acceptsSameOriginMutation(
  new Request(url, { method: "POST", headers: {
    ...(origin === undefined ? {} : { Origin: origin }),
    ...(fetchSite === undefined ? {} : { "Sec-Fetch-Site": fetchSite }),
  } }),
);

describe("same-origin mutation guard", () => {
  it("accepts the exact host, scheme and port", () => {
    expect(accepted("http://localhost:3000/api/meals", "http://localhost:3000", "same-origin")).toBe(true);
    expect(accepted("https://meal.example/api/meals", "https://meal.example")).toBe(true);
  });
  it("rejects missing, null, malformed, multi-value and cross-origin headers", () => {
    for (const origin of [undefined, "null", "broken", "https://other.example", "http://meal.example", "https://meal.example:8443", "https://meal.example, https://evil.example", "https://meal.example/path"]) {
      expect(accepted("https://meal.example/api/meals", origin)).toBe(false);
    }
    expect(accepted("https://meal.example/api/meals", "https://meal.example", "same-site")).toBe(false);
    expect(accepted("https://meal.example/api/meals", "https://meal.example", "cross-site")).toBe(false);
  });
});
