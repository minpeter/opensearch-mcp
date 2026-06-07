import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createParallelMcpRequestInit,
  fetchParallelMcp,
} from "../parallel-mcp.ts";

const ORIGINAL_PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;

describe("Parallel MCP transport options", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINAL_PARALLEL_API_KEY === undefined) {
      delete process.env.PARALLEL_API_KEY;
      return;
    }

    process.env.PARALLEL_API_KEY = ORIGINAL_PARALLEL_API_KEY;
  });

  it("keeps redirects manual when attaching optional auth headers", () => {
    process.env.PARALLEL_API_KEY = "parallel-key";

    const init = createParallelMcpRequestInit();

    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({
      Authorization: "Bearer parallel-key",
    });
  });

  it("forces manual redirects for SDK fetch calls that omit requestInit", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 405 }));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchParallelMcp("https://search.parallel.ai/mcp", {
      headers: { Authorization: "Bearer parallel-key" },
      method: "GET",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://search.parallel.ai/mcp",
      expect.objectContaining({
        headers: { Authorization: "Bearer parallel-key" },
        method: "GET",
        redirect: "manual",
      })
    );
  });
});
