#!/usr/bin/env node
// lite-board command line: make share links / .liteboard files from JSON, read links, or run an MCP server.
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { makeLink, readLink, toLiteboardFile, makeDoc, LONG_LINK, TYPES, COLORS, FILLS, DASHES, SIZES } from "./lite-board.mjs";

const VERSION = "1.0.0";
const HELP = `lite-board ${VERSION}

Usage:
  lite-board link <board.json | ->        print a share link for the board
  lite-board file <board.json | -> <out.liteboard>
                                          write a .liteboard file
  lite-board read <link>                  print the board inside a share link as JSON
  lite-board mcp                          run as an MCP server over stdio

board.json is an array of shapes, {"shapes": [...]}, {"pages": [{"name", "shapes"}]},
or a .liteboard document. "-" reads from stdin. Shape format: see sdk/README.md.
Options: --base <url>   app URL for links (default: the public lite-board site)`;

async function readInput(src) {
  if (!src) throw new Error("missing input file (use - for stdin)");
  let text = "";
  if (src === "-") { const parts = []; for await (const c of process.stdin) parts.push(c); text = Buffer.concat(parts).toString("utf8"); } // concat first: a multibyte char may span chunks
  else text = await readFile(src, "utf8");
  try { return JSON.parse(text.replace(/^﻿/, "")); } catch (e) { throw new Error(`${src === "-" ? "stdin" : src} is not valid JSON: ${e.message}`); }
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
const BOARD_SCHEMA = {
  type: "object",
  properties: {
    shapes: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: TYPES } }, required: ["type"] }, description: "Shapes for a single-page board. Use this or pages." },
    pages: { type: "array", description: "Multi-page board (shown as sheet tabs). Use this or shapes.", items: { type: "object", properties: { name: { type: "string" }, shapes: { type: "array", items: { type: "object" } } }, required: ["shapes"] } },
    current: { type: "integer", minimum: 0, description: "With pages: index of the page shown first (default 0)." },
  },
};
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2024-11-05"]; // newest first; 2025-03-26 is skipped because it requires JSON-RPC batching
const TOOLS = [
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
];

async function callTool(name, args, base) {
  if (name === "create_board_link") {
    const input = args && args.pages != null ? { pages: args.pages, current: args.current } : { shapes: args && args.shapes };
    const doc = makeDoc(input), url = await makeLink(doc, { base });
    const n = doc.pages.reduce((a, p) => a + p.shapes.length, 0);
    const note = url.length > LONG_LINK ? " Warning: the link is long and may be cut off in some messengers." : "";
    return `${url}\n\n(${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""}, ${n} shape${n === 1 ? "" : "s"}, ${Math.ceil(url.length / 1024)} KB link.${note})`;
  }
  if (name === "read_board_link") {
    if (!args || typeof args.link !== "string") throw new Error("link must be a string");
    const doc = await readLink(args.link);
    return JSON.stringify({ pages: doc.pages, current: doc.current }, null, 1);
  }
}

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
            instructions: "Use create_board_link to draw diagrams, flow charts, wireframes or sticky-note boards for the user; answer with the returned link." });
        }
        case "ping": return reply(id, {});
        case "tools/list": return reply(id, { tools: TOOLS });
        case "tools/call": {
          const name = params && params.name;
          if (!TOOLS.some((t) => t.name === name)) return error(id, -32602, "Unknown tool: " + name);
          try { return reply(id, { content: [{ type: "text", text: await callTool(name, (params && params.arguments) || {}, base) }] }); }
          catch (e) { return reply(id, { content: [{ type: "text", text: e.message }], isError: true }); } // tool errors go back to the model
        }
        default: return error(id, -32601, "Method not found: " + method);
      }
    } catch (e) { error(id, -32603, e.message); }
  });
}

/* ---------- main ---------- */
const argv = process.argv.slice(2);
let base;
try {
  const bi = argv.findIndex((x) => x === "--base" || x.startsWith("--base="));
  if (bi >= 0) {
    const eq = argv[bi].startsWith("--base="), v = eq ? argv[bi].slice(7) : argv[bi + 1];
    if (!v || (!eq && v.startsWith("-"))) throw new Error("missing value for --base");
    base = v; argv.splice(bi, eq ? 1 : 2);
  }
} catch (e) { process.stderr.write("error: " + e.message + "\n"); process.exit(1); }
const [cmd, a, b] = argv;
try {
  if (cmd === "link") {
    const url = await makeLink(await readInput(a), { base });
    process.stdout.write(url + "\n");
    if (url.length > LONG_LINK) process.stderr.write(`warning: link is ${Math.ceil(url.length / 1024)} KB and may be cut off in some messengers\n`);
  } else if (cmd === "file") {
    if (!b) throw new Error("missing output path");
    await writeFile(b, toLiteboardFile(await readInput(a)));
    process.stderr.write(`wrote ${b}\n`);
  } else if (cmd === "read") {
    process.stdout.write(JSON.stringify(await readLink(a || ""), null, 1) + "\n");
  } else if (cmd === "mcp") runMcp(base);
  else if (cmd === "--version" || cmd === "-v") process.stdout.write(VERSION + "\n");
  else { process.stdout.write(HELP + "\n"); if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1; }
} catch (e) {
  process.stderr.write("error: " + e.message + "\n");
  process.exitCode = 1;
}
