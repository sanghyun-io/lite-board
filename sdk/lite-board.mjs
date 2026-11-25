// lite-board SDK: everything the lite-board app does, without a browser — build and edit boards (Board = the app's
// window.liteBoard API), and export share links, .liteboard, .tldr, SVG and PNG; import .liteboard / .tldr / links.
// No required dependencies. Node 18+ and modern browsers. PNG in Node uses the optional package @resvg/resvg-js.
// Format: ../API.md, ../README.md.

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
  if (isTldr(input)) input = fromTldr(input); // a .tldr file object becomes a lite-board document
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
    const w = isDoc && input.version === 1 ? "doc" : single ? "" : `pages[${i}]`, at = (k) => (w ? w + "." + k : k); // "doc." for v1 documents, like the app's loadDoc
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

/* ---------- .tldr (tldraw file) — same conversion as the app's ".tldr" export and Open ---------- */
const f2 = (n) => Math.round(n * 100) / 100;
const rid = () => Math.random().toString(36).slice(2, 10);
const TL_SCHEMA = { schemaVersion: 2, sequences: { "com.tldraw.store": 5, "com.tldraw.asset": 1, "com.tldraw.camera": 1, "com.tldraw.document": 2, "com.tldraw.instance": 26, "com.tldraw.instance_page_state": 5, "com.tldraw.page": 1, "com.tldraw.instance_presence": 6, "com.tldraw.pointer": 1, "com.tldraw.shape": 4, "com.tldraw.user": 1, "com.tldraw.asset.image": 6, "com.tldraw.asset.video": 5, "com.tldraw.asset.bookmark": 2, "com.tldraw.shape.group": 0, "com.tldraw.shape.text": 4, "com.tldraw.shape.bookmark": 4, "com.tldraw.shape.draw": 5, "com.tldraw.shape.geo": 14, "com.tldraw.shape.note": 15, "com.tldraw.shape.line": 5, "com.tldraw.shape.frame": 1, "com.tldraw.shape.arrow": 8, "com.tldraw.shape.highlight": 4, "com.tldraw.shape.embed": 4, "com.tldraw.shape.image": 7, "com.tldraw.shape.video": 6, "com.tldraw.binding.arrow": 1 } };
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function tlIndex(i) { const d = (v, n) => { let s = ""; for (let k = 0; k < n; k++) { s = B62[v % 62] + s; v = Math.floor(v / 62); } return s; }; return i < 62 ? "a" + d(i, 1) : i < 3844 ? "b" + d(i, 2) : i < 238328 ? "c" + d(i, 3) : "d" + d(i, 4); }
function f16(h) { const s = h >> 15, e = (h >> 10) & 31, m = h & 1023; if (e === 0) return (s ? -1 : 1) * m * 2 ** -24; if (e === 31) return m ? NaN : s ? -1 / 0 : 1 / 0; return (s ? -1 : 1) * 2 ** (e - 15) * (1 + m / 1024); }
function h16(v) { if (v === 0) return Object.is(v, -0) ? 32768 : 0; if (!Number.isFinite(v)) return Number.isNaN(v) ? 32256 : v > 0 ? 31744 : 64512; const s = v < 0 ? 1 : 0; v = Math.abs(v); const n = Math.floor(Math.log2(v)); let e = n + 15; if (e >= 31) return (s << 15) | 31744; if (e <= 0) return (s << 15) | (Math.round(v * 2 ** 24) & 1023); let m = Math.round((v / 2 ** n - 1) * 1024); if (m >= 1024) { m = 0; e++; if (e >= 31) return (s << 15) | 31744; } return (s << 15) | (e << 10) | m; }
function encodePath(P) {
  const u = new Uint8Array(8 + (P.length - 1) * 4), dv = new DataView(u.buffer);
  dv.setFloat32(0, P[0][0], true); dv.setFloat32(4, P[0][1], true); let x = P[0][0], y = P[0][1];
  for (let i = 1; i < P.length; i++) { const dx = P[i][0] - x, dy = P[i][1] - y, o = 8 + (i - 1) * 4; dv.setUint16(o, h16(dx), true); dv.setUint16(o + 2, h16(dy), true); x += f16(h16(dx)); y += f16(h16(dy)); }
  let b = ""; for (let i = 0; i < u.length; i++) b += String.fromCharCode(u[i]); return btoa(b);
}
function decodePath(b64, dim) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  if (u8.length < 8) return [];
  const dv = new DataView(u8.buffer), pts = []; let x = dv.getFloat32(0, true), y = dv.getFloat32(4, true);
  const head = dim === 2 ? 8 : 12, step = dim === 2 ? 4 : 6; pts.push([x, y]);
  for (let o = head; o + 4 <= u8.length; o += step) { x += f16(dv.getUint16(o, true)); y += f16(dv.getUint16(o + 2, true)); pts.push([x, y]); }
  return pts;
}
const tlRich = (t) => ({ type: "doc", content: String(t || "").split("\n").map((l) => (l ? { type: "paragraph", content: [{ type: "text", text: l }] } : { type: "paragraph" })) });

