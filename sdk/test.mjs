// node sdk/test.mjs: SDK + CLI + MCP smoke tests (no dependencies)
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { makeDoc, makeLink, readLink, toLiteboardFile, LiteBoardError, APP_URL } from "./lite-board.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error("FAIL", name, "\n ", e.message); process.exitCode = 1; } };
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
  const p = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map(), stray = []; let buf = "";
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); const h = pending.get(m.id); if (h) { pending.delete(m.id); h(m); } else stray.push(m); } });
  let n = 0;
  const rpc = (method, params) => new Promise((ok) => { const id = ++n; pending.set(id, ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(init.result.serverInfo.name, "lite-board");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const list = await rpc("tools/list", {});
  assert.deepEqual(list.result.tools.map((x) => x.name), ["create_board_link", "read_board_link"]);
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
  p.stdin.end();
  await new Promise((ok) => p.on("close", ok));
  assert.deepEqual(stray, [], "unexpected output: " + JSON.stringify(stray)); // nothing was sent for the notifications
});

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
