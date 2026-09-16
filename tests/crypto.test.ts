import { it, expect } from "vitest";
import { encrypt, decrypt } from "../worker/crypto";
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
it("round-trips tokens and uses independent IVs", async () => {
  const a = await encrypt("secret-token", key, "github"),
    b = await encrypt("secret-token", key, "github");
  expect(a).not.toEqual(b);
  expect(a).not.toContain("secret-token");
  expect(await decrypt(a, key, "github")).toBe("secret-token");
});
it("authenticates ciphertext, context and key", async () => {
  const a = await encrypt("token", key, "github");
  await expect(decrypt(a, key, "cloudflare")).rejects.toThrow();
  await expect(decrypt(a, btoa("z".repeat(32)), "github")).rejects.toThrow();
  const p = a.split(".");
  p[2] = btoa("z".repeat(32));
  await expect(decrypt(p.join("."), key, "github")).rejects.toThrow();
});
it.each([0, 16, 24, 31, 33, 64])(
  "rejects %i-byte keys",
  async (n) =>
    await expect(encrypt("x", btoa("a".repeat(n)), "x")).rejects.toThrow(
      "32 bytes",
    ),
);
it("rejects malformed key and envelope", async () => {
  await expect(encrypt("x", "!!!", "x")).rejects.toThrow();
  await expect(decrypt("v2.abc.def", key, "x")).rejects.toThrow();
});