/** Contents of a .tldr file (JSON text) that tldraw.com opens (drop it onto the canvas). One tldraw page per board page. */
export function toTldrFile(input) {
  const doc = makeDoc(input);
  return JSON.stringify(tldrOf(doc.pages.map((p) => ({ name: p.name, shapes: p.shapes.map((s) => { const n = norm(s); lay(n); return n; }) }))));
}
// pages of normalized, laid-out shapes -> .tldr object (same records as the app's toTldr)
function tldrOf(pl) {
  const recs = [{ gridSize: 10, name: "", meta: {}, id: "document:document", typeName: "document" }];
  let i = 1, par = "";
  const base = (type, x, y, props) => ({ x: f2(x), y: f2(y), rotation: 0, isLocked: false, opacity: 1, meta: {}, id: "shape:" + rid() + i, type, props, parentId: par, index: tlIndex(i++), typeName: "shape" });
  pl.forEach((p, k) => {
    par = "page:" + (k + 1);
    recs.push({ meta: {}, id: par, name: p.name, index: tlIndex(k + 1), typeName: "page" });
    for (const s of p.shapes) {
      const st = s.style, c = st.color, common = { color: c, size: st.size };
      if (s.type === "rect" || s.type === "ellipse") recs.push(base("geo", s.x, s.y, { w: s.w, h: s.h, geo: s.type === "rect" ? "rectangle" : "ellipse", dash: st.dash, growY: 0, url: "", scale: 1, flipX: false, flipY: false, ...common, labelColor: c, fill: st.fill, font: "sans", align: "middle", verticalAlign: "middle", richText: tlRich(s.text) }));
      else if (s.type === "text") recs.push(base("text", s.x, s.y, { ...common, w: s.w, font: "sans", textAlign: "start", autoSize: !s.wrap, scale: 1, richText: tlRich(s.text) }));
      else if (s.type === "note") { const sc = Math.max(0.1, s.w / 200); recs.push(base("note", s.x, s.y, { ...common, richText: tlRich(s.text), font: "sans", align: "start", verticalAlign: "start", labelColor: "black", growY: Math.max(0, s.h / sc - 200), fontSizeAdjustment: 1, url: "", scale: sc, textLastEditedBy: null })); }
      else if (s.type === "arrow") recs.push(base("arrow", s.start.x, s.start.y, { kind: "arc", elbowMidPoint: 0.5, dash: st.dash, ...common, fill: "none", labelColor: c, bend: 0, start: { x: 0, y: 0 }, end: { x: f2(s.end.x - s.start.x), y: f2(s.end.y - s.start.y) }, arrowheadStart: "none", arrowheadEnd: "arrow", richText: tlRich(""), labelPosition: 0.5, font: "sans", scale: 1 }));
      else if (s.type === "line" || (s.type === "draw" && s.poly)) {
        const P = s.type === "line" ? [[s.start.x, s.start.y], [s.end.x, s.end.y]] : s.points, ox = P[0][0], oy = P[0][1], pts = {};
        P.forEach((q, j) => { const id = tlIndex(j + 1); pts[id] = { id, index: id, x: f2(q[0] - ox), y: f2(q[1] - oy) }; });
        recs.push(base("line", ox, oy, { ...common, dash: st.dash, spline: "line", points: pts, scale: 1 }));
      } else if (s.type === "draw") {
        const P = s.points; let ox = 1 / 0, oy = 1 / 0; for (const q of P) { ox = Math.min(ox, q[0]); oy = Math.min(oy, q[1]); }
        recs.push(base("draw", ox, oy, { segments: [{ type: "free", path: encodePath(P.map((q) => [q[0] - ox, q[1] - oy])), dim: 2 }], ...common, fill: st.fill, dash: st.dash, isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 }));
      }
    }
  });
  return { tldrawFileFormatVersion: 1, schema: TL_SCHEMA, records: recs };
}

function isTldr(o) { return isObj(o) && Array.isArray(o.records) && o.app !== "lite-board"; } // the app checks lite-board first, then records
const cmp = (a, b) => { a = String(a == null ? "" : a); b = String(b == null ? "" : b); return a < b ? -1 : a > b ? 1 : 0; };
function richText(p) {
  const r = p.richText;
  if (r && typeof r === "object") { const walk = (n) => (!n || typeof n !== "object" ? "" : n.type === "text" ? String(n.text || "") : n.type === "hardBreak" ? "\n" : Array.isArray(n.content) ? n.content.map(walk).join("") : ""); return (Array.isArray(r.content) ? r.content : []).map(walk).join("\n"); }
  return typeof p.text === "string" ? p.text : "";
}
// tldraw's text/note have no dash: those come in solid (geo/draw default to tldraw's hand-drawn "draw")
function tStyle(p) { return { color: COLORS.includes(p.color) ? p.color : p.color === "white" ? "grey" : "black", fill: FILLS.includes(p.fill) ? p.fill : p.fill ? "solid" : "none", dash: DASHES.includes(p.dash) ? p.dash : p.dash == null ? "solid" : "draw", size: SIZES.includes(p.size) ? p.size : "m" }; }
// same as the app's conv(); the result goes through norm() like the app's setDoc (sizes 0 -> defaults, non-finite -> 0)
function conv(s, ox, oy) {
  const p = s.props || {}, x = (+s.x || 0) + ox, y = (+s.y || 0) + oy, sc = +p.scale || 1, style = tStyle(p), n = (v) => (Number.isFinite(+v) ? +v : 0);
  switch (s.type) {
    case "geo": return { type: p.geo === "ellipse" || p.geo === "oval" ? "ellipse" : "rect", x, y, w: n(p.w) || 100, h: (n(p.h) || 100) + n(p.growY), text: richText(p), style };
    case "text": { const t = { type: "text", x, y, w: (n(p.w) || 100) * sc, h: 10, text: richText(p), style }; if (p.autoSize === false) t.wrap = true; return t; }
    case "note": { const z = 200 * sc; if (style.color === "black") style.color = "yellow"; return { type: "note", x, y, w: z, h: z + n(p.growY) * sc, text: richText(p), style }; }
    case "arrow": { const a = p.start || {}, b = p.end || {}; return { type: "arrow", start: { x: x + n(a.x), y: y + n(a.y) }, end: { x: x + n(b.x), y: y + n(b.y) }, style }; }
    case "line": {
      const pts = (Array.isArray(p.points) ? p.points.slice() : Object.values(p.points || {})).filter((q) => q && typeof q === "object");
      pts.sort((a, b) => cmp(a.index, b.index));
      const P = pts.map((q) => [x + n(q.x), y + n(q.y)]); if (P.length < 2) return null;
      if (P.length === 2) return { type: "line", start: { x: P[0][0], y: P[0][1] }, end: { x: P[1][0], y: P[1][1] }, style };
      return { type: "draw", points: P, poly: true, style };
    }
    case "draw": case "highlight": {
      const kx = Number.isFinite(+p.scaleX) && +p.scaleX ? +p.scaleX : 1, ky = Number.isFinite(+p.scaleY) && +p.scaleY ? +p.scaleY : 1; let P = [];
      for (const g of Array.isArray(p.segments) ? p.segments : []) {
        try { if (typeof g.path === "string") P = P.concat(decodePath(g.path, g.dim)); else if (Array.isArray(g.points)) P = P.concat(g.points.map((q) => [n(q.x), n(q.y)])); } catch (_) {} // a bad segment is dropped whole, like the app
      }
      P = P.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])).map(([a, b]) => [f2(a * kx + x), f2(b * ky + y)]);
      return P.length ? { type: "draw", points: P, style } : null;
    }
  }
  return null;
}
/**
 * Convert a .tldr file (object or JSON text) to a lite-board v2 document, like the app's Open.
 * Partial support: geo, text, note, arrow (bindings ignored), line, draw/highlight; groups/frames are flattened, rotation ignored.
 * @returns {{doc: object, skipped: number}}
 */
