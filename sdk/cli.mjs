#!/usr/bin/env node
// lite-board command line: share links, .liteboard / .tldr / SVG / PNG files, reading boards, and an MCP server.
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createInterface } from "node:readline";
import { Board, makeLink, readLink, makeDoc, LONG_LINK, TYPES, COLORS, FILLS, DASHES, SIZES } from "./lite-board.mjs";

const VERSION = "1.1.0";
const HELP = `lite-board ${VERSION}

Usage:
  lite-board link <board>                        print a share link
  lite-board file <board> <out>                  save as .liteboard, .tldr, .svg or .png (by extension)
  lite-board read <board>                        print the board as .liteboard JSON
  lite-board mcp                                 run as an MCP server over stdio

<board> is a share link, a file (.liteboard, .tldr, or .json with an array of shapes,
{"shapes": [...]} or {"pages": [{"name", "shapes"}]}), or "-" for stdin. Shape format: sdk/README.md.
Options:
  --base <url>     app URL for links (default: the public lite-board site)
  --page <p>       file/read: one page (index, id or name); .svg/.png default to the current page
  --scale <k>      .png scale, 0-8 (default 2)
  --format <f>     liteboard | tldr | svg | png (instead of the extension)`;

/* ---------- boards from links, files or JSON ---------- */
const isLink = (s) => /^(https?:\/\/|file:\/\/|#|b=)/i.test(s) && /(?:^|[#&])b=[A-Za-z0-9_-]+/.test(s);
async function readStdin() { const parts = []; for await (const c of process.stdin) parts.push(c); return Buffer.concat(parts).toString("utf8"); } // concat first: a multibyte char may span chunks
/** A Board from a share link, a file path, "-" (stdin) or file text. */
async function loadBoard(src, { text } = {}) {
  if (typeof src !== "string" || !src) throw new Error("missing board (a share link, a file path, or - for stdin)");
  if (text != null) return Board.fromText(text);
  if (src === "-") { const t = await readStdin(), s = t.replace(/^﻿/, "").trim(); return /^[[{]/.test(s) || !isLink(s) ? Board.fromText(t) : Board.fromLink(s); } // JSON may contain links in its text
  let t;
  try { t = await readFile(resolve(src), "utf8"); }
  catch (e) { if (isLink(src)) return Board.fromLink(src); throw new Error(`cannot read ${src}: ${e.code || e.message}`); } // an existing file wins over a link-looking name
  try { return Board.fromText(t); } catch (e) { throw new Error(`${src}: ${e.message}`); }
}
const FORMATS = { ".liteboard": "liteboard", ".json": "liteboard", ".tldr": "tldr", ".svg": "svg", ".png": "png" };
const EXT = { liteboard: ".liteboard", tldr: ".tldr", svg: ".svg", png: ".png" };
function formatOf(path, format) {
  if (format != null) { if (!EXT[format]) throw new Error("format must be one of liteboard, tldr, svg, png"); return format; }
  const f = FORMATS[extname(path).toLowerCase()];
  if (!f) throw new Error(`unknown file type "${extname(path) || path}" (use .liteboard, .tldr, .svg or .png, or give a format)`);
  return f;
}
// CLI --page is always text: a page id or name wins, otherwise digits are an index. (MCP passes numbers and strings as given.)
const cliPage = (board, v) => { if (v == null) return undefined; const P = board.pages(); return P.some((p) => p.id === v || p.name === v) || !/^\d+$/.test(v) ? v : Number(v); };
/** Bytes or text of a board in a format. Pages: all for liteboard/tldr unless `page`; svg/png: `page` or the current page. */
async function render(board, format, { page, ids, scale } = {}) {
  if (format === "liteboard") {
    if (page == null) return board.toLiteboardFile();
    const id = pageInfo(board, page).id, d = board.getDoc();
    return JSON.stringify({ ...d, current: id, pages: d.pages.filter((q) => q.id === id) }, null, 1);
  }
  if (format === "tldr") return board.toTldrFile(page == null ? undefined : { page });
  if (format === "svg") { const s = board.toSvg({ page, ids }); if (s == null) throw new Error("nothing to draw: the page is empty"); return s; }
  const png = await board.toPng({ page, ids, scale }); if (png == null) throw new Error("nothing to draw: the page is empty");
  return png;
}
function pageInfo(board, page) { const P = board.pages(); const p = typeof page === "number" ? P[page] : P.find((q) => q.id === page) || P.find((q) => q.name === page); if (!p) throw new Error("page not found: " + JSON.stringify(page)); return p; }
async function save(board, path, { format, overwrite = true, ...o } = {}) {
  const f = formatOf(path, format), full = resolve(path), data = await render(board, f, o);
  if (!overwrite) { let exists = true; try { await access(full); } catch (_) { exists = false; } if (exists) throw new Error(`${full} already exists (set overwrite: true to replace it)`); }
  await writeFile(full, data);
  return { path: full, format: f, bytes: typeof data === "string" ? Buffer.byteLength(data) : data.length };
}

/* ---------- MCP server (JSON-RPC 2.0, newline-delimited over stdio; no dependencies) ---------- */
const SHAPE_HELP = `Coordinates are page units (like pixels), x grows right, y grows down; the app zooms to fit on open, so any range works. Shapes are drawn in array order (later = on top).
Shape types:
- {"type":"rect"|"ellipse","x","y","w","h","text"?}: box; optional text is a centered label. Default 100x100.
- {"type":"note","x","y","w"?,"h"?,"text"}: sticky note, default 200x200.
- {"type":"text","x","y","text"}: free text (width is automatic; add "wrap":true and "w" to wrap).
- {"type":"arrow"|"line","start":{"x","y"},"end":{"x","y"}}: arrow head at end.
- {"type":"draw","points":[[x,y],...]}: freehand / polyline.
Optional "style" on any shape: {"color": ${COLORS.join("|")}, "fill": ${FILLS.join("|")}, "dash": ${DASHES.join("|")}, "size": ${SIZES.join("|")}}. Defaults: black, none, solid, m.
Layout tip: for a flow chart use boxes about 200x80 spaced 80-120 apart, and arrows from one box edge to the next.`;
const SHAPES = { type: "array", items: { type: "object", properties: { type: { type: "string", enum: TYPES } }, required: ["type"] }, description: "Shapes for a single-page board. Use this, pages, or source." };
const PAGES = { type: "array", description: "Multi-page board (shown as sheet tabs). Use this, shapes, or source.", items: { type: "object", properties: { name: { type: "string" }, shapes: { type: "array", items: { type: "object" } } }, required: ["shapes"] } };
const CURRENT = { type: "integer", minimum: 0, description: "With pages: index of the page shown first (default 0)." };
const SOURCE = { type: "string", description: "An existing board: a lite-board share link (URL with #b=) or a file path (.liteboard, .tldr or board .json). Use this instead of shapes/pages." };
const PAGE = { type: ["integer", "string"], description: "One page: index (0-based), page id or page name." };
const BOARD_SCHEMA = { type: "object", properties: { shapes: SHAPES, pages: PAGES, current: CURRENT } };
const EDIT_METHODS = ["pages", "currentPage", "addPage", "switchPage", "renamePage", "deletePage", "movePage", "getShapes", "getShape", "addShapes", "addShape", "updateShape", "moveShapes", "deleteShapes", "clearPage", "duplicate", "copy", "cut", "paste", "getSelection", "select", "selectAll", "getCamera", "setCamera", "fit", "getTool", "setTool", "getStyle", "setStyle", "undo", "redo", "getDoc", "loadDoc", "newDoc", "importText", "toSvg"];
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2024-11-05"]; // newest first; 2025-03-26 is skipped because it requires JSON-RPC batching
const TOOLS_LIST = [
  {
    name: "create_board_link",
    title: "Create a lite-board whiteboard link",
    description: `Draw a diagram/whiteboard and get a lite-board link that opens it, ready to view and edit in any browser. Nothing is uploaded: the whole board is inside the link. Give the user the returned URL.\n${SHAPE_HELP}`,
    inputSchema: BOARD_SCHEMA,
  },
  {
    name: "read_board_link",
    title: "Read a lite-board link",
    description: "Read the board inside a lite-board share link (URL containing #b=). Returns the board as JSON ({pages:[{name, shapes}], current}) so it can be changed and passed to create_board_link.",
    inputSchema: { type: "object", properties: { link: { type: "string", description: "lite-board share link" } }, required: ["link"] },
  },
  {
    name: "read_board",
    title: "Read a lite-board board (link or file)",
    description: "Read a board from a share link or a file (.liteboard, .tldr from tldraw, or board .json). Returns {pages:[{id, name, shapes}], current, link}. .tldr import is partial like the app: geo, text, note, arrow (no bindings), line, draw/highlight; others are skipped.",
    inputSchema: { type: "object", properties: { source: SOURCE }, required: ["source"] },
  },
  {
    name: "save_board_file",
    title: "Save a lite-board board as a file",
    description: `Save a board to a file on this computer: .liteboard (lite-board's own format, opens with the app's Open or drag and drop), .tldr (opens in tldraw.com by dropping it on the canvas), .svg or .png (image of one page, white background). The format comes from the path's extension or "format". Give shapes/pages for a new board, or source to convert an existing link or file. Use an absolute path. Returns the saved path.\n${SHAPE_HELP}`,
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "Output file path ending in .liteboard, .tldr, .svg or .png (absolute path recommended)." },
      format: { type: "string", enum: ["liteboard", "tldr", "svg", "png"], description: "Overrides the extension." },
      source: SOURCE, shapes: SHAPES, pages: PAGES, current: CURRENT,
      page: { ...PAGE, description: "One page only (index, id or name). Default: all pages for .liteboard/.tldr, the current page for .svg/.png." },
      ids: { type: "array", items: { type: "string" }, description: ".svg/.png: only these shape ids." },
      scale: { type: "number", exclusiveMinimum: 0, maximum: 8, description: ".png scale (default 2)." },
      overwrite: { type: "boolean", description: "Replace an existing file (default false)." },
    }, required: ["path"] },
  },
  {
    name: "edit_board",
    title: "Edit a lite-board board",
    description: `Run lite-board editing operations on a board (an existing link/file via source, or shapes/pages, or an empty board), in order, exactly like the app's window.liteBoard API, then return the results and a new share link (and optionally save a file).
Each op is {"method": name, "args": [...]}. Methods: ${EDIT_METHODS.join(", ")}.
Key signatures: addShapes(shapes, {page?, select?}) -> ids; addShape(shape, {page?}) -> id; updateShape(id, patch) (style merges per key); moveShapes(ids, dx, dy); deleteShapes(ids); clearPage(page?); duplicate(ids?, {offset?}); copy(ids?)/cut(ids?)/paste({page?}); addPage(name?, {activate?}); switchPage(page); renamePage(page, name); deletePage(page); movePage(page, index); select(ids); selectAll(); setStyle(style, {apply?: true restyles the selection}); setCamera({x?,y?,z?}); fit(); undo(); redo(); getShapes({page?}); toSvg({page?, ids?}).
Pages are given as index, id or name. Every op that changes the board is one undo step. If an op fails, nothing after it runs and the error says which op.
${SHAPE_HELP}`,
    inputSchema: { type: "object", properties: {
      source: SOURCE, shapes: SHAPES, pages: PAGES, current: CURRENT,
      ops: { type: "array", items: { type: "object", properties: { method: { type: "string", enum: EDIT_METHODS }, args: { type: "array" } }, required: ["method"] } },
      save_to: { type: "string", description: "Also save the result to this file (.liteboard, .tldr, .svg or .png)." },
      format: { type: "string", enum: ["liteboard", "tldr", "svg", "png"] },
      overwrite: { type: "boolean", description: "With save_to: replace an existing file (default false)." },
    }, required: ["ops"] },
  },
  {
    name: "render_board_image",
    title: "Look at a lite-board board",
    description: "Render one page of a board as a PNG image so you can see it (check a layout before giving the link). Give source (link or file) or shapes/pages.",
    inputSchema: { type: "object", properties: { source: SOURCE, shapes: SHAPES, pages: PAGES, current: CURRENT, page: PAGE, ids: { type: "array", items: { type: "string" } }, scale: { type: "number", exclusiveMinimum: 0, maximum: 8, description: "default 1" } } },
  },
];

