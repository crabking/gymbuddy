import { describe, expect, it } from "vitest";
import { prepareChatImage } from "@/lib/image-upload";

describe("chat image preparation", () => {
  it("rejects non-image attachments before decoding", async () => {
    const file = { type: "text/plain", size: 10 } as File;
    await expect(prepareChatImage(file)).rejects.toThrow("Choose an image file");
  });

  it("rejects oversized images before allocating a canvas", async () => {
    const file = { type: "image/jpeg", size: 26 * 1024 * 1024 } as File;
    await expect(prepareChatImage(file)).rejects.toThrow("under 25 MB");
  });
});
