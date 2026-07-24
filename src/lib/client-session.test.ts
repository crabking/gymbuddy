import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clearAccountCache, isUnauthorizedError } from "@/lib/client-session";

describe("client session errors", () => {
  it("recognizes common unauthorized response shapes", () => {
    expect(isUnauthorizedError(new Response(null, { status: 401 }))).toBe(true);
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
    expect(isUnauthorizedError({ statusCode: 401 })).toBe(true);
    expect(isUnauthorizedError(new Error("Request failed with status 401"))).toBe(true);
    expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(true);
  });

  it("does not redirect for unrelated failures", () => {
    expect(isUnauthorizedError(new Response(null, { status: 500 }))).toBe(false);
    expect(isUnauthorizedError(new Error("Network unavailable"))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });

  it("removes every account-scoped query before another login", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["profile"], { display_name: "First account" });
    queryClient.setQueryData(["dashboard"], { sessions: 12 });

    await clearAccountCache(queryClient);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
