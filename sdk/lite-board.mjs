// lite-board SDK: build lite-board boards, share links and .liteboard files without a browser.
// Zero dependencies. Works in Node 18+ and modern browsers. Format: ../API.md, ../README.md.

export const APP_URL = "https://sanghyun-io.github.io/lite-board/";
export const TYPES = ["rect", "ellipse", "draw", "arrow", "line", "text", "note"];
export const COLORS = ["black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red"];
export const FILLS = ["none", "semi", "solid"];
export const DASHES = ["solid", "draw", "dashed", "dotted"];
export const SIZES = ["s", "m", "l", "xl"];
const ENUM = { color: COLORS, fill: FILLS, dash: DASHES, size: SIZES };
/** Links longer than this may be cut off by some messengers. */
export const LONG_LINK = 32 * 1024;

export class LiteBoardError extends Error {
  constructor(msg) { super("liteBoard: " + msg); this.name = "LiteBoardError"; }
}
const fail = (m) => { throw new LiteBoardError(m); };
const num = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ---------- validation (same rules as window.liteBoard in the app) ---------- */
function checkStyle(st, w) {
  if (st == null) return;
  if (!isObj(st)) fail(w + " must be an object");
  for (const k in st) {
    if (!own(ENUM, k)) fail(`${w}.${k} is not a style key (use color, fill, dash, size)`);
    if (!ENUM[k].includes(st[k])) fail(`${w}.${k} must be one of ${ENUM[k].join(", ")}`);
  }
}
/** Throws LiteBoardError if `s` is not a valid shape. */
export function checkShape(s, w = "shape", allowEmptyText = false) {
  if (!isObj(s)) fail(w + " must be an object");
  if (!TYPES.includes(s.type)) fail(`${w}.type must be one of ${TYPES.join(", ")}`);
  const pt = (v, k) => { if (!v || !num(v.x) || !num(v.y)) fail(`${w}.${k} must be {x: number, y: number}`); };
  if (s.type === "draw") {
    if (!Array.isArray(s.points) || !s.points.length) fail(w + ".points must be a non-empty array of [x, y]");
    s.points.forEach((q, i) => { if (!(Array.isArray(q) ? num(q[0]) && num(q[1]) : q && num(q.x) && num(q.y))) fail(`${w}.points[${i}] must be [x, y]`); });
  } else if (s.type === "arrow" || s.type === "line") { pt(s.start, "start"); pt(s.end, "end"); }
  else {
    for (const k of ["x", "y"]) if (!num(s[k])) fail(`${w}.${k} must be a number`);
    for (const k of ["w", "h"]) if (s[k] != null && !(num(s[k]) && s[k] > 0)) fail(`${w}.${k} must be a positive number`);
  }
  if (s.text != null && typeof s.text !== "string") fail(w + ".text must be a string");
  if (s.type === "text" && !allowEmptyText && !String(s.text || "").trim()) fail(w + ".text must not be empty for a text shape");
  checkStyle(s.style, w + ".style");
}

/* copy only the fields lite-board uses, so the output is clean and small */
function cleanShape(s) {
  const o = { type: s.type };
  if (typeof s.id === "string" && s.id) o.id = s.id;
  if (s.type === "draw") o.points = s.points.map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.y]));
  else if (s.type === "arrow" || s.type === "line") { o.start = { x: s.start.x, y: s.start.y }; o.end = { x: s.end.x, y: s.end.y }; }
  else { o.x = s.x; o.y = s.y; if (s.w != null) o.w = s.w; if (s.h != null) o.h = s.h; }
  if (s.text) o.text = s.text;
  if (s.wrap) o.wrap = true; // truthy, same as the app
  if (s.poly && s.type === "draw") o.poly = true;
  if (s.style && Object.keys(s.style).length) o.style = { ...s.style };
  return o;
}

/**
 * Build a validated lite-board v2 document.
 * Accepts any of:
 *   - an array of shapes (one page)
 *   - { shapes, name? } (one page)
 *   - { pages: [{ name?, shapes }], current? } (current = page index, default 0)
 *   - an existing .liteboard v1 / v2 document
 * Throws LiteBoardError on invalid input.
 */