async function boardFromArgs(a) {
  if (a.source != null) {
    if (a.shapes != null || a.pages != null) throw new Error("give either source or shapes/pages, not both");
    return loadBoard(a.source);
  }
  if (a.pages != null) return new Board({ pages: a.pages, current: a.current });
  if (a.shapes != null) return new Board({ shapes: a.shapes });
  return null;
}
const summary = (board, url) => { const P = board.pages(), n = P.reduce((s, p) => s + p.count, 0); return `(${P.length} page${P.length > 1 ? "s" : ""}, ${n} shape${n === 1 ? "" : "s"}, ${Math.ceil(url.length / 1024)} KB link.${url.length > LONG_LINK ? " Warning: the link is long and may be cut off in some messengers." : ""})`; };

async function callTool(name, args, base) {
  const a = args || {};
  if (name === "create_board_link") {
    const input = a.pages != null ? { pages: a.pages, current: a.current } : { shapes: a.shapes };
    const doc = makeDoc(input), url = await makeLink(doc, { base });
    const n = doc.pages.reduce((s, p) => s + p.shapes.length, 0);
    const note = url.length > LONG_LINK ? " Warning: the link is long and may be cut off in some messengers." : "";
    return text(`${url}\n\n(${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""}, ${n} shape${n === 1 ? "" : "s"}, ${Math.ceil(url.length / 1024)} KB link.${note})`);
  }
  if (name === "read_board_link") {
    if (typeof a.link !== "string") throw new Error("link must be a string");
    const doc = await readLink(a.link);
    return text(JSON.stringify({ pages: doc.pages, current: doc.current }, null, 1));
  }
  if (name === "read_board") {
    if (typeof a.source !== "string") throw new Error("source must be a string");
    const b = await loadBoard(a.source), d = b.getDoc();
    return text(JSON.stringify({ pages: d.pages.map(({ id, name, shapes }) => ({ id, name, shapes })), current: b.currentPage().index, link: await b.getShareLink({ base }) }, null, 1));
  }
  if (name === "save_board_file") {
    if (typeof a.path !== "string" || !a.path) throw new Error("path must be a file path");
    const b = await boardFromArgs(a); if (!b) throw new Error("give shapes, pages or source");
    const r = await save(b, a.path, { format: a.format, overwrite: !!a.overwrite, page: a.page, ids: a.ids, scale: a.scale });
    return text(`Saved ${r.path} (${r.format}, ${r.bytes} bytes).`);
  }
  if (name === "edit_board") {
    if (!Array.isArray(a.ops)) throw new Error("ops must be an array of {method, args}");
    const b = (await boardFromArgs(a)) || new Board(), results = [];
    for (const [i, op] of a.ops.entries()) {
      if (!op || !EDIT_METHODS.includes(op.method)) throw new Error(`ops[${i}].method must be one of ${EDIT_METHODS.join(", ")}`);
      if (op.args != null && !Array.isArray(op.args)) throw new Error(`ops[${i}].args must be an array`);
      try { results.push(b[op.method](...(op.args || []))); } catch (e) { throw new Error(`ops[${i}] ${op.method}: ${e.message}`); }
    }
    const url = await b.getShareLink({ base });
    let saved = "";
    if (a.save_to) { const r = await save(b, a.save_to, { format: a.format, overwrite: !!a.overwrite }); saved = `\nSaved ${r.path} (${r.format}).`; }
    return text(`${url}\n\n${summary(b, url)}${saved}\nResults: ${JSON.stringify(results)}`);
  }
  if (name === "render_board_image") {
    const b = await boardFromArgs(a); if (!b) throw new Error("give shapes, pages or source");
    const png = await b.toPng({ page: a.page, ids: a.ids, scale: a.scale == null ? 1 : a.scale });
    if (!png) throw new Error("nothing to draw: the page is empty");
    return { content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }] };
  }
}
const text = (t) => ({ content: [{ type: "text", text: t }] });

