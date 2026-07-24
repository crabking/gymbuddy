import { describe, expect, it } from "vitest";
import { bufferBoundedMutationBody } from "@/server";

describe("server request body cap", () => {
  it("preserves a bounded mutation body for the application handler", async () => {
    const request = new Request("https://coach.test/action", {
      method: "POST",
      body: "safe",
    });
    const result = await bufferBoundedMutationBody(request, 4);
    expect(result).toBeInstanceOf(Request);
    expect(await (result as Request).text()).toBe("safe");
  });

  it("rejects a chunked body as soon as it crosses the cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123"));
        controller.enqueue(new TextEncoder().encode("456"));
        controller.close();
      },
    });
    const request = new Request("https://coach.test/action", {
      method: "POST",
      body: stream,
      // Required by Node for streamed request bodies.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const result = await bufferBoundedMutationBody(request, 5);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("reconstructs a request-like object without relying on same-realm Request internals", async () => {
    const original = new Request("https://coach.test/action?source=phone", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "session=opaque",
      },
      body: '{"safe":true}',
    });
    const foreignRequest = {
      method: original.method,
      url: original.url,
      headers: original.headers,
      body: original.body,
    } as Request;

    const result = await bufferBoundedMutationBody(foreignRequest, 64);

    expect(result).toBeInstanceOf(Request);
    expect((result as Request).url).toBe("https://coach.test/action?source=phone");
    expect((result as Request).headers.get("cookie")).toBe("session=opaque");
    expect(await (result as Request).text()).toBe('{"safe":true}');
  });
});
