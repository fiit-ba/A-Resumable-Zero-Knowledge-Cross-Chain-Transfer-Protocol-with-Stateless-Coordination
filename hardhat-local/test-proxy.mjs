#!/usr/bin/env node
/**
 * Smoke test for hardhat-local/proxy.mjs
 *
 * Requires:
 *   - Hardhat running on HARDHAT_PORT (default 8546)
 *   - proxy.mjs NOT already running on PROXY_PORT (default 18546)
 *
 * Usage:
 *   node hardhat-local/test-proxy.mjs
 *
 * The test:
 *   1. Starts the proxy as a child process.
 *   2. Mines one transaction via the proxy (eth_sendTransaction → eth_mine).
 *   3. Asserts eth_getBlockReceipts returns the receipt for all three selector shapes:
 *        - bare hash string      "0x<64hex>"
 *        - EIP-1898 blockHash    { blockHash: "0x..." }
 *        - EIP-1898 blockNumber  { blockNumber: "0x..." }
 *   4. Asserts unsupported selector returns -32602.
 *   5. Kills the proxy and exits 0 on success, 1 on any failure.
 */
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HARDHAT_PORT = parseInt(process.env.HARDHAT_PORT ?? '8546', 10);
const PROXY_PORT   = parseInt(process.env.PROXY_PORT   ?? '18546', 10);
const HARDHAT_URL  = `http://127.0.0.1:${HARDHAT_PORT}`;
const PROXY_URL    = `http://127.0.0.1:${PROXY_PORT}`;

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

let _reqId = 1;
function rpc(url, method, params) {
    const id = _reqId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: parseInt(u.port, 10),
                path: '/',
                method: 'POST',
                headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
            },
            (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error(`Bad JSON from ${method}: ${data.slice(0, 200)}`)); }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Wait for a port to accept HTTP ───────────────────────────────────────────

function waitForPort(url, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        function attempt() {
            const req = http.get(url, (res) => { res.resume(); resolve(); });
            req.on('error', () => {
                if (Date.now() >= deadline) { reject(new Error(`Timed out waiting for ${url}`)); return; }
                setTimeout(attempt, 200);
            });
            req.end();
        }
        attempt();
    });
}

// ── Assertion helper ──────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;
function assert(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        _passed++;
    } else {
        console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
        _failed++;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

let proxyProc = null;

async function main() {
    // 1. Start the proxy.
    const proxyScript = join(__dirname, 'proxy.mjs');
    proxyProc = spawn(process.execPath, [proxyScript], {
        env: {
            ...process.env,
            HARDHAT_INNER_PORT: String(HARDHAT_PORT),
            PROXY_PORT: String(PROXY_PORT),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    proxyProc.on('exit', (code) => {
        if (code !== null && code !== 0) {
            console.error(`[test] Proxy exited with code ${code}`);
        }
    });

    console.log(`[test] Waiting for proxy on ${PROXY_URL} …`);
    await waitForPort(PROXY_URL);
    console.log('[test] Proxy is up.\n');

    // 2. Get the account list from Hardhat (to have a sender).
    const accountsResp = await rpc(PROXY_URL, 'eth_accounts', []);
    const sender = accountsResp?.result?.[0];
    if (!sender) {
        throw new Error('eth_accounts returned no accounts — is Hardhat running?');
    }

    // 3. Send a transaction so the next block has at least one receipt.
    await rpc(PROXY_URL, 'eth_sendTransaction', [{
        from: sender,
        to: sender,
        value: '0x0',
    }]);
    // Mine it immediately.
    await rpc(PROXY_URL, 'evm_mine', []);

    // 4. Get the latest block.
    const latestResp = await rpc(PROXY_URL, 'eth_getBlockByNumber', ['latest', false]);
    const block = latestResp?.result;
    if (!block) {
        throw new Error(`eth_getBlockByNumber(latest) returned null`);
    }
    const blockHash   = block.hash;
    const blockNumber = block.number; // hex string e.g. "0x16"

    console.log(`[test] Latest block: number=${blockNumber}  hash=${blockHash}`);
    console.log(`[test] Transactions in block: ${block.transactions.length}\n`);

    // ── Test cases ────────────────────────────────────────────────────────────
    console.log('--- bare hash string ---');
    const r1 = await rpc(PROXY_URL, 'eth_getBlockReceipts', [blockHash]);
    assert('returns result array',     Array.isArray(r1?.result),          JSON.stringify(r1));
    assert('no error field',           !r1?.error,                         JSON.stringify(r1?.error));
    assert('receipt count matches tx', r1.result.length === block.transactions.length,
           `got ${r1.result.length}, expected ${block.transactions.length}`);

    console.log('\n--- EIP-1898 blockHash object ---');
    const r2 = await rpc(PROXY_URL, 'eth_getBlockReceipts', [{ blockHash }]);
    assert('returns result array',     Array.isArray(r2?.result),          JSON.stringify(r2));
    assert('no error field',           !r2?.error,                         JSON.stringify(r2?.error));
    assert('same receipts as bare hash',
           JSON.stringify(r2.result) === JSON.stringify(r1.result), '');

    console.log('\n--- EIP-1898 blockNumber object ---');
    const r3 = await rpc(PROXY_URL, 'eth_getBlockReceipts', [{ blockNumber }]);
    assert('returns result array',     Array.isArray(r3?.result),          JSON.stringify(r3));
    assert('no error field',           !r3?.error,                         JSON.stringify(r3?.error));
    assert('same receipts as bare hash',
           JSON.stringify(r3.result) === JSON.stringify(r1.result), '');

    console.log('\n--- hex block number string ---');
    const r4 = await rpc(PROXY_URL, 'eth_getBlockReceipts', [blockNumber]);
    assert('returns result array',     Array.isArray(r4?.result),          JSON.stringify(r4));
    assert('no error field',           !r4?.error,                         JSON.stringify(r4?.error));

    console.log('\n--- unsupported selector (integer literal) ---');
    const r5 = await rpc(PROXY_URL, 'eth_getBlockReceipts', [42]);
    assert('returns -32602 error',     r5?.error?.code === -32602,         JSON.stringify(r5));
    assert('no result field',          r5?.result === undefined,           JSON.stringify(r5));

    console.log('\n--- "latest" tag ---');
    const r6 = await rpc(PROXY_URL, 'eth_getBlockReceipts', ['latest']);
    assert('returns result array',     Array.isArray(r6?.result),          JSON.stringify(r6));
    assert('no error field',           !r6?.error,                         JSON.stringify(r6?.error));

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`\n${_passed + _failed} assertions: ${_passed} passed, ${_failed} failed.`);
}

main()
    .catch((err) => {
        console.error(`[test] Fatal: ${err.message}`);
        _failed++;
    })
    .finally(() => {
        if (proxyProc) {
            proxyProc.kill();
        }
        process.exit(_failed > 0 ? 1 : 0);
    });
