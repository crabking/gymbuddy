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
});
