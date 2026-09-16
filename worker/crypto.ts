import { base64 } from "../shared/validation";
async function key(material: string) {
  let b: Uint8Array<ArrayBuffer>;
  try {
    b = Uint8Array.from(atob(material), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Encryption key is not valid base64");
  }
  if (b.length !== 32)
    throw new Error("Encryption key must contain exactly 32 bytes");
  return crypto.subtle.importKey("raw", b, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encrypt(
  value: string,
  material: string,
  context: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await key(material),
    new TextEncoder().encode(value),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(data))}`;
}
export async function decrypt(
  value: string,
  material: string,
  context: string,
) {
  const [version, i, c] = value.split(".");
  if (version !== "v1" || !i || !c)
    throw new Error("Invalid encrypted envelope");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(atob(i), (x) => x.charCodeAt(0)),
        additionalData: new TextEncoder().encode(context),
      },
      await key(material),
      Uint8Array.from(atob(c), (x) => x.charCodeAt(0)),
    ),
  );
}
export async function hash(s: string) {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
