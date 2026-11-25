// node sdk/test.mjs: SDK + CLI + MCP smoke tests (no dependencies)
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { makeDoc, makeLink, readLink, toLiteboardFile, toTldrFile, readTldr, toSvg, Board, LiteBoardError, APP_URL } from "./lite-board.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const kids = new Set(); // child processes to kill if a test fails midway
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error("FAIL", name, "\n ", e.message); process.exitCode = 1; for (const k of kids) k.kill(); } };
const throwsLB = (fn, re) => assert.throws(fn, (e) => e instanceof LiteBoardError && e.message.startsWith("liteBoard: ") && (!re || re.test(e.message)));

const FLOW = [
  { type: "rect", x: 0, y: 0, w: 200, h: 80, text: "Login", style: { color: "blue", fill: "semi" } },
  { type: "arrow", start: { x: 200, y: 40 }, end: { x: 300, y: 40 } },
  { type: "rect", x: 300, y: 0, w: 200, h: 80, text: "Dashboard" },
  { type: "note", x: 300, y: 120, text: "todo" },
  { type: "text", x: 0, y: 120, text: "flow" },
  { type: "ellipse", x: 0, y: 200 },
  { type: "line", start: { x: 0, y: 300 }, end: { x: 100, y: 300 } },
  { type: "draw", points: [[0, 400], [10.04, 410.06], { x: 20, y: 400 }] },
];