function runMcp(base) {
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
  const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return error(null, -32700, "Parse error"); }
    const okId = (v) => typeof v === "string" || typeof v === "number";
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      // responses from the client (no method) are not expected; anything else malformed is an Invalid Request
      if (msg && typeof msg === "object" && !Array.isArray(msg) && msg.method === undefined && ("result" in msg || "error" in msg)) return;
      return error(msg && okId(msg.id) ? msg.id : null, -32600, "Invalid Request");
    }
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications (initialized, cancelled, ...) never get a response
    try {
      switch (method) {
        case "initialize": {
          const want = params && params.protocolVersion;
          return reply(id, { protocolVersion: SUPPORTED_PROTOCOLS.includes(want) ? want : SUPPORTED_PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: "lite-board", version: VERSION },
            instructions: "Use create_board_link to draw diagrams, flow charts, wireframes or sticky-note boards for the user; answer with the returned link. save_board_file saves .liteboard / .tldr (tldraw) / .svg / .png files; edit_board changes an existing board (link or file) with the app's editing operations; read_board reads links and files; render_board_image lets you look at a board." });
        }
        case "ping": return reply(id, {});
        case "tools/list": return reply(id, { tools: TOOLS_LIST });
        case "tools/call": {
          const name = params && params.name;
          if (!TOOLS_LIST.some((t) => t.name === name)) return error(id, -32602, "Unknown tool: " + name);
          try { return reply(id, await callTool(name, (params && params.arguments) || {}, base)); }
          catch (e) { return reply(id, { content: [{ type: "text", text: e.message }], isError: true }); } // tool errors go back to the model
        }
        default: return error(id, -32601, "Method not found: " + method);
      }
    } catch (e) { error(id, -32603, e.message); }
  });
}

