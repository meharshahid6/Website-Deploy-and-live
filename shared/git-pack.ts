import { zlibSync } from "fflate";
import { bytes } from "./validation";
import type { SourceFile } from "./model";
const enc = new TextEncoder();
export function concat(...a: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let n = 0;
  for (const x of a) {
    b.set(x, n);
    n += x.length;
  }
  return b;
}
const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) =>
  Uint8Array.from(s.match(/../g)!, (x) => parseInt(x, 16));
async function sha(b: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", b));
}
export function pkt(s: string) {
  const b = enc.encode(s);
  return concat(enc.encode((b.length + 4).toString(16).padStart(4, "0")), b);
}
// Git pack v2, undeltified objects, zlib level 0. Used only to initialize an empty repo.
export async function initialPack(
  files: SourceFile[],
  message: string,
  branch: string,
  identity: string,
) {
  const objects: { type: number; data: Uint8Array<ArrayBuffer> }[] = [];
  async function object(
    type: number,
    name: string,
    data: Uint8Array<ArrayBuffer>,
  ) {
    const id = hex(
      await sha(concat(enc.encode(`${name} ${data.length}\0`), data)),
    );
    objects.push({ type, data });
    return id;
  }
  type Tree = { files: Map<string, string>; dirs: Map<string, Tree> };
  const root: Tree = { files: new Map(), dirs: new Map() };
  for (const f of files) {
    const id = await object(3, "blob", bytes(f));
    const parts = f.path.split("/");
    let t = root;
    for (const part of parts.slice(0, -1)) {
      if (!t.dirs.has(part))
        t.dirs.set(part, { files: new Map(), dirs: new Map() });
      t = t.dirs.get(part)!;
    }
    t.files.set(parts.at(-1)!, id);
  }
  async function tree(t: Tree): Promise<string> {
    const entries: { sort: string; data: Uint8Array }[] = [];
    for (const [n, id] of t.files)
      entries.push({
        sort: n,
        data: concat(enc.encode(`100644 ${n}\0`), unhex(id)),
      });
    for (const [n, d] of t.dirs)
      entries.push({
        sort: n + "/",
        data: concat(enc.encode(`40000 ${n}\0`), unhex(await tree(d))),
      });
    entries.sort((a, b) => {
      const x = enc.encode(a.sort),
        y = enc.encode(b.sort);
      for (let i = 0; i < Math.min(x.length, y.length); i++)
        if (x[i] !== y[i]) return x[i] - y[i];
      return x.length - y.length;
    });
    return object(2, "tree", concat(...entries.map((x) => x.data)));
  }
  const t = await tree(root),
    who = `${identity} <${identity}@users.noreply.github.com> ${Math.floor(Date.now() / 1000)} +0000`;
  const commit = await object(
    1,
    "commit",
    enc.encode(`tree ${t}\nauthor ${who}\ncommitter ${who}\n\n${message}\n`),
  );
  const head = new Uint8Array(12);
  head.set(enc.encode("PACK"));
  const v = new DataView(head.buffer);
  v.setUint32(4, 2);
  v.setUint32(8, objects.length);
  const parts = [head];
  for (const o of objects) {
    let n = o.data.length;
    let b = (o.type << 4) | (n & 15);
    n >>>= 4;
    const h = [];
    while (n) {
      h.push(b | 128);
      b = n & 127;
      n >>>= 7;
    }
    h.push(b);
    parts.push(concat(new Uint8Array(h), zlibSync(o.data, { level: 0 })));
  }
  const pack = concat(...parts);
  return {
    sha: commit,
    body: concat(
      pkt(`${"0".repeat(40)} ${commit} refs/heads/${branch}\0report-status\n`),
      enc.encode("0000"),
      pack,
      await sha(pack),
    ),
  };
}
