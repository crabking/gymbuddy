import { afterEach, describe, expect, it } from "vitest";
import { getClientAddress, isUnsafeCrossOriginRequest, readJsonBody } from "@/lib/security.server";

const originalPublicOrigin = process.env.PUBLIC_ORIGIN;
const originalTrustProxy = process.env.TRUST_PROXY_HEADERS;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = originalPublicOrigin;
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY_HEADERS;
  else process.env.TRUST_PROXY_HEADERS = originalTrustProxy;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("request security", () => {
  it("ignores spoofable forwarding headers until the trusted-proxy mode is explicit", () => {
    delete process.env.TRUST_PROXY_HEADERS;
    const request = new Request("https://coach.example.com/api/chat", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(getClientAddress(request)).toBe("untrusted-proxy");

    process.env.TRUST_PROXY_HEADERS = "true";
    expect(getClientAddress(request)).toBe("203.0.113.7");

    const proxied = new Request("https://coach.example.com/api/chat", {
      headers: {
        "x-real-ip": "198.51.100.4",
        "x-forwarded-for": "192.0.2.99, 198.51.100.4",
      },
    });
    expect(getClientAddress(proxied)).toBe("198.51.100.4");

    const forwardedOnly = new Request("https://coach.example.com/api/chat", {
      headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.8" },
    });
    expect(getClientAddress(forwardedOnly)).toBe("198.51.100.8");
  });

  it("checks unsafe requests against the configured canonical origin", () => {
    process.env.PUBLIC_ORIGIN = "https://coach.example.com";
    process.env.NODE_ENV = "production";
    expect(
      isUnsafeCrossOriginRequest(
        new Request("http://internal:3000/api/chat", {
          method: "POST",
          headers: { origin: "https://coach.example.com" },
        }),
      ),
    ).toBe(false);
    expect(
      isUnsafeCrossOriginRequest(
        new Request("http://internal:3000/api/chat", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects a streamed JSON body once its real byte count crosses the cap", async () => {
    const request = new Request("https://coach.example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "too large" }),
    });
    await expect(readJsonBody(request, 8)).rejects.toMatchObject({ status: 413 });
  });
});
