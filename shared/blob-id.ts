import { bytes } from "./validation";
import type { SourceFile } from "./model";

export async function blobId(file: SourceFile) {
  const content = bytes(file),
    header = new TextEncoder().encode(`blob ${content.length}\0`);
  const object = new Uint8Array(header.length + content.length);
  object.set(header);
  object.set(content, header.length);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", object)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