export function readTldr(file) {
  if (typeof file === "string") { try { file = JSON.parse(file.replace(/^﻿/, "")); } catch (e) { fail("not valid JSON: " + e.message); } }
  if (isObj(file) && !Array.isArray(file.records) && isObj(file.document) && file.document.version != null) fail("old (v1) .tldr files are not supported");
  if (!isTldr(file)) fail("not a .tldr file (expected a records array)");
  const recs = file.records.filter((r) => isObj(r));
  const pgs = recs.filter((r) => r.typeName === "page").sort((a, b) => cmp(a.index, b.index));
  const pm = new Map(pgs.map((p, i) => [p.id, { name: typeof p.name === "string" && p.name.trim() ? p.name : "Page " + (i + 1), list: [] }])), one = pm.size ? null : { name: "Page 1", list: [] };
  const byId = new Map(recs.filter((r) => r.typeName === "shape").map((r) => [r.id, r]));
  let skipped = 0;
  for (const s of byId.values()) {
    let ox = 0, oy = 0, keys = [s.index], par = s.parentId, g = 0;
    while (par && byId.has(par) && g++ < 64) { const q = byId.get(par); ox += +q.x || 0; oy += +q.y || 0; keys.unshift(q.index); par = q.parentId; }
    const t = one || pm.get(par); if (!t) { skipped++; continue; }
    t.list.push({ s, ox, oy, keys });
  }
  const pages = (one ? [one] : [...pm.values()]).map((p) => {
    p.list.sort((a, b) => { for (let i = 0; i < Math.min(a.keys.length, b.keys.length); i++) { const c = cmp(a.keys[i], b.keys[i]); if (c) return c; } return a.keys.length - b.keys.length; });
    const sh = []; for (const { s, ox, oy } of p.list) { if (s.type === "group") continue; const r = conv(s, ox, oy); if (r) sh.push(r); else skipped++; }
    return { name: p.name, shapes: sh.map(norm).filter(Boolean).map((s) => { delete s.id; return s; }) };
  });
  return { doc: makeDoc({ app: "lite-board", version: 2, current: 0, pages }), skipped };
}
function fromTldr(o) { return readTldr(o).doc; }

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

