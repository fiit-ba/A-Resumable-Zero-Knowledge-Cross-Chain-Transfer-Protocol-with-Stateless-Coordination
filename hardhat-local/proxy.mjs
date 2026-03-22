#!/usr/bin/env node
/**
 * eth_getBlockReceipts proxy for Hardhat.
 *
 * Hardhat does not support eth_getBlockReceipts, which risc0-steel requires
 * to build receipt tries for event proofs.  This proxy listens on PROXY_PORT
 * (default 18546), forwards all requests to Hardhat on HARDHAT_INNER_PORT
 * (default 8546), and implements eth_getBlockReceipts by combining
 * eth_getBlockByHash / eth_getBlockByNumber with per-tx eth_getTransactionReceipt
 * calls.
 *
 * Supported eth_getBlockReceipts param shapes:
 *   - bare hash string  "0x<64hex>"             → eth_getBlockByHash
 *   - EIP-1898 object   { blockHash: "0x..." }  → eth_getBlockByHash
 *   - hex number/tag    "0x1a" / "latest"        → eth_getBlockByNumber
 *   - EIP-1898 object   { blockNumber: "0x..." } → eth_getBlockByNumber
 *   - unsupported shape                          → -32602 Invalid params
 *
 * Usage (environment variables):
 *   HARDHAT_INNER_PORT  Port where Hardhat is listening  (default 8546)
 *   PROXY_PORT          Port this proxy listens on        (default 18546)
 */
import http from 'http';

const HARDHAT_PORT = parseInt(process.env.HARDHAT_INNER_PORT ?? '8546', 10);
const PROXY_PORT   = parseInt(process.env.PROXY_PORT          ?? '18546', 10);

// ── helpers ───────────────────────────────────────────────────────────────────

/** Send a single JSON-RPC call to the inner Hardhat node. */
async function callInner(method, params, id = 1) {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: HARDHAT_PORT,
                path: '/',
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(body),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) {
                        reject(new Error(
                            `Failed to parse inner response for ${method}: ${data.slice(0, 300)}`
                        ));
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/** Proxy a raw request body to the inner Hardhat node, returning status + headers + body. */
function proxyRaw(rawBody, incomingHeaders) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: HARDHAT_PORT,
                path: '/',
                method: 'POST',
                headers: { ...incomingHeaders, host: `127.0.0.1:${HARDHAT_PORT}` },
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                    })
                );
            }
        );
        req.on('error', reject);
        req.write(rawBody);
        req.end();
    });
}

// ── eth_getBlockReceipts implementation ───────────────────────────────────────

// Block hash: 0x followed by exactly 64 hex characters (66 chars total).
const BLOCK_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Normalize an eth_getBlockReceipts parameter to a [method, args] pair.
 *
 * Accepts:
 *   "0x<64hex>"              → eth_getBlockByHash
 *   { blockHash: "0x..." }   → eth_getBlockByHash  (EIP-1898)
 *   "0x1a" / "latest" / …   → eth_getBlockByNumber
 *   { blockNumber: "0x..." } → eth_getBlockByNumber (EIP-1898)
 *
 * Returns null for any shape that is not one of the above.
 */
function resolveBlockSelector(blockRef) {
    // EIP-1898 object form
    if (blockRef !== null && typeof blockRef === 'object') {
        if (typeof blockRef.blockHash === 'string') {
            return ['eth_getBlockByHash', [blockRef.blockHash, false]];
        }
        if (typeof blockRef.blockNumber === 'string') {
            return ['eth_getBlockByNumber', [blockRef.blockNumber, false]];
        }
        return null; // unsupported object shape
    }
    // String form
    if (typeof blockRef === 'string') {
        if (BLOCK_HASH_RE.test(blockRef)) {
            return ['eth_getBlockByHash', [blockRef, false]];
        }
        // hex block number ("0x1a") or named tag ("latest", "earliest", "pending", …)
        return ['eth_getBlockByNumber', [blockRef, false]];
    }
    return null; // unsupported type (number literal, null explicit, etc.)
}

async function ethGetBlockReceipts(params, id) {
    const blockRef = params?.[0] ?? 'latest';

    const selector = resolveBlockSelector(blockRef);
    if (!selector) {
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code: -32602,
                message: `eth_getBlockReceipts: unsupported block selector: ${JSON.stringify(blockRef)}`,
            },
        };
    }

    const [method, args] = selector;
    const blockResp = await callInner(method, args);
    const block = blockResp?.result ?? null;
    if (!block) {
        return { jsonrpc: '2.0', id, result: null };
    }

    const txHashes = block.transactions ?? [];

    // Fetch each receipt individually.
    const receiptResults = await Promise.all(
        txHashes.map((txHash, i) =>
            callInner('eth_getTransactionReceipt', [txHash], 100 + i)
                .then((r) => r?.result ?? null)
        )
    );

    return { jsonrpc: '2.0', id, result: receiptResults.filter((r) => r != null) };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
        const rawBody = Buffer.concat(chunks);

        try {
            // Parse request (may fail for non-JSON bodies — just proxy them).
            let parsed = null;
            try { parsed = JSON.parse(rawBody.toString()); } catch (_) { /* ignore */ }

            if (parsed?.method === 'eth_getBlockReceipts') {
                const result = await ethGetBlockReceipts(parsed.params, parsed.id);
                const out = JSON.stringify(result);
                res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out) });
                res.end(out);
                return;
            }

            // Forward everything else to Hardhat unchanged.
            const { status, headers, body } = await proxyRaw(rawBody, req.headers);
            // Node.js auto-de-chunks Transfer-Encoding:chunked responses before
            // handing us the assembled body.  Strip that header and set the real
            // content-length so clients don't try to re-parse as chunked.
            const safeHeaders = {};
            for (const [k, v] of Object.entries(headers)) {
                if (k.toLowerCase() !== 'transfer-encoding') {
                    safeHeaders[k] = v;
                }
            }
            safeHeaders['content-length'] = String(body.length);
            res.writeHead(status, safeHeaders);
            res.end(body);
        } catch (err) {
            process.stderr.write(`[proxy] Error: ${err.message}\n`);
            const errBody = JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: String(err.message) },
            });
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(errBody);
        }
    });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
    process.stderr.write(
        `[proxy] eth_getBlockReceipts proxy listening on :${PROXY_PORT}, ` +
        `forwarding to Hardhat on :${HARDHAT_PORT}\n`
    );
});