export function makeDoc(input) {
  // New boards ({shapes} / {pages} / array) get strict rules, like liteBoard.addShapes.
  // Existing documents (app: "lite-board", e.g. from a file or link) get the app's own loadDoc rules,
  // so everything the app can open, the SDK can read too.
  let pages, current = 0;
  const isDoc = isObj(input) && input.app != null;
  if (Array.isArray(input)) pages = [{ shapes: input }];
  else if (!isObj(input)) fail("expected an array of shapes, {shapes}, {pages} or a lite-board document");
  else if (isDoc && input.app !== "lite-board") fail('not a lite-board document (expected app: "lite-board")');
  else if (isDoc && input.version === 1) { if (!Array.isArray(input.shapes)) fail("shapes must be an array"); pages = [{ name: "Page 1", shapes: input.shapes }]; }
  else if (isDoc && input.version !== 2) fail(`unsupported version: ${input.version} (expected 1 or 2)`);
  else if (input.pages != null || isDoc) {
    pages = input.pages;
    if (!Array.isArray(pages) || !pages.length) fail("pages must be a non-empty array");
    const c = input.current;
    if (typeof c === "string") current = Math.max(0, pages.findIndex((p) => p && p.id === c));
    else if (c != null) {
      if (Number.isInteger(c) && c >= 0 && c < pages.length) current = c;
      else if (!isDoc) fail(`current must be a page index from 0 to ${pages.length - 1}`); // documents fall back to page 0 like the app
    }
  } else if (input.shapes != null) pages = [{ name: input.name, shapes: input.shapes }];
  else fail("expected an array of shapes, {shapes}, {pages} or a lite-board document");

  const single = !Array.isArray(input.pages); // error paths follow what the caller passed: "shapes[2].x" vs "pages[1].shapes[2].x"
  const out = pages.map((p, i) => {
    const w = single ? "" : `pages[${i}]`, at = (k) => (w ? w + "." + k : k);
    if (!isObj(p)) fail((w || "board") + " must be an object");
    if (p.name != null && typeof p.name !== "string") fail(at("name") + " must be a string");
    if (!isDoc && p.name != null && !p.name.trim()) fail(at("name") + " must not be empty");
    const list = p.shapes == null && isDoc ? [] : p.shapes;
    if (!Array.isArray(list)) fail(at("shapes") + " must be an array");
    list.forEach((s, j) => checkShape(s, at(`shapes[${j}]`), isDoc));
    const pg = { name: (p.name && p.name.trim() ? p.name.trim() : `Page ${i + 1}`).slice(0, 60), shapes: list.map(cleanShape) };
    if (typeof p.id === "string" && p.id) pg.id = p.id;
    return pg;
  });
  return { app: "lite-board", version: 2, current, pages: out };
}

/** Contents of a .liteboard file (JSON text) that the app opens with "Open" or drag and drop. */
export function toLiteboardFile(input) {
  return JSON.stringify(makeDoc(input), null, 1);
}

/* ---------- share links: deflate-raw + base64url in the #b= fragment (never sent to a server) ---------- */
async function pipe(u8, stream) {
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
}
// Node: node:zlib (every Node version). Browsers: Compression Streams, which also reject junk after the data.
const IS_NODE = typeof process !== "undefined" && !!(process.versions && process.versions.node);
const zlib = () => import("node:zlib");
async function deflateRaw(u8) {
  if (IS_NODE) return new Uint8Array((await zlib()).deflateRawSync(u8));
  return pipe(u8, new CompressionStream("deflate-raw"));
}
async function inflateRaw(u8) {
  if (!IS_NODE) return pipe(u8, new DecompressionStream("deflate-raw"));
  const { buffer, engine } = (await zlib()).inflateRawSync(u8, { info: true });
  if (engine.bytesWritten !== u8.length) throw new Error("junk after compressed data"); // the app's browser decoder rejects this too
  return new Uint8Array(buffer);
}
function b64u(u8) {
  let b = "";
  for (let i = 0; i < u8.length; i += 32768) b += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function ub64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const b = atob(s + "===".slice((s.length + 3) % 4)), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Make a share link that opens the board in lite-board. No server, no upload:
 * the whole board is compressed into the URL fragment.
 * @param input same as makeDoc
 * @param {{base?: string}} [opts] app URL (default: the public lite-board site)
 * @returns {Promise<string>}
 */
export async function makeLink(input, opts = {}) {
  const doc = makeDoc(input);
  // same compact shape as the app's Share button: no ids, points rounded to 0.1
  const slim = { app: "lite-board", version: 2, current: doc.current, pages: doc.pages.map((p) => ({ name: p.name, shapes: p.shapes.map((s) => {
    const o = { ...s }; delete o.id; if (o.points) o.points = o.points.map((q) => [r1(q[0]), r1(q[1])]); return o;
  }) })) };
  const base = String(opts.base || APP_URL).split("#")[0];
  return base + "#b=" + b64u(await deflateRaw(new TextEncoder().encode(JSON.stringify(slim))));
}

/**
 * Read the board inside a share link (or just its "#b=..." part).
 * @returns {Promise<object>} a lite-board v2 document (shapes have no ids)
 */
export async function readLink(link) {
  const m = /(?:^|[#&])b=([A-Za-z0-9_-]+)/.exec(String(link));
  if (!m) fail("no #b= board data in the link");
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(await inflateRaw(ub64u(m[1])))); }
  catch (_) { fail("the link data is corrupted or truncated"); }
  return makeDoc(doc);
}