/* ---------- main ---------- */
const argv = process.argv.slice(2), opt = {};
try {
  for (const k of ["base", "page", "scale", "format"]) {
    const i = argv.findIndex((x) => x === "--" + k || x.startsWith(`--${k}=`));
    if (i < 0) continue;
    const eq = argv[i].startsWith(`--${k}=`), v = eq ? argv[i].slice(k.length + 3) : argv[i + 1];
    if (!v || (!eq && v.startsWith("--"))) throw new Error(`missing value for --${k}`);
    opt[k] = v; argv.splice(i, eq ? 1 : 2);
  }
  if (opt.scale != null) { opt.scale = Number(opt.scale); if (!(opt.scale > 0 && opt.scale <= 8)) throw new Error("--scale must be a number in (0, 8]"); }
} catch (e) { process.stderr.write("error: " + e.message + "\n"); process.exit(1); }
const [cmd, a, b] = argv;
try {
  if (cmd === "link") {
    const url = await (await loadBoard(a)).getShareLink({ base: opt.base });
    process.stdout.write(url + "\n");
    if (url.length > LONG_LINK) process.stderr.write(`warning: link is ${Math.ceil(url.length / 1024)} KB and may be cut off in some messengers\n`);
  } else if (cmd === "file") {
    if (!b) throw new Error("missing output path");
    const board = await loadBoard(a);
    const r = await save(board, b, { format: opt.format, page: cliPage(board, opt.page), scale: opt.scale });
    process.stderr.write(`wrote ${r.path}\n`);
  } else if (cmd === "read") {
    const board = await loadBoard(a || "");
    process.stdout.write((opt.page != null ? await render(board, "liteboard", { page: cliPage(board, opt.page) }) : board.toLiteboardFile()) + "\n");
  } else if (cmd === "mcp") runMcp(opt.base);
  else if (cmd === "--version" || cmd === "-v") process.stdout.write(VERSION + "\n");
  else { process.stdout.write(HELP + "\n"); if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1; }
} catch (e) {
  process.stderr.write("error: " + e.message + "\n");
  process.exitCode = 1;
}
