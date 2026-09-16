import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { blobId } from "../shared/blob-id";
it("identifies existing Git blobs including binary data", async () => {
  for (const data of [Buffer.from("hello\n"), Buffer.from([0, 255, 128, 1])]) {
    const expected = createHash("sha1")
      .update(`blob ${data.length}\0`)
      .update(data)
      .digest("hex");
    expect(
      await blobId({
        path: "asset",
        encoding: "base64",
        content: data.toString("base64"),
      }),
    ).toBe(expected);
  }
});
