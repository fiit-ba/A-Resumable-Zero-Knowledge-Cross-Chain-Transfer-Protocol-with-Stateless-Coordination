#!/usr/bin/env node
/**
 * scripts/lib/hardhat-block-receipts-proxy.mjs
 *
 * A minimal HTTP proxy that wraps a Hardhat (or any EVM) JSON-RPC node and
 * implements eth_getBlockReceipts by synthesising the result from individual
 * eth_getTransactionReceipt calls.
 *
 * Hardhat does not expose eth_getBlockReceipts natively, but RISC Zero's
 * burn-proof host requires it to build the receipt trie.  This proxy sits in
 * front of Hardhat and satisfies that one method while forwarding everything
 * else untouched.
 *
 * Usage:
 *   node hardhat-block-receipts-proxy.mjs <upstream-rpc-url> [port]
 *
 * Examples:
 *   node hardhat-block-receipts-proxy.mjs http://127.0.0.1:8546 18546
 *   UPSTREAM=http://127.0.0.1:8546 PORT=18546 node hardhat-block-receipts-proxy.mjs
 */

import http from "node:http";
import { URL } from "node:url";

const upstreamUrl = process.argv[2] ?? process.env.UPSTREAM ?? "http://127.0.0.1:8546";
const port = parseInt(process.argv[3] ?? process.env.PORT ?? "18546", 10);

// ---------------------------------------------------------------------------
// Utility: forward a single JSON-RPC request to the upstream node.
// ---------------------------------------------------------------------------
async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const url = new URL(upstreamUrl);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + (url.search || ""),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Synthesise eth_getBlockReceipts via individual eth_getTransactionReceipt.
// ---------------------------------------------------------------------------
async function getBlockReceipts(blockParam) {
  // 1. Fetch the block to get its transaction hashes.
  const blockResp = await rpcCall("eth_getBlockByNumber", [blockParam, false]);
  if (blockResp.error) return { error: blockResp.error };
  if (!blockResp.result) return { result: [] };

  const txHashes = blockResp.result.transactions ?? [];
  if (txHashes.length === 0) return { result: [] };

  // 2. Fetch all receipts in parallel.
  const receipts = await Promise.all(
    txHashes.map(async (hash) => {
      const r = await rpcCall("eth_getTransactionReceipt", [hash]);
      return r.result ?? null;
    }),
  );

  return { result: receipts.filter(Boolean) };
}

// ---------------------------------------------------------------------------
// Body reader helper.
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Proxy: handle one JSON-RPC request (or batch).
// ---------------------------------------------------------------------------
async function handleRpc(requestBody) {
  const parsed = JSON.parse(requestBody);

  // Handle batch requests.
  if (Array.isArray(parsed)) {
    return Promise.all(parsed.map((item) => handleSingle(item)));
  }
  return handleSingle(parsed);
}

async function handleSingle(req) {
  const { id, jsonrpc, method, params } = req;

  if (method === "eth_getBlockReceipts") {
    const blockParam = params?.[0] ?? "latest";
    const { result, error } = await getBlockReceipts(blockParam);
    return error
      ? { jsonrpc, id, error }
      : { jsonrpc, id, result };
  }

  // Forward everything else to the upstream node.
  const body = JSON.stringify({ jsonrpc, id, method, params });
  const url = new URL(upstreamUrl);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + (url.search || ""),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const proxyReq = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(e);
        }
      });
    });
    proxyReq.on("error", reject);
    proxyReq.write(body);
    proxyReq.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP server.
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("eth_getBlockReceipts proxy — OK\n");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }

  try {
    const body = await readBody(req);
    const result = await handleRpc(body);
    const responseBody = JSON.stringify(result);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(responseBody),
    });
    res.end(responseBody);
  } catch (err) {
    console.error("[proxy] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: String(err.message) } }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[proxy] eth_getBlockReceipts proxy listening on http://127.0.0.1:${port}`);
  console.log(`[proxy] upstream: ${upstreamUrl}`);
});

server.on("error", (err) => {
  console.error("[proxy] server error:", err.message);
  process.exit(1);
});