await t("makeDoc accepts all input forms", () => {
  assert.equal(makeDoc(FLOW).pages[0].shapes.length, 8);
  assert.equal(makeDoc({ shapes: FLOW, name: "Flow" }).pages[0].name, "Flow");
  const d = makeDoc({ pages: [{ name: "A", shapes: [] }, { name: "B", shapes: FLOW }], current: 1 });
  assert.deepEqual([d.pages.length, d.current, d.pages[1].name], [2, 1, "B"]);
  const sample = JSON.parse(readFileSync(join(here, "../samples/sample.liteboard"), "utf8"));
  assert.equal(makeDoc(sample).pages.length, sample.pages.length);
  assert.equal(makeDoc({ app: "lite-board", version: 1, shapes: FLOW }).pages[0].name, "Page 1");
});
await t("makeDoc rejects bad input with liteBoard errors", () => {
  throwsLB(() => makeDoc([{ type: "circle" }]), /type must be one of/);
  throwsLB(() => makeDoc([{ type: "rect", x: "1", y: 0 }]), /shapes\[0\]\.x/);
  throwsLB(() => makeDoc([{ type: "rect", x: 0, y: 0, style: { color: "pink" } }]), /color must be one of/);
  throwsLB(() => makeDoc([{ type: "rect", x: 0, y: 0, style: { toString: "x" } }]), /not a style key/);
  throwsLB(() => makeDoc([{ type: "text", x: 0, y: 0 }]), /text must not be empty/);
  throwsLB(() => makeDoc([{ type: "arrow", start: { x: 0, y: 0 } }]), /end must be/);
  throwsLB(() => makeDoc({ pages: [] }), /non-empty/);
  throwsLB(() => makeDoc({ pages: [5] }));
  throwsLB(() => makeDoc({ app: "other" }));
  throwsLB(() => makeDoc({ app: "lite-board", version: 3, pages: [] }), /unsupported version/);
  throwsLB(() => makeDoc("x"));
});
await t("documents get the app's lenient loadDoc rules", () => {
  const doc = (pages, extra) => ({ app: "lite-board", version: 2, pages, ...extra });
  assert.equal(makeDoc(doc([{ name: "", shapes: [] }])).pages[0].name, "Page 1");
  assert.equal(makeDoc(doc([{ name: "a", shapes: [{ type: "text", x: 0, y: 0, text: "" }] }])).pages[0].shapes.length, 1);
  assert.deepEqual(makeDoc(doc([{ name: "a" }])).pages[0].shapes, []);
  assert.equal(makeDoc(doc([{ shapes: [] }], { current: 5 })).current, 0);
  throwsLB(() => makeDoc({ app: "lite-board", version: 2, shapes: [] }), /pages must be/);
  // new (non-document) input stays strict
  throwsLB(() => makeDoc({ pages: [{ name: " ", shapes: [] }] }), /name must not be empty/);
  throwsLB(() => makeDoc({ pages: [{ shapes: [] }], current: 3 }), /current must be/);
  assert.equal(makeDoc([{ type: "text", x: 0, y: 0, text: "x", wrap: 1, w: 50 }]).pages[0].shapes[0].wrap, true);
});
await t("makeDoc copies and drops unknown fields", () => {
  const src = [{ type: "rect", x: 0, y: 0, junk: 1, style: { color: "red" } }];
  const d = makeDoc(src); src[0].style.color = "blue";
  assert.deepEqual(d.pages[0].shapes[0], { type: "rect", x: 0, y: 0, style: { color: "red" } });
});
await t("link round trip", async () => {
  const url = await makeLink({ pages: [{ name: "Flow", shapes: FLOW }, { name: "Ideas", shapes: [{ type: "note", x: 0, y: 0, text: "한글 메모 ✨" }] }] });
  assert.ok(url.startsWith(APP_URL + "#b="));
  assert.match(url.split("#b=")[1], /^[A-Za-z0-9_-]+$/);
  const d = await readLink(url);
  assert.deepEqual(d.pages.map((p) => p.name), ["Flow", "Ideas"]);
  assert.equal(d.pages[1].shapes[0].text, "한글 메모 ✨");
  assert.deepEqual(d.pages[0].shapes[7].points, [[0, 400], [10, 410.1], [20, 400]]); // rounded to 0.1 like the app
  assert.ok((await makeLink(FLOW, { base: "http://localhost:8080/index.html#old" })).startsWith("http://localhost:8080/index.html#b="));
});
await t("readLink errors", async () => {
  await assert.rejects(readLink("https://x/"), /no #b=/);
  await assert.rejects(readLink("https://x/#b=AAAA"), /corrupted or truncated/);
  const { deflateRawSync } = await import("node:zlib");
  const junk = Buffer.concat([deflateRawSync(JSON.stringify({ app: "lite-board", version: 2, pages: [{ shapes: [] }] })), Buffer.from("zz")]);
  await assert.rejects(readLink("#b=" + junk.toString("base64url")), /corrupted or truncated/); // the app's browser decoder rejects it too
});
await t("toLiteboardFile is valid v2 JSON", () => {
  const o = JSON.parse(toLiteboardFile(FLOW));
  assert.deepEqual([o.app, o.version, o.pages[0].shapes.length], ["lite-board", 2, 8]);
});

/* CLI */
const cli = join(here, "cli.mjs");
const dir = mkdtempSync(join(tmpdir(), "lb-"));
await t("cli link / read / file", () => {
  writeFileSync(join(dir, "b.json"), JSON.stringify(FLOW));
  const url = execFileSync(process.execPath, [cli, "link", join(dir, "b.json")], { encoding: "utf8" }).trim();
  assert.ok(url.startsWith(APP_URL + "#b="));
  const back = JSON.parse(execFileSync(process.execPath, [cli, "read", url], { encoding: "utf8" }));
  assert.equal(back.pages[0].shapes.length, 8);
  execFileSync(process.execPath, [cli, "file", join(dir, "b.json"), join(dir, "o.liteboard")], { stdio: "pipe" });
  assert.equal(JSON.parse(readFileSync(join(dir, "o.liteboard"), "utf8")).version, 2);
  const piped = execFileSync(process.execPath, [cli, "link", "-"], { input: JSON.stringify({ shapes: FLOW }), encoding: "utf8" }).trim();
  assert.equal(piped, url);
  const eq = execFileSync(process.execPath, [cli, "link", "--base=http://h/x.html", join(dir, "b.json")], { encoding: "utf8" }).trim();
  assert.ok(eq.startsWith("http://h/x.html#b="));
  assert.throws(() => execFileSync(process.execPath, [cli, "link", join(dir, "b.json"), "--base"], { stdio: "pipe" }), (e) => e.status === 1 && /missing value for --base/.test(String(e.stderr)));
});
await t("cli stdin keeps multibyte text that spans chunks", async () => {
  const text = "가".repeat(100000) + "✨";
  const url = execFileSync(process.execPath, [cli, "link", "-"], { input: Buffer.from(JSON.stringify([{ type: "note", x: 0, y: 0, text }])), encoding: "utf8", maxBuffer: 1 << 26 }).trim();
  assert.equal((await readLink(url)).pages[0].shapes[0].text, text);
});
await t("cli reports invalid input", () => {
  writeFileSync(join(dir, "bad.json"), JSON.stringify([{ type: "rect" }]));
  assert.throws(() => execFileSync(process.execPath, [cli, "link", join(dir, "bad.json")], { stdio: "pipe" }), (e) => e.status === 1 && /liteBoard: shapes\[0\]\.x/.test(String(e.stderr)));
});

/* MCP over stdio */
await t("mcp initialize / tools/list / tools/call", async () => {
  const p = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "inherit"] }); kids.add(p);
  const pending = new Map(), stray = []; let buf = "";
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const h = pending.get(m.id); if (h) { pending.delete(m.id); h(m); } else stray.push(m); } });
  let n = 0;
  const rpc = (method, params) => new Promise((ok) => { const id = ++n; pending.set(id, ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(init.result.serverInfo.name, "lite-board");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const list = await rpc("tools/list", {});
  assert.deepEqual(list.result.tools.map((x) => x.name), ["create_board_link", "read_board_link", "read_board", "save_board_file", "edit_board", "render_board_image"]);
  const made = await rpc("tools/call", { name: "create_board_link", arguments: { shapes: FLOW } });
  assert.ok(!made.result.isError, made.result.content[0].text);
  const url = made.result.content[0].text.split("\n")[0];
  assert.ok(url.startsWith(APP_URL + "#b="));
  const read = await rpc("tools/call", { name: "read_board_link", arguments: { link: url } });
  assert.equal(JSON.parse(read.result.content[0].text).pages[0].shapes.length, 8);
  const bad = await rpc("tools/call", { name: "create_board_link", arguments: { shapes: [{ type: "rect" }] } });
  assert.ok(bad.result.isError && /liteBoard: /.test(bad.result.content[0].text));
  const unknown = await rpc("nope", {});
  assert.equal(unknown.error.code, -32601);
  assert.equal((await rpc("tools/call", { name: "zzz" })).error.code, -32602);
  const multi = await rpc("tools/call", { name: "create_board_link", arguments: { pages: [{ name: "A", shapes: [] }, { name: "B", shapes: FLOW }], current: 1 } });
  const back = JSON.parse((await rpc("tools/call", { name: "read_board_link", arguments: { link: multi.result.content[0].text.split("\n")[0] } })).result.content[0].text);
  assert.equal(back.current, 1);
  // notifications (no id) never get a response, even for request methods; malformed messages get -32600
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "ping" }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "create_board_link", arguments: { shapes: [] } } }) + "\n");
  const batch = new Promise((ok) => pending.set(null, ok));
  p.stdin.write(JSON.stringify([{ jsonrpc: "2.0", id: 99, method: "ping" }]) + "\n");
  assert.equal((await batch).error.code, -32600);
  const v = await rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(v.result.protocolVersion, "2025-06-18");
  assert.equal((await rpc("initialize", { protocolVersion: "2024-11-05" })).result.protocolVersion, "2024-11-05");

  // files: save in every format, read back, edit, render
  const call = async (name, args) => { const r = (await rpc("tools/call", { name, arguments: args })).result; return r; };
  for (const ext of ["liteboard", "tldr", "svg", "png"]) {
    const r = await call("save_board_file", { path: join(dir, "m." + ext), pages: [{ name: "Flow", shapes: FLOW }, { name: "Two", shapes: [{ type: "note", x: 0, y: 0, text: "둘" }] }] });
    assert.ok(!r.isError, r.content[0].text);
  }
  assert.ok((await call("save_board_file", { path: join(dir, "m.tldr"), shapes: FLOW })).isError, "no overwrite by default");
  assert.ok((await call("save_board_file", { path: join(dir, "m.tldr"), shapes: FLOW, overwrite: true })).content[0].text.startsWith("Saved"));
  assert.ok((await call("save_board_file", { path: join(dir, "m.doc"), shapes: FLOW })).isError);
  assert.ok(readFileSync(join(dir, "m.png")).subarray(1, 4).toString() === "PNG");
  assert.match(readFileSync(join(dir, "m.svg"), "utf8"), /^<svg /);
  const fromTldr = JSON.parse((await call("read_board", { source: join(dir, "m.tldr") })).content[0].text);
  assert.equal(fromTldr.pages[0].shapes.length, 8);
  const fromLb = JSON.parse((await call("read_board", { source: join(dir, "m.liteboard") })).content[0].text);
  assert.deepEqual(fromLb.pages.map((q) => q.name), ["Flow", "Two"]);
  const ed = await call("edit_board", { source: join(dir, "m.liteboard"), ops: [
    { method: "addShape", args: [{ type: "rect", x: 0, y: 500, text: "new" }, { page: "Two" }] },
    { method: "renamePage", args: [0, "First"] },
    { method: "deletePage", args: ["Two"] },
    { method: "undo" },
  ], save_to: join(dir, "e.tldr") });
  assert.ok(!ed.isError, ed.content[0].text);
  const edUrl = ed.content[0].text.split("\n")[0], back2 = await readLink(edUrl);
  assert.deepEqual(back2.pages.map((q) => [q.name, q.shapes.length]), [["First", 8], ["Two", 2]]);
  const bad2 = await call("edit_board", { shapes: FLOW, ops: [{ method: "addShape", args: [{ type: "rect" }] }] });
  assert.ok(bad2.isError && /ops\[0\] addShape: liteBoard: shape/.test(bad2.content[0].text), bad2.content[0].text);
  assert.ok((await call("edit_board", { ops: [{ method: "constructor" }] })).isError);
  const img = await call("render_board_image", { source: edUrl, page: "Two" });
  assert.equal(img.content[0].type, "image");
  assert.equal(Buffer.from(img.content[0].data, "base64").subarray(1, 4).toString(), "PNG");
  p.stdin.end();
  await new Promise((ok) => p.on("close", ok));
  assert.deepEqual(stray, [], "unexpected output: " + JSON.stringify(stray)); // nothing was sent for the notifications
});