/* ---------- shape model (same as the app: norm / layout / geometry) ---------- */
export const TOOLS = ["select", "hand", "draw", "eraser", "arrow", "line", "text", "note", "rect", "ellipse"];
const SW = { s: 2, m: 3.5, l: 5.5, xl: 9 }, FS = { s: 18, m: 24, l: 34, xl: 46 }, LH = 1.3;
const FONT = 'ui-rounded,system-ui,-apple-system,"Segoe UI",sans-serif';
const PAL_L = { black: "#1e1f24", grey: "#868b94", "light-violet": "#c58df0", violet: "#7c3fc9", blue: "#2f5fe0", "light-blue": "#3fa7e8", yellow: "#e2a600", orange: "#ec7420", green: "#178a4c", "light-green": "#5cc25a", "light-red": "#f07285", red: "#d9302c" };
const cl = (o) => JSON.parse(JSON.stringify(o));
const uid = () => "s_" + rid() + Date.now().toString(36).slice(-3);
const pid = () => "p_" + rid() + Date.now().toString(36).slice(-3);
const clampZ = (z) => Math.min(8, Math.max(0.1, z));
function normStyle(o) { o = o || {}; return { color: COLORS.includes(o.color) ? o.color : "black", fill: FILLS.includes(o.fill) ? o.fill : "none", dash: DASHES.includes(o.dash) ? o.dash : "solid", size: SIZES.includes(o.size) ? o.size : "m" }; }
// the app's norm(): fills defaults (size 100x100, note 200x200, full style) and gives every shape an id
function norm(s) {
  if (!s || !TYPES.includes(s.type)) return null;
  const n = (v) => (Number.isFinite(+v) ? +v : 0), o = { id: typeof s.id === "string" && s.id ? s.id : uid(), type: s.type };
  if (s.type === "draw") { if (!Array.isArray(s.points) || !s.points.length) return null; o.points = s.points.map((p) => (Array.isArray(p) ? [n(p[0]), n(p[1])] : [n(p && p.x), n(p && p.y)])); }
  else if (s.type === "arrow" || s.type === "line") { const a = s.start || {}, b = s.end || {}; o.start = { x: n(a.x), y: n(a.y) }; o.end = { x: n(b.x), y: n(b.y) }; }
  else { o.x = n(s.x); o.y = n(s.y); o.w = Math.max(1, n(s.w) || (s.type === "note" ? 200 : 100)); o.h = Math.max(1, n(s.h) || (s.type === "note" ? 200 : 100)); }
  if (typeof s.text === "string" && s.text) o.text = s.text;
  if (s.wrap) o.wrap = true; if (s.poly && s.type === "draw") o.poly = true;
  o.style = normStyle(s.style); return o;
}
// Text width: a real canvas in browsers (exactly like the app); in Node an estimate of the app's UI font
let mctx = null, mfont = "";
function measureCtx() {
  if (mctx !== null) return mctx;
  try { mctx = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : false; } catch (_) { mctx = false; }
  return (mctx = mctx || false);
}
const WIDE = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-｠\u{1f000}-\u{1faff}\u{20000}-\u{3ffff}]/u;
function estW(s, fs) {
  let w = 0;
  for (const c of s) w += WIDE.test(c) ? 1 : c === " " ? 0.28 : /[iljI.,:;'|!]/.test(c) ? 0.3 : /[mwMW@]/.test(c) ? 0.86 : /[A-Z]/.test(c) ? 0.66 : 0.56;
  return w * fs;
}
function mw(s, fs) { const c = measureCtx(); if (!c) return estW(s, fs); const fo = fs + "px " + FONT; if (fo !== mfont) { c.font = fo; mfont = fo; } return c.measureText(s).width; }
function wrap(t, W, fs) {
  const out = []; W = Math.max(W, fs);
  for (const para of t.split("\n")) {
    if (mw(para, fs) <= W) { out.push(para); continue; }
    let line = "";
    for (const w of para.split(/(\s+)/)) {
      if (!w) continue;
      const tl = line + w;
      if (line && mw(tl, fs) > W) { out.push(line.replace(/\s+$/, "")); line = w.replace(/^\s+/, ""); } else line = tl;
      while (line.length > 1 && mw(line, fs) > W) { let lo = 1, hi = line.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (mw(line.slice(0, m), fs) <= W) lo = m; else hi = m - 1; } out.push(line.slice(0, lo)); line = line.slice(lo); }
    }
    out.push(line);
  }
  return out;
}
// lays out text: auto width for text shapes, height for text and notes (mutates s, like the app)
function lay(s) {
  const fs = FS[s.style.size] || 24, t = s.text || ""; let lines;
  if (s.type === "text") {
    if (s.wrap) lines = wrap(t, s.w - 8, fs);
    else { lines = t.split("\n"); s.w = Math.max(24, ...lines.map((l) => mw(l, fs))) + 8; }
    s.h = Math.max(1, lines.length) * fs * LH + 8;
    return { lines, fs };
  }
  if (s.type === "note") { const n = fs * 0.8; lines = t ? wrap(t, s.w - 24, n) : []; s.h = Math.max(s.h, lines.length * n * LH + 24); return { lines, fs: n }; }
  return { lines: t ? wrap(t, s.w - 16, fs) : [], fs };
}
function bb(s) {
  if (s.type === "draw") { let a = 1 / 0, b = 1 / 0, c = -1 / 0, d = -1 / 0; for (const [x, y] of s.points) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return { x: a, y: b, w: c - a, h: d - b }; }
  if (s.start) { const a = s.start, b = s.end; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}
function union(list) { let a = 1 / 0, b = 1 / 0, c = -1 / 0, d = -1 / 0; for (const s of list) { const r = bb(s); a = Math.min(a, r.x); b = Math.min(b, r.y); c = Math.max(c, r.x + r.w); d = Math.max(d, r.y + r.h); } return { x: a, y: b, w: c - a, h: d - b }; }
function translate(o, dx, dy) { const s = cl(o); if (s.points) s.points = s.points.map(([x, y]) => [x + dx, y + dy]); else if (s.start) { s.start = { x: s.start.x + dx, y: s.start.y + dy }; s.end = { x: s.end.x + dx, y: s.end.y + dy }; } else { s.x += dx; s.y += dy; } return s; }

/* ---------- SVG / PNG (same drawing as the app's SVG and PNG export: white background, light palette) ---------- */
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const h2r = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function tint(c, t, bg) { const a = h2r(c), b = h2r(bg); return "#" + a.map((v, i) => Math.round(b[i] + (v - b[i]) * t).toString(16).padStart(2, "0")).join(""); }
function rng(id) { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return () => { h = (Math.imul(h, 1103515245) + 12345) | 0; return ((h >>> 8) & 65535) / 65535; }; }
function roughR(s) {
  const R = rng(s.id), j = Math.min(3.5, Math.min(s.w, s.h) * 0.03 + 0.8), r = () => (R() - 0.5) * 2 * j;
  const c = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]].map(([a, b]) => [a + r(), b + r()]);
  let d = `M${f2(c[0][0])} ${f2(c[0][1])}`;
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; d += `Q${f2((a[0] + b[0]) / 2 + r())} ${f2((a[1] + b[1]) / 2 + r())} ${f2(b[0])} ${f2(b[1])}`; }
  return d + "Z";
}
function roughE(s) {
  const R = rng(s.id), rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry, ph = R() * 6.28, a = Math.min(0.035, 3 / Math.max(Math.min(rx, ry), 1)), n = 48; let d = "";
  for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2, k = 1 + a * Math.sin(2 * t + ph) + a * 0.5 * Math.sin(3 * t + ph * 2); d += (i ? "L" : "M") + f2(cx + Math.cos(t) * rx * k) + " " + f2(cy + Math.sin(t) * ry * k); }
  return d + "Z";
}
function smooth(P) {
  if (P.length < 2) return `M${f2(P[0][0])} ${f2(P[0][1])}l.01 0`;
  let d = `M${f2(P[0][0])} ${f2(P[0][1])}`;
  for (let i = 1; i < P.length - 1; i++) { const [x, y] = P[i], [nx, ny] = P[i + 1]; d += `Q${f2(x)} ${f2(y)} ${f2((x + nx) / 2)} ${f2((y + ny) / 2)}`; }
  const l = P[P.length - 1]; return d + `L${f2(l[0])} ${f2(l[1])}`;
}
function textSvg(s, P, c) {
  const { lines, fs } = lay(s); if (!lines.length) return "";
  let x, y0, anc = "start", tc = c;
  if (s.type === "text") { x = s.x + 4; y0 = s.y + 4; }
  else if (s.type === "note") { x = s.x + 12; y0 = s.y + 12; tc = P.black; }
  else { x = s.x + s.w / 2; anc = "middle"; y0 = s.y + (s.h - lines.length * fs * LH) / 2; }
  return `<text font-family='${FONT}' font-size="${f2(fs)}" fill="${tc}" text-anchor="${anc}" style="white-space:pre">` + lines.map((l, i) => `<tspan x="${f2(x)}" y="${f2(y0 + fs * 0.95 + i * fs * LH)}">${esc(l) || " "}</tspan>`).join("") + "</text>";
}
function shp(s, P, bg) {
  const st = s.style, c = P[st.color] || P.black, sw = SW[st.size] || 3.5;
  const da = st.dash === "dashed" ? ` stroke-dasharray="${f2(sw * 2.5)} ${f2(sw * 2)}"` : st.dash === "dotted" ? ` stroke-dasharray="0.1 ${f2(sw * 2.2)}"` : "";
  const sk = ` stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`, stroke = sk + da;
  const fill = st.fill === "solid" ? tint(c, 0.55, bg) : st.fill === "semi" ? tint(c, 0.14, bg) : "none";
  let o = "";
  switch (s.type) {
    case "rect": o = `<path d="${st.dash === "draw" ? roughR(s) : `M${f2(s.x)} ${f2(s.y)}h${f2(s.w)}v${f2(s.h)}h${f2(-s.w)}Z`}" fill="${fill}"${stroke}/>`; break;
    case "ellipse": o = st.dash === "draw" ? `<path d="${roughE(s)}" fill="${fill}"${stroke}/>` : `<ellipse cx="${f2(s.x + s.w / 2)}" cy="${f2(s.y + s.h / 2)}" rx="${f2(s.w / 2)}" ry="${f2(s.h / 2)}" fill="${fill}"${stroke}/>`; break;
    case "draw": o = `<path d="${s.poly ? "M" + s.points.map((q) => f2(q[0]) + " " + f2(q[1])).join("L") : smooth(s.points)}" fill="none"${stroke}/>`; break;
    case "line": case "arrow": {
      const a = s.start, b = s.end; o = `<path d="M${f2(a.x)} ${f2(a.y)}L${f2(b.x)} ${f2(b.y)}" fill="none"${stroke}/>`;
      if (s.type === "arrow") {
        const g = Math.atan2(b.y - a.y, b.x - a.x), L = Math.hypot(b.x - a.x, b.y - a.y), hl = Math.min(L * 0.4, 8 + sw * 3), p = (k) => `${f2(b.x - hl * Math.cos(g + k))} ${f2(b.y - hl * Math.sin(g + k))}`;
        if (L > 0) o += `<path d="M${p(-0.45)}L${f2(b.x)} ${f2(b.y)}L${p(0.45)}" fill="none"${sk}/>`;
      }
      break;
    }
    case "note": o = `<rect x="${f2(s.x)}" y="${f2(s.y)}" width="${f2(s.w)}" height="${f2(s.h)}" rx="8" fill="${tint(c, 0.3, bg)}" stroke="${tint(c, 0.55, bg)}" stroke-width="1"/>`; break;
  }
  if (s.text) o += textSvg(s, P, c); else if (s.type === "text" || s.type === "note") lay(s);
  return o;
}
// normalized shapes -> {w, h, s: svg text} or null when empty (the app's svgString)
function svgOf(L) {
  if (!L.length) return null;
  L.forEach(lay);
  const b = union(L), pad = 32 + Math.max(...L.map((s) => SW[s.style.size] || 3)), x = f2(b.x - pad), y = f2(b.y - pad), w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  return { w, h, s: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${L.map((s) => shp(s, PAL_L, "#ffffff")).join("")}</svg>` };
}
// Korean-capable sans fonts first: resvg falls back to a serif font for Hangul missing from the first match
const NODE_FONTS = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR","Segoe UI","Helvetica Neue","Noto Sans","Yu Gothic","Microsoft YaHei",Arial,"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
// svg -> PNG bytes. Browsers: canvas (like the app). Node: the optional package @resvg/resvg-js.
async function rasterize(r, k) {
  if (IS_NODE) {
    let Resvg;
    try { ({ Resvg } = await import("@resvg/resvg-js")); }
    catch (_) { fail("PNG export in Node needs the optional package @resvg/resvg-js (run `npm install` in the lite-board sdk folder, or `npm install @resvg/resvg-js`)"); }
    // resvg has no "system-ui": name real UI fonts per OS, with Korean/Japanese/Chinese and emoji fallbacks
    const svg = r.s.split(`font-family='${FONT}'`).join(`font-family='${NODE_FONTS}'`);
    const png = new Resvg(svg, { fitTo: { mode: "zoom", value: k }, font: { loadSystemFonts: true, defaultFontFamily: "Arial" } }).render().asPng();
    return new Uint8Array(png);
  }
  const blob = await new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = Math.ceil(r.w * k); c.height = Math.ceil(r.h * k); const x = c.getContext("2d"); x.scale(k, k); x.drawImage(img, 0, 0, r.w, r.h); c.toBlob((b) => (b ? ok(b) : no(new Error("PNG encoding failed"))), "image/png"); };
    img.onerror = () => no(new Error("SVG rasterization failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.s);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/* ---------- Board: the app's window.liteBoard API without a browser ---------- */
const idSet = (ids, w) => new Set(typeof ids === "string" ? [ids] : Array.isArray(ids) ? ids : fail(w + " must be an id or an array of ids"));
const mkPage = (name) => ({ id: pid(), name, shapes: [], camera: { x: 0, y: 0, z: 1 } });
const VIEW = { width: 1280, height: 800 };

/**
 * A whole lite-board document in memory, with the same methods as the app's window.liteBoard (see ../API.md):
 * pages, shapes, selection, camera, tool/style, undo/redo, and every export (.liteboard, .tldr, SVG, PNG, share link).
 * `new Board(input?, {width?, height?})` — input is anything makeDoc accepts (including a .tldr object); width/height is
 * the virtual screen used by fit() (default 1280x800).
 */
export class Board {
  #pages; #cur; #sel = new Set(); #tool = "select"; #style = { color: "black", fill: "none", dash: "solid", size: "m" };
  #undo = []; #redo = []; #clip = null; #pasteN = 0; #camMem = new Map(); #view;
  constructor(input, opts = {}) {
    for (const k of ["width", "height"]) if (opts[k] != null && !(num(opts[k]) && opts[k] > 0)) fail(k + " must be a positive number");
    this.#view = { width: opts.width || VIEW.width, height: opts.height || VIEW.height };
    this.#pages = [mkPage("Page 1")]; this.#cur = this.#pages[0].id;
    if (input != null) { const d = docInput(input); this.#setDoc(d.pages, d.current); }
  }
  /** Open the board inside a share link. */
  static async fromLink(link, opts) { return new Board(await readLink(link), opts); }
  /**
   * Open file text the way the app's Open does: .liteboard (v1/v2; invalid shapes are skipped, like the app) or .tldr.
   * Plain board JSON (an array of shapes, {shapes} or {pages}) is accepted too. Throws LiteBoardError when it can't be read.
   */
  static fromText(text, opts) {
    let o; try { o = JSON.parse(String(text).replace(/^﻿/, "")); } catch (e) { fail("not valid JSON: " + e.message); }
    if (Array.isArray(o) || (isObj(o) && o.app == null && !o.records && !o.document)) return new Board(o, opts);
    const b = new Board(undefined, opts), r = b.importText(text);
    if (!r.ok) fail({ version: "unsupported lite-board version", schema: "the lite-board file's pages/shapes are not valid", "old-tldr": "old (v1) .tldr files are not supported", tldr: "the .tldr file could not be read", format: "not a .liteboard or .tldr file" }[r.error] || r.error);
    b.#undo = []; b.#redo = []; return b;
  }

  /* internals (mirror the app) */
  #pg() { return this.#pages.find((p) => p.id === this.#cur); }
  #setCur(id) { this.#cur = id; const p = this.#pg(); if (!p.camera) { p.camera = { x: 0, y: 0, z: 1 }; if (p.shapes.length) this.#fit(); } }
  #snap(c) { return JSON.stringify({ c: c || this.#cur, p: this.#pages.map((p) => ({ id: p.id, name: p.name, shapes: p.shapes })) }); }
  #mark(c) { this.#undo.push(this.#snap(c)); if (this.#undo.length > 200) this.#undo.shift(); this.#redo = []; }
  #prune() { const ids = new Set(this.#pg().shapes.map((s) => s.id)); for (const id of [...this.#sel]) if (!ids.has(id)) this.#sel.delete(id); }
  #restore(j) {
    const o = JSON.parse(j), prev = this.#cur, was = new Set(this.#pg().shapes.map((s) => s.id)), cams = new Map(this.#pages.map((p) => [p.id, p.camera]));
    this.#pages = o.p.map((p) => ((p.camera = cams.get(p.id) || this.#camMem.get(p.id) || null), p));
    const has = (id) => this.#pages.some((p) => p.id === id);
    this.#setCur(has(o.c) ? o.c : has(this.#cur) ? this.#cur : this.#pages[0].id);
    if (this.#cur !== prev) this.#sel.clear(); else { this.#prune(); if (!this.#sel.size) for (const s of this.#pg().shapes) if (!was.has(s.id)) this.#sel.add(s.id); }
  }
  #step(from, to) { if (!from.length) return false; const j = from.pop(), o = JSON.parse(j); to.push(this.#snap(o.p.some((p) => p.id === this.#cur) && this.#pages.some((p) => p.id === o.c) ? o.c : this.#cur)); this.#restore(j); return true; }
  #mutate(fn, on) { this.#mark(on && on.length === 1 ? on[0].id : this.#cur); fn(); this.#prune(); }
  #setDoc(raw, current) {
    raw = raw.filter((p) => p && typeof p === "object");
    const seen = new Set(), pids = new Set(); let n = 0;
    this.#pages = raw.map((p, i) => {
      const id = typeof p.id === "string" && p.id && !pids.has(p.id) ? p.id : pid(); pids.add(id);
      const sh = (Array.isArray(p.shapes) ? p.shapes : []).map(norm).filter(Boolean).map((s) => { if (seen.has(s.id)) s.id = uid(); seen.add(s.id); return s; }); n += sh.length;
      const c = p.camera, nm = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 60) : "Page " + (i + 1);
      return { id, name: nm, shapes: sh, camera: c && Number.isFinite(+c.z) && +c.z > 0 ? { x: +c.x || 0, y: +c.y || 0, z: clampZ(+c.z) } : null };
    });
    if (!this.#pages.length) this.#pages = [mkPage("Page 1")];
    const ci = Number.isInteger(current) ? current : raw.findIndex((p) => p.id === current);
    this.#sel.clear(); this.#setCur(this.#pages[ci >= 0 && ci < this.#pages.length ? ci : 0].id);
    return n;
  }
  #fit() {
    const p = this.#pg(), L = p.shapes;
    if (!L.length) { p.camera = { x: 0, y: 0, z: 1 }; return; }
    // the app keeps clear of its floating panels (top 72, bottom 72, right style panel ~186 + 24, margins 24)
    const W = this.#view.width, H = this.#view.height, R = W > 700 ? 210 : 24, T = 72, B = 72, Lm = 24, m = 24;
    const aw = Math.max(80, W - Lm - R - 2 * m), ah = Math.max(80, H - T - B - 2 * m), cx = Lm + m + aw / 2, cy = T + m + ah / 2;
    L.forEach(lay); const b = union(L), z = clampZ(Math.min(4, aw / Math.max(b.w, 1), ah / Math.max(b.h, 1)));
    p.camera = { x: cx - (b.x + b.w / 2) * z, y: cy - (b.y + b.h / 2) * z, z };
  }
  #layAll() { for (const p of this.#pages) for (const s of p.shapes) if (s.type === "text" || s.type === "note") lay(s); }
  #pageOf(r) {
    if (r == null) return this.#pg();
    const P = this.#pages, p = typeof r === "number" ? P[r] : typeof r === "string" ? P.find((q) => q.id === r) || P.find((q) => q.name === r) : null;
    return p || fail("page not found: " + JSON.stringify(r));
  }
  #info(p) { return { id: p.id, name: p.name, index: this.#pages.indexOf(p), count: p.shapes.length, current: p.id === this.#cur }; }
  #find(id) { for (const p of this.#pages) { const s = p.shapes.find((x) => x.id === id); if (s) return { p, s }; } return null; }
  #pick(o) { const p = this.#pageOf(o && o.page); let L = p.shapes; if (o && o.ids != null) { const w = idSet(o.ids, "ids"); L = L.filter((s) => w.has(s.id)); } return L; }
  #insert(p, list, off) {
    const ids = new Set(); for (const q of this.#pages) for (const s of q.shapes) ids.add(s.id);
    const L = list.map((o) => { const s = translate(o, off, off); s.id = uid(); return s; });
    this.#mutate(() => { p.shapes = p.shapes.concat(L); }, [p]);
    if (p.id === this.#cur) { this.#tool = "select"; this.#sel = new Set(L.map((s) => s.id)); }
    return L.map((s) => s.id);
  }

  /* info */
  get version() { return "1.0.0"; }
  get schema() { return { types: TYPES.slice(), tools: TOOLS.slice(), colors: COLORS.slice(), fills: FILLS.slice(), dashes: DASHES.slice(), sizes: SIZES.slice() }; }
  /* document */
  getDoc() { this.#layAll(); return cl({ app: "lite-board", version: 2, current: this.#cur, pages: this.#pages.map((p) => ({ id: p.id, name: p.name, camera: p.camera && { x: f2(p.camera.x), y: f2(p.camera.y), z: p.camera.z }, shapes: p.shapes })) }); }
  loadDoc(doc, o) {
    if (!isObj(doc) || doc.app !== "lite-board") fail('not a lite-board document (expected app: "lite-board")');
    const d = docInput(doc); this.#mark(); const n = this.#setDoc(d.pages, d.current);
    if (!o || o.fit !== false) this.#fit();
    return { pages: this.#pages.length, shapes: n };
  }
  newDoc() { this.#mark(); this.#pages = [mkPage("Page 1")]; this.#setCur(this.#pages[0].id); this.#sel.clear(); return this.#info(this.#pg()); }
  /** Like the app's Open: .liteboard (v1/v2) or .tldr text. Never throws; returns {ok, imported, skipped, pages} or {ok:false, error}. */
  importText(text, filename) {
    let o;
    try { o = JSON.parse(String(text).replace(/^﻿/, "")); } catch (_) { return { ok: false, error: "parse" }; }
    if (o && o.app === "lite-board") {
      const d = o.version === 1 ? (Array.isArray(o.shapes) ? { pages: [{ name: "Page 1", shapes: o.shapes, camera: o.camera }] } : "schema") : o.version === 2 ? (Array.isArray(o.pages) && o.pages.length ? { pages: o.pages, current: o.current } : "schema") : "version";
      if (typeof d === "string") return { ok: false, error: d };
      const tot = d.pages.reduce((a, p) => a + (p && Array.isArray(p.shapes) ? p.shapes.length : 0), 0);
      this.#mark(); const n = this.#setDoc(d.pages, d.current); this.#fit();
      return { ok: true, imported: n, skipped: tot - n, pages: this.#pages.length };
    }
    if (o && !Array.isArray(o.records) && o.document && o.document.version != null) return { ok: false, error: "old-tldr" };
    if (o && Array.isArray(o.records)) {
      let r; try { r = readTldr(o); } catch (_) { return { ok: false, error: "tldr" }; }
      this.#mark(); const n = this.#setDoc(r.doc.pages, 0); this.#fit();
      return { ok: true, imported: n, skipped: r.skipped, pages: this.#pages.length };
    }
    return { ok: false, error: "format" };
  }
  /* pages */
  pages() { return this.#pages.map((p) => this.#info(p)); }
  currentPage() { return this.#info(this.#pg()); }
  addPage(name, o) {
    if (name != null && (typeof name !== "string" || !name.trim())) fail("page name must be a non-empty string");
    this.#mark();
    let nm = String(name || "").trim().slice(0, 60);
    if (!nm) { let n = 1; while (this.#pages.some((p) => p.name === "Page " + n)) n++; nm = "Page " + n; }
    const p = mkPage(nm); this.#pages.push(p);
    if (!(o && o.activate === false)) this.#go(p.id);
    return this.#info(p);
  }
  #go(id) { if (id === this.#cur) return; this.#setCur(id); this.#sel.clear(); this.#pasteN = 0; }
  switchPage(r) { const p = this.#pageOf(r); this.#go(p.id); return this.#info(p); }
  renamePage(r, name) {
    const v = typeof name === "string" ? name.trim().slice(0, 60) : ""; if (!v) fail("page name must be a non-empty string");
    const p = this.#pageOf(r); if (v !== p.name) { this.#mark(); p.name = v; } return this.#info(p);
  }
  deletePage(r) {
    const p = this.#pageOf(r); if (this.#pages.length < 2) fail("cannot delete the last page");
    const i = this.#pages.indexOf(p); this.#mark(); this.#camMem.set(p.id, p.camera); this.#pages.splice(i, 1);
    if (p.id === this.#cur) { this.#setCur(this.#pages[Math.min(i, this.#pages.length - 1)].id); this.#sel.clear(); }
    return this.pages();
  }
  movePage(r, to) {
    const p = this.#pageOf(r), from = this.#pages.indexOf(p);
    if (!Number.isInteger(to) || to < 0 || to >= this.#pages.length) fail(`index must be an integer from 0 to ${this.#pages.length - 1}`);
    if (to !== from) { this.#mark(); this.#pages.splice(to, 0, this.#pages.splice(from, 1)[0]); }
    return this.pages();
  }
  /* shapes */
  getShapes(o) { const p = this.#pageOf(o && o.page); this.#layAll(); return cl(p.shapes); }
  getShape(id) { const l = this.#find(id); if (!l) return null; this.#layAll(); return cl(l.s); }
  addShapes(list, o) {
    if (!Array.isArray(list)) fail("addShapes expects an array of shapes");
    list.forEach((s, i) => checkShape(s, `shapes[${i}]`)); const p = this.#pageOf(o && o.page); if (!list.length) return [];
    const ids = new Set(); for (const q of this.#pages) for (const s of q.shapes) ids.add(s.id);
    const L = list.map((s) => { const n = norm(cl(s)); if (ids.has(n.id)) n.id = uid(); ids.add(n.id); return n; });
    this.#mutate(() => { p.shapes = p.shapes.concat(L); }, [p]);
    if (o && o.select && p.id === this.#cur) { this.#tool = "select"; this.#sel = new Set(L.map((s) => s.id)); }
    return L.map((s) => s.id);
  }
  addShape(s, o) { return this.addShapes([s], o)[0]; }
  updateShape(id, patch) {
    if (!isObj(patch)) fail("patch must be an object");
    checkStyle(patch.style, "patch.style");
    const l = this.#find(id); if (!l) fail("shape not found: " + id); if (patch.type != null && patch.type !== l.s.type) fail("type cannot be changed");
    const m = Object.assign(cl(l.s), cl(patch), { id: l.s.id, type: l.s.type, style: Object.assign({}, l.s.style, patch.style) });
    checkShape(m, "shape", !("text" in patch)); const n = norm(m), p = l.p;
    if (JSON.stringify(n) !== JSON.stringify(l.s)) this.#mutate(() => { p.shapes = p.shapes.map((x) => (x.id === id ? n : x)); }, [p]);
    this.#layAll(); return cl(this.#find(id).s);
  }
  moveShapes(ids, dx, dy) {
    if (!num(dx) || !num(dy)) fail("dx and dy must be numbers"); const want = idSet(ids, "ids");
    const hit = this.#pages.filter((p) => p.shapes.some((s) => want.has(s.id))); if (!hit.length || (!dx && !dy)) return 0;
    let n = 0; this.#mutate(() => { for (const p of hit) p.shapes = p.shapes.map((s) => (want.has(s.id) ? (n++, translate(s, dx, dy)) : s)); }, hit); return n;
  }
  deleteShapes(ids) {
    const want = idSet(ids, "ids");
    const hit = this.#pages.filter((p) => p.shapes.some((s) => want.has(s.id))); if (!hit.length) return 0;
    let n = 0; this.#mutate(() => { for (const p of hit) { const k = p.shapes.length; p.shapes = p.shapes.filter((s) => !want.has(s.id)); n += k - p.shapes.length; } }, hit); return n;
  }
  clearPage(r) { const p = this.#pageOf(r), n = p.shapes.length; if (n) this.#mutate(() => { p.shapes = []; }, [p]); return n; }
  /** Ctrl+D: copies of the shapes (default: the selection) on their page, offset by 16; selects them on the current page. */
  duplicate(ids, o) {
    const off = o && o.offset != null ? o.offset : 16; if (!num(off)) fail("offset must be a number");
    const want = ids == null ? new Set(this.#sel) : idSet(ids, "ids"), p = this.#pages.find((q) => q.shapes.some((s) => want.has(s.id)));
    if (!p) return []; return this.#insert(p, p.shapes.filter((s) => want.has(s.id)), off);
  }
  /** Ctrl+C: copies the shapes (default: the selection) to the board's clipboard. Returns how many. */
  copy(ids) {
    const want = ids == null ? new Set(this.#sel) : idSet(ids, "ids"), L = [];
    for (const p of this.#pages) for (const s of p.shapes) if (want.has(s.id)) L.push(s);
    if (L.length) { this.#clip = cl(L); this.#pasteN = 0; } return L.length;
  }
  /** Ctrl+X: copy, then delete. */
  cut(ids) { const want = ids == null ? [...this.#sel] : [...idSet(ids, "ids")], n = this.copy(want); if (n) this.deleteShapes(want); return n; }
  /** Ctrl+V: pastes the clipboard onto a page (default: current), offset 16 more each time. Returns the new ids. */
  paste(o) { if (!this.#clip || !this.#clip.length) return []; return this.#insert(this.#pageOf(o && o.page), this.#clip, 16 * ++this.#pasteN); }
  /* selection, view, tools (current page) */
  getSelection() { return [...this.#sel]; }
  select(ids) { const want = ids == null ? new Set() : idSet(ids, "ids"); this.#tool = "select"; this.#sel = new Set(this.#pg().shapes.filter((s) => want.has(s.id)).map((s) => s.id)); return [...this.#sel]; }
  selectAll() { return this.select(this.#pg().shapes.map((s) => s.id)); }
  getCamera() { const c = this.#pg().camera; return { x: c.x, y: c.y, z: c.z }; }
  setCamera(c) {
    if (!c || typeof c !== "object") fail("camera must be an object {x, y, z}");
    for (const k of ["x", "y", "z"]) if (c[k] != null && !num(c[k])) fail(`camera.${k} must be a number`); if (c.z != null && c.z <= 0) fail("camera.z must be greater than 0");
    const cam = this.#pg().camera; if (c.x != null) cam.x = c.x; if (c.y != null) cam.y = c.y; if (c.z != null) cam.z = clampZ(c.z); return this.getCamera();
  }
  fit() { this.#fit(); return this.getCamera(); }
  getTool() { return this.#tool; }
  setTool(t) { if (!TOOLS.includes(t)) fail(`tool must be one of ${TOOLS.join(", ")}`); this.#tool = t; if (t !== "select") this.#sel.clear(); return t; }
  getStyle() { return { ...this.#style }; }
  /** Style for the next shapes a person draws. With {apply: true} it also restyles the selection (like the style panel), as one undo step. */
  setStyle(st, o) {
    if (st == null) fail("style must be an object"); checkStyle(st, "style"); Object.assign(this.#style, st);
    if (o && o.apply && this.#sel.size) { const p = this.#pg(); this.#mutate(() => { p.shapes = p.shapes.map((s) => (this.#sel.has(s.id) ? { ...s, style: { ...s.style, ...st } } : s)); }, [p]); }
    return { ...this.#style };
  }
  /* history */
  undo() { return this.#step(this.#undo, this.#redo); }
  redo() { return this.#step(this.#redo, this.#undo); }
  /* export */
  toTldr(o) { const P = o && o.page != null ? [this.#pageOf(o.page)] : this.#pages; this.#layAll(); return tldrOf(P); }
  toSvg(o) { const r = svgOf(this.#pick(o)); return r ? r.s : null; }
  /** PNG bytes (Uint8Array) or null when there is nothing to draw. Node needs the optional package @resvg/resvg-js. */
  async toPng(o) {
    const k = o && o.scale != null ? o.scale : 2; if (!num(k) || k <= 0 || k > 8) fail("scale must be a number in (0, 8]");
    const r = svgOf(this.#pick(o)); return r ? rasterize(r, k) : null;
  }
  toLiteboardFile() { return JSON.stringify(this.getDoc(), null, 1); }
  toTldrFile(o) { return JSON.stringify(this.toTldr(o)); }
  getShareLink(o) { const d = this.getDoc(); return makeLink({ ...d, current: this.#pages.findIndex((p) => p.id === this.#cur) }, o); }
  decodeShareLink(link) { return readLink(link); }
}
// anything makeDoc accepts -> {pages (with ids/cameras when the input had them), current index}
function docInput(input) {
  const doc = makeDoc(input), src = isObj(input) && input.app === "lite-board" ? (input.version === 1 ? [{ camera: input.camera }] : input.pages) : null;
  return { current: doc.current, pages: doc.pages.map((p, i) => (src && isObj(src[i]) && src[i].camera ? { ...p, camera: src[i].camera } : p)) };
}

/** SVG text of a page (default: the board's current page), or null when it is empty. */
export function toSvg(input, opts) { return new Board(input).toSvg(opts); }
/** PNG bytes of a page (default: the current page), or null when it is empty. Node needs @resvg/resvg-js. */
export function toPng(input, opts) { return new Board(input).toPng(opts); }
