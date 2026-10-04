import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllGlobals());
it("retires the old estimation endpoint without reading food text, auth, or remote services", async () => {
  const network = vi.fn(() => { throw new Error("Networking disabled"); });
  vi.stubGlobal("fetch", network);
  const response = POST();
  expect(response.status).toBe(410);
  expect((await response.json()).error).toContain("offline estimator");
  expect(network).not.toHaveBeenCalled();
});