/* Board: the app's window.liteBoard API without a browser */
await t("Board mirrors the app API: pages, shapes, undo jumps to the edited page", () => {
  const b = new Board();
  const ids = b.addShapes(FLOW, { select: true });
  assert.equal(b.getSelection().length, 8);
  const p2 = b.addPage("Ideas", { activate: false });
  assert.equal(b.currentPage().name, "Page 1");
  b.addShape({ type: "note", x: 0, y: 0, text: "x" }, { page: "Ideas" });
  assert.equal(b.undo(), true);
  assert.equal(b.currentPage().id, p2.id, "undo jumps to the page where the change is visible");
  assert.equal(b.getShapes().length, 0);
  b.redo(); assert.equal(b.getShapes().length, 1);
  b.switchPage(0);
  assert.equal(b.updateShape(ids[0], { style: { color: "red" } }).style.fill, "semi");
  const before = b.pages().length; b.updateShape(ids[0], { style: { color: "red" } }); // no-op is not an undo step
  b.undo(); assert.equal(b.getShape(ids[0]).style.color, "blue"); assert.equal(b.pages().length, before);
  assert.equal(b.moveShapes(ids.slice(0, 2), 10, 0), 2);
  assert.equal(b.getShape(ids[1]).start.x, 210);
  assert.equal(b.duplicate([ids[0]]).length, 1); assert.equal(b.getShapes().length, 9);
  assert.equal(b.copy([ids[0]]), 1); const pasted = b.paste({ page: 1 }); assert.equal(b.getShape(pasted[0]).x, 26);
  assert.equal(b.cut([ids[2]]), 1); assert.equal(b.getShape(ids[2]), null);
  b.selectAll(); b.setStyle({ dash: "dotted" }, { apply: true });
  assert.ok(b.getShapes().every((s) => s.style.dash === "dotted"));
  assert.equal(b.getStyle().dash, "dotted");
  assert.deepEqual(b.movePage(1, 0).map((q) => q.name), ["Ideas", "Page 1"]);
  assert.equal(b.renamePage("Ideas", " Idea ").name, "Idea");
  assert.equal(b.deletePage("Idea").length, 1);
  assert.throws(() => b.deletePage(0), /last page/);
  assert.throws(() => b.addShapes([{ type: "rect", x: 0 }]), /shapes\[0\]\.y/);
  assert.throws(() => b.setTool("pen"), /tool must be one of/);
  assert.equal(b.setCamera({ z: 100 }).z, 8);
  assert.ok(b.fit().z > 0);
  const t2 = b.getShapes().find((s) => s.type === "text");
  assert.ok(t2.w > 24 && t2.h > 0, "text is laid out (auto width)");
  const n = b.getShapes().length; assert.equal(b.clearPage(), n); assert.equal(b.getShapes().length, 0);
});
await t("Board import / export: .liteboard, .tldr, SVG, PNG, links round trip", async () => {
  const b = new Board({ pages: [{ name: "Flow", shapes: FLOW }, { name: "둘", shapes: [{ type: "note", x: 0, y: 0, text: "한글 ✨" }] }], current: 1 });
  assert.equal(b.currentPage().name, "둘");
  const lb = Board.fromText(b.toLiteboardFile());
  assert.deepEqual(lb.getDoc().pages.map((q) => q.shapes), b.getDoc().pages.map((q) => q.shapes), ".liteboard keeps everything (ids included)");
  const tl = Board.fromText(b.toTldrFile());
  assert.deepEqual(tl.pages().map((q) => [q.name, q.count]), [["Flow", 8], ["둘", 1]]);
  const types = (x) => x.getShapes({ page: 0 }).map((s) => s.type).join();
  assert.equal(types(tl), types(b));
  assert.equal(tl.getShapes({ page: 1 })[0].text, "한글 ✨");
  const r = readTldr(b.toTldrFile()); assert.equal(r.skipped, 0);
  assert.match(b.toSvg({ page: 0 }), /^<svg [^>]*><rect [^>]*fill="#ffffff"\/>/);
  assert.equal(b.toSvg({ page: 0, ids: [] }), null);
  const png = await b.toPng({ scale: 1 }); assert.equal(Buffer.from(png).subarray(1, 4).toString(), "PNG");
  await assert.rejects(b.toPng({ scale: 9 }), /scale must be/);
  const fromLink = await Board.fromLink(await b.getShareLink());
  assert.deepEqual(fromLink.pages().map((q) => q.count), [8, 1]);
  assert.equal(fromLink.currentPage().name, "둘");
  const imp = new Board(); assert.deepEqual(imp.importText("nope"), { ok: false, error: "parse" });
  assert.equal(imp.importText(JSON.stringify({ app: "lite-board", version: 2, pages: [{ name: "a", shapes: [{ type: "rect", x: 0, y: 0 }, { type: "zz" }] }] })).skipped, 1, "the app's Open skips invalid shapes");
  assert.equal(imp.undo(), true);
  assert.throws(() => Board.fromText('{"app":"lite-board","version":9}'), /unsupported/);
  assert.equal(toSvg(FLOW).startsWith("<svg"), true);
  assert.equal(JSON.parse(toTldrFile(FLOW)).records.filter((x) => x.typeName === "shape").length, 8);
  assert.equal(makeDoc(JSON.parse(toTldrFile(FLOW))).pages[0].shapes.length, 8, "makeDoc / makeLink accept .tldr objects");
});
await t("cli file formats and reading files", () => {
  writeFileSync(join(dir, "c.json"), JSON.stringify({ pages: [{ name: "A", shapes: FLOW }, { name: "B", shapes: [{ type: "rect", x: 0, y: 0 }] }] }));
  for (const ext of ["liteboard", "tldr", "svg", "png"]) execFileSync(process.execPath, [cli, "file", join(dir, "c.json"), join(dir, "c." + ext)], { stdio: "pipe" });
  const viaTldr = JSON.parse(execFileSync(process.execPath, [cli, "read", join(dir, "c.tldr")], { encoding: "utf8" }));
  assert.deepEqual(viaTldr.pages.map((q) => [q.name, q.shapes.length]), [["A", 8], ["B", 1]]);
  const one = JSON.parse(execFileSync(process.execPath, [cli, "read", join(dir, "c.liteboard"), "--page", "B"], { encoding: "utf8" }));
  assert.deepEqual(one.pages.map((q) => q.name), ["B"]);
  const url = execFileSync(process.execPath, [cli, "link", join(dir, "c.tldr")], { encoding: "utf8" }).trim();
  execFileSync(process.execPath, [cli, "file", url, join(dir, "d.png"), "--page=1", "--scale", "1"], { stdio: "pipe" });
  assert.equal(readFileSync(join(dir, "d.png")).subarray(1, 4).toString(), "PNG");
  execFileSync(process.execPath, [cli, "file", join(dir, "c.json"), join(dir, "d.out"), "--format", "tldr"], { stdio: "pipe" });
  assert.ok(Array.isArray(JSON.parse(readFileSync(join(dir, "d.out"), "utf8")).records));
  assert.throws(() => execFileSync(process.execPath, [cli, "file", join(dir, "c.json"), join(dir, "d.doc")], { stdio: "pipe" }), (e) => e.status === 1 && /unknown file type/.test(String(e.stderr)));
});
await t("review regressions: link-looking input, numeric page names, tldr import like the app", () => {
  // board JSON whose text contains a share link is still JSON (stdin), and an existing file named b=... is a file
  const withLink = JSON.stringify([{ type: "note", x: 0, y: 0, text: "old: https://x/#b=abc" }]);
  assert.equal(JSON.parse(execFileSync(process.execPath, [cli, "read", "-"], { input: withLink, encoding: "utf8" })).pages[0].shapes.length, 1);
  writeFileSync(join(dir, "b=draft.txt"), withLink);
  assert.equal(JSON.parse(execFileSync(process.execPath, [cli, "read", "b=draft.txt"], { cwd: dir, encoding: "utf8" })).pages[0].shapes.length, 1);
  // a page named "2" is picked by name; plain digits are an index otherwise
  writeFileSync(join(dir, "pg.json"), JSON.stringify({ pages: [{ name: "2", shapes: [] }, { name: "y", shapes: [] }, { name: "z", shapes: [] }] }));
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, "read", join(dir, "pg.json"), "--page", "2"], { encoding: "utf8" })).pages.map((q) => q.name), ["2"]);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, "read", join(dir, "pg.json"), "--page", "1"], { encoding: "utf8" })).pages.map((q) => q.name), ["y"]);
  // .tldr import follows the app: sizes 0 -> defaults, non-finite -> 0, a records file with another app field still imports
  const tl = (shape, extra) => JSON.stringify({ ...extra, records: [{ typeName: "page", id: "page:1", name: "P", index: "a1" }, { typeName: "shape", id: "shape:1", parentId: "page:1", index: "a1", ...shape }] });
  const g = Board.fromText(tl({ type: "geo", x: 1e999, y: 0, props: { geo: "rectangle", w: 50, h: 0, growY: 0 } })).getShapes()[0];
  assert.deepEqual([g.x, g.w, g.h], [0, 50, 100]);
  assert.equal(Board.fromText(tl({ type: "geo", x: 0, y: 0, props: { w: 10, h: 10 } }, { app: "x" })).getShapes().length, 1);
  assert.equal(Board.fromText(tl({ type: "note", x: 0, y: 0, props: {} })).getShapes()[0].style.dash, "solid", "tldraw notes have no dash");
  assert.equal(Board.fromText(tl({ type: "draw", x: 0, y: 0, props: { segments: [{ points: [{ x: 1, y: 1 }, null] }, { points: [{ x: 2, y: 2 }] }] } })).getShapes()[0].points.length, 1, "a bad segment is dropped whole");
  // v1 loadDoc errors use "doc." like the app; a non-integer current falls back to page 0
  assert.throws(() => new Board().loadDoc({ app: "lite-board", version: 1, shapes: [{ type: "rect", x: "a", y: 0 }] }), /liteBoard: doc\.shapes\[0\]\.x/);
  assert.equal(new Board({ app: "lite-board", version: 2, current: 0.5, pages: [{ name: "a", shapes: [] }, { name: "b", shapes: [] }] }).currentPage().name, "a");
  assert.equal(new Board().importText("﻿" + JSON.stringify({ app: "lite-board", version: 2, pages: [{ shapes: [] }] })).ok, true);
});

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
