// ── Meta Account Creator — Single File Edition ────────────────
// Contains Orchestrator, Worker, and API Logic in one file
// Features: Auto-dependency installation, Interactive CLI
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isMainThread } = require('worker_threads');

// ── 1. Auto-Dependency Installation (Main Thread Only) ───────
if (isMainThread) {
    const requiredModules = ['https-proxy-agent', 'socks-proxy-agent', 'chalk'];
    let missingModules = false;
    for (const mod of requiredModules) {
        try {
            require.resolve(mod);
        } catch (e) {
            missingModules = true;
            break;
        }
    }

    if (missingModules) {
        console.log('\n[SETUP] First time setup: Installing required dependencies...');
        try {
            execSync('npm install https-proxy-agent socks-proxy-agent chalk@4', { stdio: 'inherit' });
            console.log('[SETUP] Dependencies installed successfully!\n');
        } catch (e) {
            console.error('[ERROR] Failed to install dependencies. Make sure Node.js and NPM are installed properly.');
            process.exit(1);
        }
    }
}

// ── 2. Imports ────────────────────────────────────────────────
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const chalk = require('chalk');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Keep-alive agent — reuses TCP connections across API calls for the same host
// Saves ~50-100ms per request (no TCP handshake for each API call)
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50, timeout: 30000 });

// ── 2.5 NexaOTP Engine ──────────────────────────────────────────
class NexaRateLimiter {
    constructor(delayMs) {
        this.delayMs = delayMs;
        this.queue = [];
        this.processing = false;
    }
    enqueue(task) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try { resolve(await task()); } catch (e) { reject(e); }
            });
            if (!this.processing) this._process();
        });
    }
    async _process() {
        this.processing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            await task();
            await new Promise(r => setTimeout(r, this.delayMs));
        }
        this.processing = false;
    }
}
const nexaLimiter = new NexaRateLimiter(500);

// ── Voltx / Stex (2oo9.cloud) Constants ───────────────────────
const VOLTX_KEY_FILE = path.join(__dirname, 'voltx_key.txt');
const STEX_KEY_FILE = path.join(__dirname, 'stex_key.txt');
const TWOOO_HOST = 'api.2oo9.cloud';
const TWOOO_VOLTX_GET = '/MXS47FLFX0U/tnevs/@public/api/getnum';
const TWOOO_VOLTX_CONSOLE = '/MXS47FLFX0U/tnevs/@public/api/console';
const TWOOO_STEX_GET = '/MXS47FLFX0U/tness/@public/api/getnum';
const TWOOO_STEX_CONSOLE = '/MXS47FLFX0U/tness/@public/api/console';

// ── SMS Bower (smsbower.page) ──────────────────────────────────────────────
const SMSBOWER_HOST = 'smsbower.page';
const SMSBOWER_KEY_FILE = path.join(__dirname, 'smsbower_key.txt');

function smsBowerRequest(qs) {
    return new Promise((resolve, reject) => {
        const opts = { hostname: SMSBOWER_HOST, port: 443,
            path: `/stubs/handler_api.php?${qs}`, method: 'GET',
            headers: { 'Accept': 'text/plain', 'Connection': 'close' } };
        const req = https.request(opts, (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d.trim()));
        });
        req.on('error', e => reject(new Error('SmsBower net: ' + e.message)));
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('SmsBower timeout')); });
        req.end();
    });
}

function smsBowerFetchNumber(apiKey, service, country, maxPrice) {
    let qs = `api_key=${encodeURIComponent(apiKey)}&action=getNumber&service=${encodeURIComponent(service || 'fb')}`;
    if (country && String(country).trim() !== '0' && String(country).trim() !== '') {
        qs += `&country=${encodeURIComponent(country)}`;
    }
    if (maxPrice && parseFloat(maxPrice) > 0) {
        qs += `&maxPrice=${encodeURIComponent(maxPrice)}`;
    }
    return smsBowerRequest(qs)
        .then(t => {
            if (t.startsWith('ACCESS_NUMBER:')) {
                const p = t.split(':');
                return { activationId: p[1], phoneNumber: p[2].replace(/[^0-9]/g, '') };
            }
            throw new Error('SmsBower: ' + t);
        });
}

function smsBowerPollOtp(apiKey, activationId, timeoutMs = 600000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const tryFetch = () => {
            smsBowerRequest(`api_key=${encodeURIComponent(apiKey)}&action=getStatus&id=${activationId}`)
                .then(t => {
                    if (t.startsWith('STATUS_OK:')) { resolve(t.replace('STATUS_OK:', '').trim()); return; }
                    if (t.startsWith('STATUS_WAIT_RETRY:')) {
                        const code = t.replace('STATUS_WAIT_RETRY:', '').trim();
                        if (code && /^\d{4,8}$/.test(code)) { resolve(code); return; }
                    }
                    if (t === 'STATUS_CANCEL' || t === 'NO_ACTIVATION') { resolve(null); return; }
                    if (Date.now() < deadline) setTimeout(tryFetch, 4000); else resolve(null);
                }).catch(() => { if (Date.now() < deadline) setTimeout(tryFetch, 4000); else resolve(null); });
        };
        tryFetch();
    });
}

function smsBowerSetStatus(apiKey, activationId, status) {
    return smsBowerRequest(`api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${activationId}&status=${status}`).catch(() => null);
}

// ── Zenex (api.zenexnetwork.com) ───────────────────────────────────────────
const ZENEX_HOST = 'api.zenexnetwork.com';
const ZENEX_KEY_FILE = path.join(__dirname, 'zenex_key.txt');

function zenexFetchNumber(apiKey, range) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ range, is_national: false, remove_plus: false });
        const opts = { hostname: ZENEX_HOST, port: 443, path: '/v1/getnum', method: 'POST',
            headers: { 'mapikey': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
        const req = https.request(opts, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    if (p?.meta?.code === 200 && p?.data?.full_number) resolve(p.data.full_number.replace(/[^0-9]/g, ''));
                    else reject(new Error(p?.message || 'Zenex: no number'));
                } catch (e) { reject(new Error('Zenex: invalid JSON')); }
            });
        });
        req.on('error', e => reject(new Error('Zenex net: ' + e.message)));
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Zenex timeout')); });
        req.write(payload); req.end();
    });
}

function zenexPollOtp(apiKey, phoneNumber, timeoutMs = 600000) {
    return new Promise((resolve) => {
        const normPhone = String(phoneNumber).replace(/[^0-9]/g, '');
        const deadline = Date.now() + timeoutMs;
        const seen = new Set();
        const tryFetch = () => {
            const opts = { hostname: ZENEX_HOST, port: 443, path: '/v1/numsuccess/info', method: 'GET',
                headers: { 'mapikey': apiKey } };
            const req = https.request(opts, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const p = JSON.parse(d);
                        const list = Array.isArray(p?.data?.otps) ? p.data.otps : (Array.isArray(p?.data) ? p.data : []);
                        for (const entry of list) {
                            const ep = String(entry.number || entry.copy || '').replace(/[^0-9]/g, '');
                            if (!ep) continue;
                            const matchPhone = (ep.length >= 6 && normPhone.length >= 6)
                                ? (ep.slice(-8) === normPhone.slice(-8) || ep.endsWith(normPhone) || normPhone.endsWith(ep))
                                : false;
                            if (matchPhone) {
                                const nid = entry.nid || (ep + '_' + (entry.otp || ''));
                                if (!seen.has(nid)) {
                                    const m = String(entry.otp || '').match(/\b(\d{4,8})\b/);
                                    if (m) { resolve(m[1]); return; }
                                }
                            }
                        }
                    } catch (_) {}
                    if (Date.now() < deadline) setTimeout(tryFetch, 4000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(tryFetch, 4000); else resolve(null); });
            req.end();
        };
        tryFetch();
    });
}

function nexaFetchNumber(apiKey, range, endpoint) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ range, format: 'normal' });
        const opts = {
            hostname: 'nexaotpservice.com',
            port: 80,
            path: endpoint || '/api/v1/numbers/get',
            method: 'POST',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.success && parsed.number) {
                        resolve(parsed.number.replace(/[^0-9]/g, ''));
                    } else {
                        reject(new Error(parsed.error || 'NexaOTP: No number returned'));
                    }
                } catch (e) { reject(new Error('NexaOTP: Invalid response')); }
            });
        });
        req.on('error', e => reject(new Error('NexaOTP network: ' + e.message)));
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('NexaOTP: Timeout')); });
        req.write(payload);
        req.end();
    });
}

// ── Voltx / Stex (2oo9.cloud) Fetch + Range Finder ─────────────
const twoOoLimiter = new NexaRateLimiter(500);

function stripRid(r) { return r.replace(/X+$/i, '').trim(); }

function twoOoFetchNumber(apiKey, range, getPath) {
    return new Promise((resolve, reject) => {
        const rid = stripRid(range);
        const payload = JSON.stringify({ rid });
        const opts = {
            hostname: TWOOO_HOST, port: 443, path: getPath, method: 'POST',
            headers: { 'mauthapi': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(data);
                    if (p?.meta?.code === 200 && p?.data?.no_plus_number) resolve(p.data.no_plus_number);
                    else reject(new Error(p?.message || p?.meta?.status || '2oo9: No number'));
                } catch (e) { reject(new Error('2oo9: Invalid JSON')); }
            });
        });
        req.on('error', e => reject(new Error('2oo9 network: ' + e.message)));
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('2oo9: Timeout')); });
        req.write(payload); req.end();
    });
}

function twoOoFetchConsole(apiKey, consolePath) {
    return new Promise((resolve, reject) => {
        const opts = { hostname: TWOOO_HOST, port: 443, path: consolePath, method: 'GET', headers: { 'mauthapi': apiKey } };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(data);
                    if (p?.meta?.code === 200 && Array.isArray(p?.data?.hits)) resolve(p.data.hits);
                    else reject(new Error(p?.message || 'Console fetch failed'));
                } catch (e) { reject(new Error('Console: Invalid JSON')); }
            });
        });
        req.on('error', e => reject(new Error('Console network: ' + e.message)));
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Console timeout')); });
        req.end();
    });
}

function parseTwoOoRangeSelection(input, maxIndex) {
    const indices = new Set();
    const tokens = input.split(/[\s,]+/).filter(t => t);
    for (const token of tokens) {
        const m = token.match(/^(\d+)-(\d+)$/);
        if (m) { for (let i = +m[1]; i <= +m[2]; i++) { if (i >= 1 && i <= maxIndex) indices.add(i - 1); } }
        else { const n = parseInt(token); if (!isNaN(n) && n >= 1 && n <= maxIndex) indices.add(n - 1); }
    }
    return [...indices].sort((a, b) => a - b);
}

async function autoRangeFinderFor2Oo(apiKey, consolePath, selectOptionFn, promptTextFn) {
    const APP_FILTERS = {
        facebook: ['facebook', 'fb'], instagram: ['instagram', 'ig'],
        meta: ['meta'], all: ['facebook', 'fb', 'instagram', 'ig', 'meta']
    };
    const APP_LABELS = { facebook: '📘 Facebook', instagram: '📸 Instagram', meta: '🌐 Meta', all: '📦 All (FB+IG+Meta)' };
    console.log(chalk.gray('\n  [Range Finder] Fetching live console feed...'));
    let hits = [];
    try { hits = await twoOoFetchConsole(apiKey, consolePath); }
    catch (e) { console.log(chalk.red(`\n  ✗ Console fetch failed: ${e.message}\n`)); return null; }
    const recent = hits.slice(0, 100);
    if (recent.length === 0) { console.log(chalk.red('\n  ✗ No hits in console feed.\n')); return null; }
    const appChoice = await selectOptionFn('Filter by app:', [
        { name: '📘 Facebook', value: 'facebook' }, { name: '📸 Instagram', value: 'instagram' },
        { name: '🌐 Meta', value: 'meta' }, { name: '📦 All (FB+IG+Meta)', value: 'all' }
    ]);
    const keywords = APP_FILTERS[appChoice];
    const filtered = recent.filter(hit => {
        const sid = (hit.sid || '').toLowerCase(), msg = (hit.message || '').toLowerCase();
        return keywords.some(kw => sid.includes(kw) || msg.includes(kw));
    });
    if (filtered.length === 0) { console.log(chalk.red('\n  ✗ No hits for selected app.\n')); return null; }
    const freqMap = {}, appMap = {};
    for (const hit of filtered) {
        const r = hit.range || ''; if (!r) continue;
        freqMap[r] = (freqMap[r] || 0) + 1;
        appMap[r] = appMap[r] || { facebook: 0, instagram: 0, meta: 0 };
        if (APP_FILTERS.facebook.some(kw => (hit.sid || '').toLowerCase().includes(kw) || (hit.message || '').toLowerCase().includes(kw))) appMap[r].facebook++;
        if (APP_FILTERS.instagram.some(kw => (hit.sid || '').toLowerCase().includes(kw) || (hit.message || '').toLowerCase().includes(kw))) appMap[r].instagram++;
        if (APP_FILTERS.meta.some(kw => (hit.sid || '').toLowerCase().includes(kw) || (hit.message || '').toLowerCase().includes(kw))) appMap[r].meta++;
    }
    const top5 = Object.entries(freqMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top5.length === 0) { console.log(chalk.red('\n  ✗ No valid ranges.\n')); return null; }
    const mode = await selectOptionFn('Range Finder mode:', [
        { name: '⚡ Auto detect & send (#1 range)', value: 'auto' },
        { name: '📊 Show top 5 & select', value: 'select' }
    ]);
    if (mode === 'auto') {
        const [topRange, topCount] = top5[0];
        const apps = appMap[topRange] || {};
        const tags = [];
        if (apps.facebook) tags.push(`📘FB(${apps.facebook})`);
        if (apps.instagram) tags.push(`📸IG(${apps.instagram})`);
        if (apps.meta) tags.push(`🌐Meta(${apps.meta})`);
        console.log(chalk.green(`\n  ✓ Auto Range: ${topRange}  (${topCount} hits)  ${tags.join(' ')}\n`));
        return [topRange];
    } else {
        console.log(chalk.cyan(`\n  App: ${APP_LABELS[appChoice]}  |  Scanned: ${filtered.length} hits\n`));
        console.log(chalk.yellow('  #   Range              Hits  Apps'));
        console.log(chalk.gray('  ─'.repeat(22)));
        top5.forEach(([range, count], idx) => {
            const apps = appMap[range] || {};
            const tags = [];
            if (apps.facebook) tags.push(`📘FB(${apps.facebook})`);
            if (apps.instagram) tags.push(`📸IG(${apps.instagram})`);
            if (apps.meta) tags.push(`🌐Meta(${apps.meta})`);
            console.log(chalk.cyan(`  ${String(idx + 1).padEnd(3)} `) + chalk.green(range.padEnd(16)) + chalk.yellow(String(count).padEnd(5)) + chalk.gray('█'.repeat(Math.min(count, 12)) + '  ') + (tags.join(' ') || chalk.gray('?')));
        });
        console.log(chalk.gray('\n  Enter selection (e.g. 1,3 | 1 2 5 | 1-3)\n'));
        const raw = await promptTextFn('Select ranges:', '');
        const chosen = parseTwoOoRangeSelection(raw, top5.length);
        if (chosen.length === 0) { console.log(chalk.red('\n  ✗ No valid selection.\n')); return null; }
        const sel = chosen.map(i => top5[i][0]);
        console.log(chalk.green(`\n  ✓ Selected: ${sel.join(', ')}\n`));
        return sel;
    }
}

// ── 3. Configuration & Branding ────────────────────────────────
let SUCCESSFUL_FILE = 'successful.txt';
let FAILED_FILE = 'failed.txt';
let PROGRESS_FILE = 'progress.json';
let DEBUG_FILE = 'debug.txt';

// Debug logger — DISABLED (set to no-op; re-enable by restoring fs.appendFileSync)
function debugLog(phone, step, data) {
    // Debug output disabled — uncomment below to re-enable:
    // try {
    //     const ts = new Date().toISOString();
    //     const strData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    //     const line = `\n[${ts}] [${phone}] [${step}]\n${strData}\n`;
    //     fs.appendFileSync(DEBUG_FILE, line);
    // } catch (e) { /* ignore write errors */ }
}


const B = chalk.hex('#4267B2');
const C = chalk.hex('#1877F2');
const Y = chalk.hex('#FFD700');
const W = chalk.white;
const G = chalk.gray;
const R = chalk.hex('#FF6B6B');
const DIM = chalk.hex('#555555');

function printHeader() {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    console.log(C('   ____                                      _  ___              '));
    console.log(C('  / ___|  ___ _ __ __ _ _ __   ___ _ __     | |/ (_)_ __   __ _  '));
    console.log(C('  \\___ \\ / __| \'__/ _` | \'_ \\ / _ \\ \'__|    | \' <| | \'_ \\ / _` | '));
    console.log(C('   ___) | (__| | | (_| | |_) |  __/ |       | . \\| | | | | (_| | '));
    console.log(C('  |____/ \\___|_|  \\__,_| .__/ \\___|_|       |_|\\_\\_|_| |_|\\__, | '));
    console.log(C('                       |_|                                |___/  \n'));
    console.log(W('┌──────────────────────────────────────────────┐'));
    console.log(W('│ [•] Tool      : ') + C('SK — Meta                    ') + W('│'));
    console.log(W('│ [•] Telegram  : ') + C('t.me/scraper_king            ') + W('│'));
    console.log(W('│ [•] Status    : ') + G('Premium License              ') + W('│'));
    console.log(W('│ [•] Version   : ') + Y('V4.0.2                       ') + W('│'));
    console.log(W('└──────────────────────────────────────────────┘\n'));
}

// ── 4. Common Helpers ──────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePhoneNumber(phone) {
    let normalized = phone.replace(/\D/g, '');
    if (!normalized.startsWith('+')) {
        normalized = '+' + normalized;
    }
    return normalized;
}

const uuid = () => crypto.randomUUID();

// Singleton Intl.DisplayNames — created once, reused per worker loop (avoids GC pressure)
let _displayNames;
try { _displayNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
catch (e) { _displayNames = { of: (iso) => iso }; }

// Generate random qpl_join_id (hex, 17 chars — matches capture format)
function genQplJoinId() {
    return crypto.randomBytes(9).toString('hex').substring(0, 17);
}

// Generate random __s session ID (3-part colon format: 6chars:6chars:6chars)
function genSessionId() {
    const part = () => crypto.randomBytes(3).toString('hex');
    return `${part()}:${part()}:${part()}`;
}

// Phone dial code → { country ISO, language Accept-Language header }
// Sorted longest-prefix-first so +1868 matches Trinidad before +1 matches US
const DIAL_MAP = [
    // 4-digit codes
    ['1868', 'TT', 'en-TT,en;q=0.9'], ['1876', 'JM', 'en-JM,en;q=0.9'], ['1809', 'DO', 'es-DO,es;q=0.9,en;q=0.8'], ['1829', 'DO', 'es-DO,es;q=0.9,en;q=0.8'], ['1849', 'DO', 'es-DO,es;q=0.9,en;q=0.8'],
    // 3-digit codes
    ['880', 'BD', 'bn-BD,bn;q=0.9,en;q=0.8'], ['855', 'KH', 'km-KH,km;q=0.9,en;q=0.8'], ['856', 'LA', 'lo-LA,lo;q=0.9,en;q=0.8'],
    ['228', 'TG', 'fr-TG,fr;q=0.9,en;q=0.8'], ['229', 'BJ', 'fr-BJ,fr;q=0.9,en;q=0.8'], ['233', 'GH', 'en-GH,en;q=0.9'],
    ['234', 'NG', 'en-NG,en;q=0.9'], ['237', 'CM', 'fr-CM,fr;q=0.9,en;q=0.8'], ['243', 'CD', 'fr-CD,fr;q=0.9'],
    ['254', 'KE', 'sw-KE,sw;q=0.9,en;q=0.8'], ['255', 'TZ', 'sw-TZ,sw;q=0.9,en;q=0.8'], ['256', 'UG', 'en-UG,en;q=0.9'],
    ['260', 'ZM', 'en-ZM,en;q=0.9'], ['263', 'ZW', 'en-ZW,en;q=0.9'],
    ['212', 'MA', 'ar-MA,ar;q=0.9,fr;q=0.8'], ['213', 'DZ', 'ar-DZ,ar;q=0.9,fr;q=0.8'], ['216', 'TN', 'ar-TN,ar;q=0.9,fr;q=0.8'],
    ['218', 'LY', 'ar-LY,ar;q=0.9,en;q=0.8'], ['220', 'GM', 'en-GM,en;q=0.9'],
    ['221', 'SN', 'fr-SN,fr;q=0.9'], ['222', 'MR', 'ar-MR,ar;q=0.9,fr;q=0.8'], ['223', 'ML', 'fr-ML,fr;q=0.9'],
    ['224', 'GN', 'fr-GN,fr;q=0.9'], ['225', 'CI', 'fr-CI,fr;q=0.9'], ['226', 'BF', 'fr-BF,fr;q=0.9'],
    ['227', 'NE', 'fr-NE,fr;q=0.9'], ['230', 'MU', 'en-MU,en;q=0.9,fr;q=0.8'],
    ['231', 'LR', 'en-LR,en;q=0.9'], ['232', 'SL', 'en-SL,en;q=0.9'],
    ['235', 'TD', 'fr-TD,fr;q=0.9,ar;q=0.8'], ['236', 'CF', 'fr-CF,fr;q=0.9'],
    ['238', 'CV', 'pt-CV,pt;q=0.9'], ['239', 'ST', 'pt-ST,pt;q=0.9'],
    ['240', 'GQ', 'es-GQ,es;q=0.9'], ['241', 'GA', 'fr-GA,fr;q=0.9'], ['242', 'CG', 'fr-CG,fr;q=0.9'],
    ['244', 'AO', 'pt-AO,pt;q=0.9'], ['245', 'GW', 'pt-GW,pt;q=0.9'], ['246', 'IO', 'en-IO,en;q=0.9'],
    ['247', 'AC', 'en-AC,en;q=0.9'], ['248', 'SC', 'en-SC,en;q=0.9,fr;q=0.8'], ['249', 'SD', 'ar-SD,ar;q=0.9,en;q=0.8'],
    ['250', 'RW', 'rw-RW,rw;q=0.9,en;q=0.8,fr;q=0.7'], ['251', 'ET', 'am-ET,am;q=0.9,en;q=0.8'],
    ['252', 'SO', 'so-SO,so;q=0.9,ar;q=0.8,en;q=0.7'], ['253', 'DJ', 'fr-DJ,fr;q=0.9,ar;q=0.8'],
    ['257', 'BI', 'fr-BI,fr;q=0.9,rn;q=0.8'], ['258', 'MZ', 'pt-MZ,pt;q=0.9'],
    ['261', 'MG', 'mg-MG,mg;q=0.9,fr;q=0.8'], ['262', 'RE', 'fr-RE,fr;q=0.9'],
    ['264', 'NA', 'en-NA,en;q=0.9'], ['265', 'MW', 'en-MW,en;q=0.9'], ['266', 'LS', 'en-LS,en;q=0.9'],
    ['267', 'BW', 'en-BW,en;q=0.9'], ['268', 'SZ', 'en-SZ,en;q=0.9'], ['269', 'KM', 'fr-KM,fr;q=0.9,ar;q=0.8'],
    ['966', 'SA', 'ar-SA,ar;q=0.9,en;q=0.8'], ['971', 'AE', 'ar-AE,ar;q=0.9,en;q=0.8'],
    ['973', 'BH', 'ar-BH,ar;q=0.9,en;q=0.8'], ['974', 'QA', 'ar-QA,ar;q=0.9,en;q=0.8'],
    ['968', 'OM', 'ar-OM,ar;q=0.9,en;q=0.8'], ['965', 'KW', 'ar-KW,ar;q=0.9,en;q=0.8'],
    ['964', 'IQ', 'ar-IQ,ar;q=0.9,en;q=0.8'], ['963', 'SY', 'ar-SY,ar;q=0.9,en;q=0.8'],
    ['962', 'JO', 'ar-JO,ar;q=0.9,en;q=0.8'], ['961', 'LB', 'ar-LB,ar;q=0.9,en;q=0.8,fr;q=0.7'],
    ['967', 'YE', 'ar-YE,ar;q=0.9,en;q=0.8'],
    ['970', 'PS', 'ar-PS,ar;q=0.9,en;q=0.8'], ['972', 'IL', 'he-IL,he;q=0.9,en;q=0.8'],
    ['992', 'TJ', 'tg-TJ,tg;q=0.9,ru;q=0.8'], ['993', 'TM', 'tk-TM,tk;q=0.9,ru;q=0.8'],
    ['994', 'AZ', 'az-AZ,az;q=0.9,ru;q=0.8'], ['995', 'GE', 'ka-GE,ka;q=0.9,en;q=0.8'],
    ['996', 'KG', 'ky-KG,ky;q=0.9,ru;q=0.8'], ['998', 'UZ', 'uz-UZ,uz;q=0.9,ru;q=0.8'],
    ['977', 'NP', 'ne-NP,ne;q=0.9,en;q=0.8'], ['975', 'BT', 'dz-BT,dz;q=0.9,en;q=0.8'],
    ['959', 'MM', 'my-MM,my;q=0.9,en;q=0.8'],
    ['670', 'TL', 'pt-TL,pt;q=0.9,en;q=0.8'],
    ['673', 'BN', 'ms-BN,ms;q=0.9,en;q=0.8'],
    ['676', 'TO', 'en-TO,en;q=0.9'], ['677', 'SB', 'en-SB,en;q=0.9'], ['678', 'VU', 'en-VU,en;q=0.9,fr;q=0.8'],
    ['679', 'FJ', 'en-FJ,en;q=0.9'], ['680', 'PW', 'en-PW,en;q=0.9'],
    ['591', 'BO', 'es-BO,es;q=0.9,en;q=0.8'], ['592', 'GY', 'en-GY,en;q=0.9'],
    ['593', 'EC', 'es-EC,es;q=0.9,en;q=0.8'], ['594', 'GF', 'fr-GF,fr;q=0.9'],
    ['595', 'PY', 'es-PY,es;q=0.9,en;q=0.8'], ['596', 'MQ', 'fr-MQ,fr;q=0.9'],
    ['597', 'SR', 'nl-SR,nl;q=0.9,en;q=0.8'], ['598', 'UY', 'es-UY,es;q=0.9,en;q=0.8'],
    // European Balkan + Eastern Europe (commonly missing)
    ['387', 'BA', 'bs-BA,bs;q=0.9,hr;q=0.8,en;q=0.7'],
    ['385', 'HR', 'hr-HR,hr;q=0.9,en;q=0.8'],
    ['386', 'SI', 'sl-SI,sl;q=0.9,en;q=0.8'],
    ['389', 'MK', 'mk-MK,mk;q=0.9,en;q=0.8'],
    ['381', 'RS', 'sr-RS,sr;q=0.9,en;q=0.8'],
    ['382', 'ME', 'sr-ME,sr;q=0.9,en;q=0.8'],
    ['383', 'XK', 'sq-XK,sq;q=0.9,sr;q=0.8,en;q=0.7'],
    ['355', 'AL', 'sq-AL,sq;q=0.9,en;q=0.8'],
    ['356', 'MT', 'mt-MT,mt;q=0.9,en;q=0.8'],
    ['357', 'CY', 'el-CY,el;q=0.9,en;q=0.8'],
    ['358', 'FI', 'fi-FI,fi;q=0.9,sv;q=0.8,en;q=0.7'],
    ['359', 'BG', 'bg-BG,bg;q=0.9,en;q=0.8'],
    ['370', 'LT', 'lt-LT,lt;q=0.9,en;q=0.8'],
    ['371', 'LV', 'lv-LV,lv;q=0.9,en;q=0.8'],
    ['372', 'EE', 'et-EE,et;q=0.9,en;q=0.8'],
    ['373', 'MD', 'ro-MD,ro;q=0.9,ru;q=0.8,en;q=0.7'],
    ['374', 'AM', 'hy-AM,hy;q=0.9,en;q=0.8'],
    ['375', 'BY', 'be-BY,be;q=0.9,ru;q=0.8,en;q=0.7'],
    ['376', 'AD', 'ca-AD,ca;q=0.9,es;q=0.8,en;q=0.7'],
    ['377', 'MC', 'fr-MC,fr;q=0.9,en;q=0.8'],
    ['378', 'SM', 'it-SM,it;q=0.9,en;q=0.8'],
    ['380', 'UA', 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7'],
    ['420', 'CZ', 'cs-CZ,cs;q=0.9,en;q=0.8'],
    ['421', 'SK', 'sk-SK,sk;q=0.9,en;q=0.8'],
    ['423', 'LI', 'de-LI,de;q=0.9,en;q=0.8'],
    // 2-digit codes
    ['20', 'EG', 'ar-EG,ar;q=0.9,en;q=0.8'], ['27', 'ZA', 'en-ZA,en;q=0.9'],
    ['30', 'GR', 'el-GR,el;q=0.9,en;q=0.8'], ['31', 'NL', 'nl-NL,nl;q=0.9,en;q=0.8'],
    ['32', 'BE', 'nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.7'], ['33', 'FR', 'fr-FR,fr;q=0.9,en;q=0.8'],
    ['34', 'ES', 'es-ES,es;q=0.9,en;q=0.8'], ['36', 'HU', 'hu-HU,hu;q=0.9,en;q=0.8'],
    ['39', 'IT', 'it-IT,it;q=0.9,en;q=0.8'], ['40', 'RO', 'ro-RO,ro;q=0.9,en;q=0.8'],
    ['41', 'CH', 'de-CH,de;q=0.9,fr;q=0.8,en;q=0.7'], ['43', 'AT', 'de-AT,de;q=0.9,en;q=0.8'],
    ['44', 'GB', 'en-GB,en;q=0.9'], ['45', 'DK', 'da-DK,da;q=0.9,en;q=0.8'],
    ['46', 'SE', 'sv-SE,sv;q=0.9,en;q=0.8'], ['47', 'NO', 'nb-NO,nb;q=0.9,en;q=0.8'],
    ['48', 'PL', 'pl-PL,pl;q=0.9,en;q=0.8'], ['49', 'DE', 'de-DE,de;q=0.9,en;q=0.8'],
    ['51', 'PE', 'es-PE,es;q=0.9,en;q=0.8'], ['52', 'MX', 'es-MX,es;q=0.9,en;q=0.8'],
    ['53', 'CU', 'es-CU,es;q=0.9'], ['54', 'AR', 'es-AR,es;q=0.9,en;q=0.8'],
    ['55', 'BR', 'pt-BR,pt;q=0.9,en;q=0.8'], ['56', 'CL', 'es-CL,es;q=0.9,en;q=0.8'],
    ['57', 'CO', 'es-CO,es;q=0.9,en;q=0.8'], ['58', 'VE', 'es-VE,es;q=0.9,en;q=0.8'],
    ['60', 'MY', 'ms-MY,ms;q=0.9,en;q=0.8'], ['61', 'AU', 'en-AU,en;q=0.9'],
    ['62', 'ID', 'id-ID,id;q=0.9,en;q=0.8'], ['63', 'PH', 'en-PH,en;q=0.9,fil;q=0.8'],
    ['64', 'NZ', 'en-NZ,en;q=0.9'], ['65', 'SG', 'en-SG,en;q=0.9,zh;q=0.8'],
    ['66', 'TH', 'th-TH,th;q=0.9,en;q=0.8'], ['81', 'JP', 'ja-JP,ja;q=0.9,en;q=0.8'],
    ['82', 'KR', 'ko-KR,ko;q=0.9,en;q=0.8'], ['84', 'VN', 'vi-VN,vi;q=0.9,en;q=0.8'],
    ['86', 'CN', 'zh-CN,zh;q=0.9,en;q=0.8'], ['90', 'TR', 'tr-TR,tr;q=0.9,en;q=0.8'],
    ['91', 'IN', 'hi-IN,hi;q=0.9,en;q=0.8'], ['92', 'PK', 'ur-PK,ur;q=0.9,en;q=0.8'],
    ['93', 'AF', 'ps-AF,ps;q=0.9,en;q=0.8'], ['94', 'LK', 'si-LK,si;q=0.9,en;q=0.8'],
    ['95', 'MM', 'my-MM,my;q=0.9,en;q=0.8'], ['98', 'IR', 'fa-IR,fa;q=0.9,en;q=0.8'],
    // 1-digit
    ['1', 'US', 'en-US,en;q=0.9'],
    ['7', 'RU', 'ru-RU,ru;q=0.9,en;q=0.8'],
];

const TZ_MAP = {
    'US': 300, 'TT': 240, 'JM': 300, 'DO': 240, 'BD': -360, 'KH': -420, 'LA': -420, 'TG': 0,
    'BJ': -60, 'GH': 0, 'NG': -60, 'CM': -60, 'CD': -60, 'KE': -180, 'TZ': -180, 'UG': -180,
    'ZM': -120, 'ZW': -120, 'MA': -60, 'DZ': -60, 'TN': -60, 'LY': -120, 'GM': 0, 'SN': 0,
    'MR': 0, 'ML': 0, 'GN': 0, 'CI': 0, 'BF': 0, 'NE': -60, 'MU': -240, 'LR': 0, 'SL': 0,
    'TD': -60, 'CF': -60, 'CV': 60, 'ST': 0, 'GQ': -60, 'GA': -60, 'CG': -60, 'AO': -60,
    'GW': 0, 'IO': -360, 'AC': 0, 'SC': -240, 'SD': -120, 'RW': -120, 'ET': -180, 'SO': -180,
    'DJ': -180, 'BI': -120, 'MZ': -120, 'MG': -180, 'RE': -240, 'NA': -120, 'MW': -120,
    'LS': -120, 'BW': -120, 'SZ': -120, 'KM': -180, 'SA': -180, 'AE': -240, 'BH': -180,
    'QA': -180, 'OM': -240, 'KW': -180, 'IQ': -180, 'SY': -180, 'JO': -180, 'LB': -120,
    'YE': -180, 'PS': -120, 'IL': -120, 'TJ': -300, 'TM': -300, 'AZ': -240, 'GE': -240,
    'KG': -360, 'UZ': -300, 'NP': -345, 'BT': -360, 'MM': -390, 'TL': -540, 'BN': -480,
    'TO': -780, 'SB': -660, 'VU': -660, 'FJ': -720, 'PW': -540, 'BO': 240, 'GY': 240,
    'EC': 300, 'GF': 180, 'PY': 240, 'MQ': 240, 'SR': 180, 'UY': 180, 'EG': -120, 'ZA': -120,
    'GR': -120, 'NL': -60, 'BE': -60, 'FR': -60, 'ES': -60, 'HU': -60, 'IT': -60, 'RO': -120,
    'CH': -60, 'AT': -60, 'GB': 0, 'DK': -60, 'SE': -60, 'NO': -60, 'PL': -60, 'DE': -60,
    'PE': 300, 'MX': 360, 'CU': 240, 'AR': 180, 'BR': 180, 'CL': 240, 'CO': 300, 'VE': 240,
    'MY': -480, 'AU': -600, 'ID': -420, 'PH': -480, 'NZ': -720, 'SG': -480, 'TH': -420,
    'JP': -540, 'KR': -540, 'VN': -420, 'CN': -480, 'TR': -180, 'IN': -330, 'PK': -300,
    'AF': -270, 'LK': -330, 'IR': -210, 'RU': -180,
    // Balkan + Eastern Europe
    'BA': -60, 'HR': -60, 'SI': -60, 'MK': -60, 'RS': -60, 'ME': -60, 'XK': -60,
    'AL': -60, 'MT': -60, 'CY': -120, 'FI': -120, 'BG': -120,
    'LT': -120, 'LV': -120, 'EE': -120, 'MD': -120, 'AM': -240,
    'BY': -180, 'AD': -60, 'MC': -60, 'SM': -60, 'UA': -120,
    'CZ': -60, 'SK': -60, 'LI': -60
};

function getCountryFromPhone(barePhone) {
    for (const [prefix, iso, lang] of DIAL_MAP) {
        if (barePhone.startsWith(prefix)) {
            return { iso, lang };
        }
    }
    return { iso: 'US', lang: 'en-US,en;q=0.9' };
}

function generateRandomDOB() {
    const age = Math.floor(Math.random() * 25) + 18; // 18-43 years
    const year = new Date().getFullYear() - age;
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
    return { day, month, year: String(year), full: `${year}-${month}-${day}` };
}

function generateRandomPassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let pass = '';
    for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    return pass;
}

function generateRandomName() {
    const firstNames = ['John', 'David', 'Michael', 'Chris', 'James', 'Daniel', 'Matthew', 'Andrew', 'Joshua', 'Kevin', 'Brian', 'Jason', 'Eric', 'Steven', 'Thomas', 'Timothy', 'Richard', 'Ryan', 'Jeffrey', 'Gary'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return { first, last, full: `${first} ${last}` };
}
// ── Device profile database (sourced from Aug-07-2026 OTP buster log captures) ──
const ANDROID_DEVICE_PROFILES = [
    // Qualcomm Snapdragon flagship
    { model: 'AI2401', cpu: 'Snapdragon 8 Gen 3', gpu: 'Adreno 750', ram: 24, dpr: 3.0, group: 'high', soc: 'Qualcomm' },
    { model: 'SM-S938B', cpu: 'Snapdragon 8 Gen 3', gpu: 'Adreno 750', ram: 12, dpr: 3.0, group: 'high', soc: 'Qualcomm' },
    { model: 'CPH2581', cpu: 'Snapdragon 8 Gen 3', gpu: 'Adreno 750', ram: 16, dpr: 3.5, group: 'high', soc: 'Qualcomm' },
    { model: 'SM-S911B', cpu: 'Snapdragon 8 Gen 2', gpu: 'Adreno 740', ram: 8, dpr: 2.75, group: 'high', soc: 'Qualcomm' },
    { model: 'CPH2449', cpu: 'Snapdragon 8 Gen 2', gpu: 'Adreno 740', ram: 16, dpr: 3.5, group: 'high', soc: 'Qualcomm' },
    { model: '2304FPN6DG', cpu: 'Snapdragon 8 Gen 2', gpu: 'Adreno 740', ram: 12, dpr: 3.5, group: 'high', soc: 'Qualcomm' },
    { model: 'XQ-DQ72', cpu: 'Snapdragon 8 Gen 3', gpu: 'Adreno 750', ram: 12, dpr: 3.0, group: 'high', soc: 'Qualcomm' },
    // MediaTek flagship/mid
    { model: 'CPH2551', cpu: 'MediaTek Dimensity 9300', gpu: 'Immortalis-G720 MC12', ram: 16, dpr: 3.5, group: 'high', soc: 'MediaTek' },
    { model: 'CPH2505', cpu: 'MediaTek Dimensity 8200', gpu: 'Mali-G610 MC6', ram: 12, dpr: 2.75, group: 'high', soc: 'MediaTek' },
    { model: 'V2316', cpu: 'MediaTek Dimensity 9300', gpu: 'Immortalis-G720 MC12', ram: 16, dpr: 3.0, group: 'high', soc: 'MediaTek' },
    { model: '23113RKC6G', cpu: 'MediaTek Dimensity 7200-Ultra', gpu: 'Mali-G610 MC4', ram: 8, dpr: 2.75, group: 'high', soc: 'MediaTek' },
    { model: 'NOH-NX9', cpu: 'Kirin 9000', gpu: 'Mali-G78 MP24', ram: 8, dpr: 3.0, group: 'high', soc: 'HiSilicon' },
    // Mid-range
    { model: 'SM-A155F', cpu: 'MediaTek Helio G99', gpu: 'Mali-G57 MC2', ram: 4, dpr: 2.0, group: 'medium', soc: 'MediaTek' },
    { model: 'V2320', cpu: 'MediaTek Dimensity 6020', gpu: 'Mali-G57 MC2', ram: 4, dpr: 2.0, group: 'medium', soc: 'MediaTek' },
    { model: 'X6871', cpu: 'MediaTek Dimensity 8200', gpu: 'Mali-G610 MC6', ram: 8, dpr: 2.75, group: 'high', soc: 'MediaTek' },
    // Google Pixel
    { model: 'Pixel 8 Pro', cpu: 'Google Tensor G3', gpu: 'Mali-G715 Immortalis MC10', ram: 12, dpr: 2.75, group: 'high', soc: 'Google' },
    { model: 'Pixel 8', cpu: 'Google Tensor G3', gpu: 'Mali-G715 Immortalis MC10', ram: 8, dpr: 2.75, group: 'high', soc: 'Google' },
];

const IOS_DEVICE_PROFILES = [
    // iPhone flagships
    { model: 'iPhone16,2', family: 'iPhone', osVer: '18.3', cpu: 'Apple A17 Pro', gpu: 'Apple G17P (6-core)', ram: 8, dpr: 3.0, group: 'high', soc: 'Apple' },
    { model: 'iPhone16,1', family: 'iPhone', osVer: '18.2', cpu: 'Apple A17 Pro', gpu: 'Apple G17P (6-core)', ram: 8, dpr: 3.0, group: 'high', soc: 'Apple' },
    { model: 'iPhone15,4', family: 'iPhone', osVer: '18.1', cpu: 'Apple A16 Bionic', gpu: 'Apple G16 (5-core)', ram: 6, dpr: 3.0, group: 'medium', soc: 'Apple' },
    { model: 'iPhone15,3', family: 'iPhone', osVer: '18.1', cpu: 'Apple A16 Bionic', gpu: 'Apple G16 (5-core)', ram: 6, dpr: 3.0, group: 'medium', soc: 'Apple' },
    { model: 'iPhone14,8', family: 'iPhone', osVer: '17.2', cpu: 'Apple A15 Bionic', gpu: 'Apple G15 (5-core)', ram: 6, dpr: 3.0, group: 'medium', soc: 'Apple' },
    { model: 'iPhone14,2', family: 'iPhone', osVer: '17.5', cpu: 'Apple A15 Bionic', gpu: 'Apple G15 (5-core)', ram: 6, dpr: 3.0, group: 'medium', soc: 'Apple' },
    // iPad
    { model: 'iPad14,6', family: 'iPad', osVer: '17.6', cpu: 'Apple M2', gpu: 'Apple M2 GPU (10-core)', ram: 8, dpr: 2.0, group: 'high', soc: 'Apple' },
    { model: 'iPad14,1', family: 'iPad', osVer: '18.1', cpu: 'Apple M2', gpu: 'Apple M2 GPU (10-core)', ram: 8, dpr: 2.0, group: 'high', soc: 'Apple' },
];

const ANDROID_VERSIONS = ['11', '12', '13', '14', '15'];
const IOS_VERSIONS = [
    { ver: '18_5', build: '22F76', osTag: '18.5' },
    { ver: '18_3', build: '22D60', osTag: '18.3' },
    { ver: '18_1', build: '22B83', osTag: '18.1' },
    { ver: '17_4_1', build: '21E236', osTag: '17.4.1' },
    { ver: '17_2', build: '21C62', osTag: '17.2' },
    { ver: '16_2', build: '20C65', osTag: '16.2' },
    { ver: '15_4', build: '19E241', osTag: '15.4' },
];
const IT_OPERATORS = ['WindTre', 'TIM IT', 'Vodafone IT', 'Iliad IT'];
const US_OPERATORS = ['T-Mobile', 'AT&T', 'Verizon', 'Google Fi'];
const GENERIC_OPERATORS = ['Vodafone', 'Orange', 'T-Mobile', 'Claro', 'Rogers', 'Glo', 'MTN'];
const CONNECTION_TYPES = ['WIFI', 'MOBILE_LTE', 'MOBILE_5G'];
const GPS_VERSIONS = ['24.08.12', '24.10.15', '24.15.18', '24.20.13', '24.23.35', '24.26.31', '24.33.32', '24.36.15', '24.39.14', '24.42.12', '24.45.17', '25.02.34', '25.08.13'];

// Pick a sim operator pool appropriate for the phone country
function getSimOperators(iso) {
    if (iso === 'IT') return IT_OPERATORS;
    if (iso === 'US') return US_OPERATORS;
    return GENERIC_OPERATORS;
}

// Generate a realistic random device fingerprint (Android or iOS)
function generateDeviceFingerprint(type, simPool) {
    // type: 'android' | 'ios' | 'random'
    const pick = type === 'android' ? 'android' : type === 'ios' ? 'ios' : (Math.random() > 0.4 ? 'android' : 'ios');
    const connType = CONNECTION_TYPES[Math.floor(Math.random() * CONNECTION_TYPES.length)];
    const networkQuality = 'EXCELLENT';
    const battery = Math.floor(Math.random() * 80) + 15; // 15-95
    const isCharging = Math.random() > 0.7 ? 1 : 0;
    const uptime = Math.floor(Math.random() * 250000) + 30000;
    const fgTime = Math.floor(Math.random() * uptime * 0.7);
    const bandwidth = Math.floor(Math.random() * 180000000) + 15000000;
    const operators = simPool || IT_OPERATORS;

    if (pick === 'android') {
        const profile = ANDROID_DEVICE_PROFILES[Math.floor(Math.random() * ANDROID_DEVICE_PROFILES.length)];
        const androidV = ANDROID_VERSIONS[Math.floor(Math.random() * ANDROID_VERSIONS.length)];
        const simOp = operators[Math.floor(Math.random() * operators.length)];
        const gpsVer = GPS_VERSIONS[Math.floor(Math.random() * GPS_VERSIONS.length)];
        return {
            platform: 'android',
            androidVersion: androidV,
            model: profile.model,
            cpu: profile.cpu,
            gpu: profile.gpu,
            ram: profile.ram,
            dpr: profile.dpr,
            deviceGroup: profile.group,
            socManufacturer: profile.soc,
            hwid: uuid(),
            bootId: uuid(),
            advertisingId: uuid(),
            sessionId: uuid(),
            connType,
            networkQuality,
            simOperator: simOp,
            battery,
            isCharging,
            uptime,
            fgTime,
            bandwidth,
            gpsVersion: gpsVer,
        };
    } else {
        const profile = IOS_DEVICE_PROFILES[Math.floor(Math.random() * IOS_DEVICE_PROFILES.length)];
        const iosV = IOS_VERSIONS[Math.floor(Math.random() * IOS_VERSIONS.length)];
        const simOp = operators[Math.floor(Math.random() * operators.length)];
        // iOS boot/advertising IDs are uppercase UUIDs
        const upperUuid = () => uuid().toUpperCase();
        return {
            platform: 'ios',
            iosVersion: iosV,
            model: profile.model,
            family: profile.family,
            osVersion: profile.osVer,
            cpu: profile.cpu,
            gpu: profile.gpu,
            ram: profile.ram,
            dpr: profile.dpr,
            deviceGroup: profile.group,
            socManufacturer: profile.soc,
            hwid: uuid(),
            bootId: upperUuid(),
            advertisingId: upperUuid(),
            sessionId: uuid(),
            connType,
            networkQuality,
            simOperator: simOp,
            battery,
            isCharging,
            uptime,
            fgTime,
            bandwidth,
        };
    }
}

function getRandomClient(browserPref = 'random', simPool = null) {
    const v = Math.floor(Math.random() * (151 - 146 + 1)) + 146;
    const buildNum = Math.floor(Math.random() * 200) + 7800;
    const patch = Math.floor(Math.random() * 150) + 50;

    // Real Chrome GREASE brand per major version (Meta validates this!)
    const greaseMap = {
        146: '"Not;A=Brand";v="24"',
        147: '"Not_A Brand";v="8"',
        148: '"Not A(Brand";v="99"',
        149: '"Not(A;Brand";v="24"',
        150: '"Not;A=Brand";v="8"',
        151: '"Not=A?Brand";v="99"'
    };
    const grease = greaseMap[v] || '"Not;A=Brand";v="8"';

    // Log analysis: ALL 30k+ successful registrations used MOBILE UAs.
    // Desktop only used when caller explicitly passes browserPref='desktop'.
    const isDesktop = browserPref === 'desktop';

    if (isDesktop) {
        // Desktop Windows UA (no x-fb-device headers for desktop)
        const isWin11 = Math.random() > 0.5;
        const platformVersion = isWin11 ? '"15.0.0"' : '"10.0.0"';
        const greaseFullVer = grease.replace(/v="(\d+)"/, (_, n) => `v="${n}.0.0.0"`);
        return {
            name: 'Windows Chrome',
            userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Safari/537.36`,
            clientHints: {
                'sec-ch-ua': `${grease}, "Chromium";v="${v}", "Google Chrome";v="${v}"`,
                'sec-ch-ua-full-version-list': `${greaseFullVer}, "Chromium";v="${v}.0.${buildNum}.${patch}", "Google Chrome";v="${v}.0.${buildNum}.${patch}"`,
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua-platform-version': platformVersion,
                'sec-ch-ua-model': '""',
                'sec-ch-prefers-color-scheme': 'dark'
            },
            hw: { w: 1920, h: 1080, dpr: 1, cores: 8, ram: 16 },
            device: null  // no x-fb-device headers for desktop
        };
    } else {
        // Mobile — pick Android or iOS fingerprint, pass sim operator pool for this phone country
        const mobilePref = browserPref === 'mobile' ? 'random' : browserPref;
        const device = generateDeviceFingerprint(mobilePref, simPool || IT_OPERATORS);

        const greaseFullVer = grease.replace(/v="(\d+)"/, (_, n) => `v="${n}.0.0.0"`);

        if (device.platform === 'ios') {
            const { iosVersion: iv } = device;
            const ua = `Mozilla/5.0 (${device.family === 'iPad' ? 'iPad' : 'iPhone'}; CPU ${device.family === 'iPad' ? 'OS' : 'iPhone OS'} ${iv.ver} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${iv.ver.replace(/_/g, '.').split('.').slice(0, 2).join('.')}.0 Mobile/${iv.build} Safari/605.1`;
            return {
                name: `iOS Safari (${device.family})`,
                userAgent: ua,
                clientHints: {
                    'sec-ch-ua': `"Chromium";v="146", "Not:A-Brand";v="99"`,
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"iOS"',
                    'sec-gpc': '1'
                },
                hw: { w: device.family === 'iPad' ? 768 : 390, h: device.family === 'iPad' ? 1024 : 844, dpr: device.dpr, cores: 8, ram: device.ram },
                device
            };
        } else {
            const ua = `Mozilla/5.0 (Linux; Android ${device.androidVersion}; ${device.model} Build/TP1A.231011.067) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Mobile Safari/537.36`;
            return {
                name: 'Android Chrome',
                userAgent: ua,
                clientHints: {
                    'sec-ch-ua': `"Chromium";v="${v}", "Not:A-Brand";v="99"`,
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"Android"',
                    'sec-ch-ua-platform-version': `"${device.androidVersion}.0.0"`,
                    'sec-ch-ua-model': `"${device.model}"`,
                    'sec-gpc': '1'
                },
                hw: { w: 412, h: 915, dpr: device.dpr, cores: 8, ram: device.ram },
                device
            };
        }
    }
}


// ── 5. Proxy Management ────────────────────────────────────────
function rotateSessionId(proxy) {
    if (!proxy || !proxy.user) return proxy;
    const rotated = { ...proxy };

    const sessionRegexes = [
        /-ssid-[A-Za-z0-9_]+/,
        /-session-[A-Za-z0-9_]+/,
        /_session_[A-Za-z0-9_]+/,
        /-sess-[A-Za-z0-9_]+/
    ];

    for (const regex of sessionRegexes) {
        if (rotated.user && regex.test(rotated.user)) {
            const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
            rotated.user = rotated.user.replace(regex, `${regex.source.split('[')[0].replace(/\\/g, '')}${newId}`);
            break;
        }
        if (rotated.pass && regex.test(rotated.pass)) {
            const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
            rotated.pass = rotated.pass.replace(regex, `${regex.source.split('[')[0].replace(/\\/g, '')}${newId}`);
            break;
        }
    }

    return rotated;
}

function parseProxy(str) {
    if (!str) return null;
    if (typeof str === 'object') return str;
    str = str.trim();
    if (!str) return null;
    let host, port, user, pass;
    if (str.includes('://')) str = str.split('://')[1];
    if (str.includes('@')) {
        const parts = str.split('@');
        const auth = parts[0].split(':');
        const server = parts[1].split(':');
        user = auth[0]; pass = auth[1];
        host = server[0]; port = parseInt(server[1]);
    } else {
        const parts = str.split(':');
        if (parts.length === 2) {
            host = parts[0]; port = parseInt(parts[1]);
        } else if (parts.length === 4) {
            // Auto-detect: user:pass:host:port vs host:port:user:pass
            if (!isNaN(parseInt(parts[3])) && isNaN(parseInt(parts[1]))) {
                // user:pass:host:port format
                user = parts[0]; pass = parts[1];
                host = parts[2]; port = parseInt(parts[3]);
            } else {
                // host:port:user:pass format
                host = parts[0]; port = parseInt(parts[1]);
                user = parts[2]; pass = parts[3];
            }
        } else if (parts.length === 3) {
            host = parts[0]; port = parseInt(parts[1]);
            user = parts[2];
        }
    }
    if (!host || !port) return null;
    return { type: 'http', host, port, user, pass, original: str };
}

function createProxyAgent(proxy) {
    if (!proxy) return null;
    let proxyUrl = '';
    if (proxy.type === 'socks5' || proxy.type === 'socks4') {
        proxyUrl = `socks5://${proxy.user ? proxy.user + ':' + proxy.pass + '@' : ''}${proxy.host}:${proxy.port}`;
        return new SocksProxyAgent(proxyUrl);
    } else {
        proxyUrl = `http://${proxy.user ? proxy.user + ':' + proxy.pass + '@' : ''}${proxy.host}:${proxy.port}`;
        return new HttpsProxyAgent(proxyUrl);
    }
}

// ── 5.5 Proxy Country Geo-Lookup (cached per proxy) ───────────
// Cache: avoids calling ip-api.com for EVERY number — one lookup per unique proxy
const _proxyCountryCache = new Map();

async function getProxyCountry(proxy) {
    if (!proxy) return 'Direct';
    const cacheKey = `${proxy.host}:${proxy.port}`;
    if (_proxyCountryCache.has(cacheKey)) return _proxyCountryCache.get(cacheKey);
    try {
        const country = await new Promise((resolve) => {
            const proxyAuth = (proxy.user && proxy.pass)
                ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')
                : null;
            const reqHeaders = { 'Host': 'ip-api.com', 'User-Agent': 'curl/7.88.0', 'Accept': '*/*' };
            if (proxyAuth) reqHeaders['Proxy-Authorization'] = proxyAuth;

            if (proxy.type === 'socks5' || proxy.type === 'socks4') {
                const agent = createProxyAgent(proxy);
                const req = https.request({
                    hostname: 'ipapi.co', path: '/country_name/', method: 'GET',
                    agent, timeout: 5000, headers: { 'User-Agent': 'curl/7.88.0' }
                }, (res) => {
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => resolve(body.trim() || 'Unknown'));
                });
                req.on('error', () => resolve('Unknown'));
                req.on('timeout', () => { req.destroy(); resolve('Unknown'); });
                req.end();
            } else {
                const req = http.request({
                    hostname: proxy.host, port: proxy.port,
                    path: 'http://ip-api.com/json/?fields=country',
                    method: 'GET', headers: reqHeaders, timeout: 5000
                }, (res) => {
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => {
                        try { const j = JSON.parse(body); resolve((j && j.country) ? j.country : 'Unknown'); }
                        catch (e) { resolve('Unknown'); }
                    });
                });
                req.on('error', () => resolve('Unknown'));
                req.on('timeout', () => { req.destroy(); resolve('Unknown'); });
                req.end();
            }
        });
        _proxyCountryCache.set(cacheKey, country);
        return country;
    } catch (e) {
        _proxyCountryCache.set(cacheKey, 'Unknown');
        return 'Unknown';
    }
}


// ── 6. HTTP Wrapper ────────────────────────────────────────────
function sendRequest(urlStr, method, headers, postData, proxyStr = null, timeout = 30000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));

        const u = new URL(urlStr);
        let localHeaders = { ...headers };
        if (postData) {
            localHeaders['Content-Length'] = Buffer.byteLength(postData);
        }
        const reqOpts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: method,
            headers: localHeaders,
            timeout: timeout,
            // Browser-like TLS fingerprinting to bypass JA3 proxy drops
            ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA",
            ecdhCurve: "X25519:P-256:P-384",
            honorCipherOrder: false,
            secureOptions: require('crypto').constants.SSL_OP_NO_SSLv3 | require('crypto').constants.SSL_OP_NO_TLSv1 | require('crypto').constants.SSL_OP_NO_TLSv1_1
        };

        let proxy = proxyStr ? parseProxy(proxyStr) : null;
        if (proxyStr) {
            if (!proxy || isNaN(proxy.port) || proxy.port <= 0) return reject(new Error('FATAL: Invalid proxy. Aborting to prevent IP leak.'));
            reqOpts.agent = createProxyAgent(proxy);
        } else {
            // No proxy: use keepAlive agent for connection reuse
            reqOpts.agent = keepAliveAgent;
        }

        const req = https.request(reqOpts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('error', reject);
            res.on('end', () => {
                let body = Buffer.concat(chunks);
                const enc = res.headers['content-encoding'];
                if (enc === 'gzip') { try { body = zlib.gunzipSync(body); } catch (_) { } }
                else if (enc === 'deflate') { try { body = zlib.inflateSync(body); } catch (_) { } }
                else if (enc === 'br') { try { body = zlib.brotliDecompressSync(body); } catch (_) { } }
                else if (enc === 'zstd') {
                    // Node.js has no built-in zstd; Meta uses zstd for API responses.
                    // We request without zstd so Meta falls back to gzip/br.
                    // If Meta still sends zstd (shouldn't happen), body stays raw.
                    // Leave as-is — response will be parsed as raw bytes.
                }

                const setCookie = res.headers['set-cookie'] || [];

                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    let loc = res.headers.location;
                    if (!loc.startsWith('http')) loc = u.origin + loc;
                    let newHeaders = { ...headers };
                    let cookieHeader = (newHeaders['Cookie'] || '');
                    let newCookieStr = setCookie.map(c => c.split(';')[0]).join('; ');
                    if (newCookieStr) newHeaders['Cookie'] = cookieHeader ? (cookieHeader + '; ' + newCookieStr) : newCookieStr;

                    const nextMethod = (method === 'POST' && res.statusCode === 303) ? 'GET' : method;
                    resolve(sendRequest(loc, nextMethod, newHeaders, nextMethod === 'GET' ? null : postData, proxyStr, timeout, redirectCount + 1).then(redirectRes => {
                        return { ...redirectRes, cookies: [...setCookie, ...redirectRes.cookies] };
                    }));
                    return;
                }

                resolve({ status: res.statusCode, data: body.toString('utf8'), headers: res.headers, cookies: setCookie });
            });
        });

        req.on('error', (err) => {
            // Auto-retry once on proxy CONNECT drop (transient proxy failure)
            if (redirectCount === 0 && (err.message.includes('CONNECT') || err.message.includes('ended before') || err.message.includes('socket hang up') || err.message.includes('ECONNRESET'))) {
                // Wait 800ms then retry the same request once
                setTimeout(() => {
                    sendRequest(urlStr, method, headers, postData, proxyStr, timeout, redirectCount + 1)
                        .then(resolve).catch(reject);
                }, 800);
            } else {
                reject(err);
            }
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (postData) req.write(postData);
        req.end();
    });
}

function parseTokensFromHtml(html) {
    const tokens = {};
    const extract = (regex) => { const match = html.match(regex); return match ? match[1] : null; };

    // ── LSD Token ────────────────────────────────────────────────
    tokens.lsd = extract(/name="lsd" value="([^"]+)"/) ||
        extract(/"LSD",\s*\[\s*\],\s*\{\s*"token":\s*"([^"]+)"/) ||
        extract(/"lsd":\s*"([^"]+)"/) ||
        extract(/"token":"([^"]+)"/);

    // ── fb_dtsg Token (5 patterns — ported from token_extractor.py) ──
    // Pattern 1: DTSGInitData (most common in Comet/React pages)
    tokens.fb_dtsg = extract(/"DTSGInitData",\s*\[\s*\],\s*\{\s*"token":\s*"([^"]+)"/) ||
        // Pattern 2: DTSGInitialData (older variant)
        extract(/"DTSGInitialData",\s*\[\s*\],\s*\{\s*"token":\s*"([^"]+)"/) ||
        // Pattern 3: dtsg nested object
        extract(/"dtsg":\s*\{\s*"token":\s*"([^"]+)"/) ||
        // Pattern 4: fb_dtsg plain JSON key
        extract(/"fb_dtsg":\s*"([^"]+)"/) ||
        // Pattern 5: HTML input field (classic pages)
        extract(/name="fb_dtsg"\s+value="([^"]+)"/);

    // ── Other tokens ─────────────────────────────────────────────
    tokens.jazoest = extract(/name="jazoest" value="([^"]+)"/) ||
        extract(/"jazoest":\s*"([^"]+)"/) ||
        extract(/jazoest=(\d+)/);
    tokens.hsi = extract(/"hsi":\s*"([^"]+)"/);
    tokens.spin_r = extract(/"__spin_r":\s*(\d+)/);
    tokens.spin_b = extract(/"__spin_b":\s*"([^"]+)"/);
    tokens.spin_t = extract(/"__spin_t":\s*(\d+)/);
    tokens.rev = extract(/"server_revision":\s*(\d+)/) ||
        extract(/server_revision":\s*(\d+)/);

    // Dynamically extract the server-issued proxy geo-jurisdiction
    const rjMatch = html.match(/"regulation_jurisdiction":\s*(\[[^\]]+\])/);
    tokens.regulation_jurisdiction = rjMatch ? rjMatch[1] : '["US"]';

    if (!tokens.jazoest && tokens.lsd) {
        let sum = 0;
        for (let i = 0; i < tokens.lsd.length; i++) sum += tokens.lsd.charCodeAt(i);
        tokens.jazoest = '2' + sum;
    }
    return tokens;
}


// ── 8. Core API Logic (meta_account_creator.js) ───────────────
async function createAccount(phone, options = {}) {
    const { onStatus = () => { }, proxy = null, timeout = 30000, workerId = 0, browserPref = 'random', regionPref = 'random' } = options;
    const normalizedPhone = normalizePhoneNumber(phone);
    const barePhone = normalizedPhone.replace('+', '');
    const waterfall_id = uuid();
    const initialUrl = `https://auth.meta.com/?waterfall_id=${waterfall_id}&source_app_id=1522763855472543`;

    onStatus(`[1/4] Fetching initial session tokens...`);

    // Auto-detect country + language from the phone number's dial code
    const phoneGeo = getCountryFromPhone(barePhone);
    let langHeader = phoneGeo.lang;
    const phoneCountryISO = phoneGeo.iso;
    const tzOffset = typeof TZ_MAP !== 'undefined' && TZ_MAP[phoneCountryISO] !== undefined ? TZ_MAP[phoneCountryISO] : 0;

    try {
        const simOperators = getSimOperators(phoneCountryISO);
        const client = getRandomClient(browserPref, simOperators);

        const generatedDob = generateRandomDOB();
        const generatedPassword = generateRandomPassword();
        const generatedName = generateRandomName();

        // 1. Fetch tokens via HTTP GET through proxy (pure API, NO browser)
        const initStart = Date.now();
        onStatus(`[1/4] Fetching tokens (pure API, no browser)...`);
        const initHeaders = {
            'User-Agent': client.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': langHeader,
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            ...client.clientHints
        };
        const initRes = await sendRequest(initialUrl, 'GET', initHeaders, null, proxy, timeout);
        if (!initRes.data) throw new Error('Failed to load Meta page: empty response');

        let tokens = parseTokensFromHtml(initRes.data);
        if (!tokens.lsd || !tokens.jazoest) throw new Error('Failed to extract LSD/Jazoest tokens.');

        const initTime = Date.now() - initStart;
        onStatus(`[1/4] Tokens in ${initTime}ms. Bypassing reg_integrity...`);

        let cookieMap = {};
        const updateCookies = (cookiesArr) => {
            if (!cookiesArr) return;
            cookiesArr.forEach(c => {
                const parts = c.split(';')[0].split('=');
                if (parts.length >= 2) cookieMap[parts[0].trim()] = parts.slice(1).join('=').trim();
            });
        };
        updateCookies(initRes.cookies);

        // ── Live session tokens — Aug 5, 2026 capture (uniform across ALL calls, no early/late split) ──
        const liveDyn = '7xeUmwlEnwn8K2Wmh0no6u5U4e0yoW3q32360CEbo1nEhw2nVE4W099w8G1Dz81s8hwnU2lwv89k2C1Fwc60D82IzXwae4UaEW0Loco5G0zK1swa-0raazo7u0zE2ZwrU6C2q0XU6O1FwlU5G3y0zo7u0jW0eowRzE';
        const liveCsr = 'giemiHXXhlQZvEXntjOiHAGiiucCxjAF5gZecx2KWBAmRjAGi9K8w0ze80s20Kqa0eJwb200kXKawJAwmA0s-t2Ha05jEK04eE6S08Qw0F9P031oKewI81po1gF81kk0mm00BoU';
        const liveHsdp = 'getiq383NgGO3VE1589A0aOxq1eg026hw1zS';
        const liveHblp = '09mcwfau5EgAyo4a0Io9A0aOxqUaEvxy2S0kO0jy02-a03i-04yo10U980oZw7qxm5U8U0sawmE0gswlE4a06u8';
        const liveSjsp = 'getiqbk80';

        // __s is static per session (Aug 5 capture: same value across all 8 calls)
        const sessionId = genSessionId(); // generated once, reused for all calls

        const getBasePayload = (reqVal) => {
            return `__user=0&__a=1&__req=${reqVal}&__hs=20670.HYP:frl_comet_auth_pkg.2.1...0&dpr=${client.hw.dpr}&__ccg=EXCELLENT&__rev=${tokens.rev || 1044526173}&__s=${sessionId}&__hsi=${tokens.hsi || ''}&__dyn=${liveDyn}&__csr=${liveCsr}&__hsdp=${liveHsdp}&__hblp=${liveHblp}&__sjsp=${liveSjsp}&__comet_req=33&lsd=${tokens.lsd}&jazoest=${tokens.jazoest || ''}&__spin_r=${tokens.spin_r || tokens.rev || 1044526173}&__spin_b=trunk&__spin_t=${tokens.spin_t || Math.floor(Date.now() / 1000)}&__jssesw=1`;
        };

        // Build x-fb-device-locale from phone country ISO (e.g. 'it_IT', 'en_US')
        const fbDeviceLocale = (() => {
            const lang = langHeader.split(',')[0].trim(); // e.g. 'it-IT'
            const parts = lang.split('-');
            if (parts.length >= 2) return `${parts[0]}_${parts[1]}`;
            return lang.replace('-', '_');
        })();

        const getHeaders = () => {
            const base = {
                'accept-language': langHeader,
                'sec-gpc': '1',
                'user-agent': client.userAgent,
                'accept': '*/*',
                'accept-encoding': 'gzip, br',
                'content-type': 'application/x-www-form-urlencoded',
                'origin': 'https://auth.meta.com',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-asbd-id': '359341',
                'x-fb-lsd': tokens.lsd,
                'referer': initialUrl,
                'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
                ...client.clientHints
            };

            // ── Inject x-fb-device-* headers from device fingerprint (observed in successful log) ──
            if (client.device) {
                const d = client.device;
                base['x-fb-timezone-offset'] = String(tzOffset * -60); // TZ_MAP stores minutes, convert to seconds inverted
                base['x-fb-device-locale'] = fbDeviceLocale;
                base['x-fb-device-cpu'] = d.cpu;
                base['x-fb-device-gpu'] = d.gpu;
                base['x-fb-device-model'] = d.model;
                base['x-fb-device-ram'] = String(d.ram);
                base['x-fb-hwid'] = d.hwid;
                base['x-fb-connection-type'] = d.connType;
                base['x-fb-device-group'] = d.deviceGroup;
                base['x-fb-network-quality'] = d.networkQuality;
                base['x-fb-screen-density'] = String(d.dpr);
                base['x-fb-sim-operator-name'] = d.simOperator;
                base['x-fb-boot-id'] = d.bootId;
                base['x-fb-advertising-id'] = d.advertisingId;
                base['x-fb-device-battery'] = String(d.battery);
                base['x-fb-is-charging'] = String(d.isCharging);
                base['x-fb-device-uptime'] = String(d.uptime);
                base['x-fb-session-id'] = d.sessionId;
                base['x-fb-foreground-time'] = String(d.fgTime);
                base['x-fb-screen-state'] = '1';
                base['x-fb-data-saver'] = '0';
                base['x-fb-notifications'] = '1';
                base['x-fb-connection-bandwidth'] = String(d.bandwidth);
                base['x-fb-device-soc-manufacturer'] = d.socManufacturer;
                // Platform-specific extras
                if (d.platform === 'android' && d.gpsVersion) {
                    base['x-fb-gps-version'] = d.gpsVersion;
                }
                if (d.platform === 'ios') {
                    base['x-fb-device-family'] = d.family;
                    base['x-fb-device-os-version'] = d.osVersion;
                }
            }

            return base;
        };

        // 2. Check Contact Point (__req=j — Aug 5 capture)
        onStatus(`[2/4] Verifying phone number...`);
        const csi = Array(24).fill(0).map(() => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
        // Aug 5 capture: account_reg_info[birthday] = TODAY's date (not account DOB)
        //                phone number sent WITHOUT + prefix in first call
        const todayDate = new Date().toISOString().split('T')[0]; // e.g. "2026-08-05"
        const checkPayload = `account_reg_info[birthday]=${todayDate}&account_reg_info[device_id]=&account_reg_info[first_name]=&account_reg_info[has_youth_consent]=false&account_reg_info[is_bootstrap_flow]=false&account_reg_info[last_name]=&account_reg_info[pc_rendering_data]=&account_reg_info[phone_number]=${barePhone}&account_reg_info[registration_flow_id]=&allow_unconfirmed_email=false&check_for_pre_registration_restrictions=true&check_mma_account=true&contact_point=${barePhone}&contact_point_type=PHONE_NUMBER&reg_integrity=&check_ntm_qe=true&skip_xapp_checks=false&caa_event_flow=csi&csi=${csi}&event_client_time=${(Date.now() / 1000).toFixed(3)}&waterfall_id=${waterfall_id}&source_app_id=1522763855472543&qpl_join_id=${genQplJoinId()}&` + getBasePayload('j');

        debugLog(barePhone, 'check-contact-req', { url: 'https://auth.meta.com/api/check-contact-point-availability/', method: 'POST', headers: getHeaders(), payload: checkPayload });
        const checkRes = await sendRequest('https://auth.meta.com/api/check-contact-point-availability/', 'POST', getHeaders(), checkPayload, proxy, timeout);
        debugLog(barePhone, 'check-contact-res', { status: checkRes.status, headers: checkRes.headers, body: checkRes.data });
        if (checkRes.status !== 200) throw new Error(`Invalid response: ${checkRes.status}`);
        updateCookies(checkRes.cookies);



        // Extract reg_integrity and device_id from check-contact response (Meta's JS does this!)
        let regIntegrity = '';
        let serverDeviceId = '';
        let contactError = null;
        try {
            const data = JSON.parse(checkRes.data.replace('for (;;);', ''));
            // Check for existing/pending account errors
            if (data.error === 3571123 || data.error === 3571188) {
                contactError = data.error;
                onStatus(`[2/4] Number has existing account (${data.error === 3571123 ? 'registered' : 'pending'}) → switching to reset flow...`);
            } else if (data.error) {
                throw new Error(data.errorDescription || data.errorSummary || 'Verification failed');
            } else {
                if (data.payload && data.payload.is_contact_point_available === false) throw new Error(data.payload.error_message || 'Phone number not available');
                // KEY: extract reg_integrity from check-contact response (server provides it!)
                const serverRI = data.payload && (data.payload.regIntegrity || data.payload.reg_integrity);
                if (serverRI) {
                    regIntegrity = encodeURIComponent(serverRI);
                    onStatus(`[2/4] ✅ Got reg_integrity from server (pure API, no browser!)`);
                }
                // Extract device_id from server response
                if (data.payload && data.payload.restrictions && data.payload.restrictions.restriction_data && data.payload.restrictions.restriction_data.account_reg_info) {
                    serverDeviceId = data.payload.restrictions.restriction_data.account_reg_info.device_id || '';
                }
            }
        } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
        }

        // BRANCH: Login OTP Flow (for existing/pending accounts)
        // ═══════════════════════════════════════════════════════════
        if (contactError) {
            onStatus(`[3/4] Sending login OTP to existing account...`);

            // Single call: login-email-otp/send-nonce — sends OTP to phone
            const noncePayload = `contact_point=%2B${barePhone}&caa_event_flow=ntf&csi=${csi}&source_app_id=1522763855472543&waterfall_id=${waterfall_id}&qpl_join_id=&` + getBasePayload('r');
            debugLog(barePhone, 'send-nonce-req', { url: 'https://auth.meta.com/api/login-email-otp/send-nonce/', method: 'POST', headers: getHeaders(), payload: noncePayload });
            const nonceRes = await sendRequest('https://auth.meta.com/api/login-email-otp/send-nonce/', 'POST', getHeaders(), noncePayload, proxy, timeout);
            debugLog(barePhone, 'send-nonce-res', { status: nonceRes.status, headers: nonceRes.headers, body: nonceRes.data });
            updateCookies(nonceRes.cookies);



            let nonceSuccess = false;
            let nonceMsg = '';
            try {
                const nonceData = JSON.parse(nonceRes.data.replace('for (;;);', ''));
                if (nonceData.error) {
                    onStatus(`[4/4] send-nonce error ${nonceData.error}: ${nonceData.errorDescription || nonceData.errorSummary || 'unknown'}`);
                    nonceMsg = nonceData.errorDescription || nonceData.errorSummary || `Error ${nonceData.error}`;
                } else if (nonceData.payload && (nonceData.payload.nonce_sent === true || nonceData.payload.nonceSent === true)) {
                    nonceSuccess = true;
                    nonceMsg = 'Login OTP confirmed (nonce_sent=true)';
                    onStatus(`[4/4] ✅ ${nonceMsg}`);
                } else if (nonceData.payload && Object.keys(nonceData.payload).length > 0) {
                    nonceSuccess = true;
                    nonceMsg = `Login OTP likely sent (payload keys: ${Object.keys(nonceData.payload).join(', ')})`;
                    onStatus(`[4/4] ✅ ${nonceMsg}`);
                } else {
                    nonceMsg = `Silent block on login OTP → ${JSON.stringify(nonceData).substring(0, 200)}`;
                    onStatus(`[4/4] ⚠️ ${nonceMsg}`);
                }
            } catch (e) {
                nonceMsg = `Non-JSON response from send-nonce (${(nonceRes.data || '').length} bytes)`;
                onStatus(`[4/4] ⚠️ ${nonceMsg}`);
            }

            if (nonceSuccess) {
                // Loop for requested resends
                for (let r = 0; r < (options.resends || 0); r++) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (options.onLog) options.onLog(`Resending OTP to +${barePhone} (${r + 1}/${options.resends})`, 'retry');
                    onStatus(`[4/4] 🔄 Resending OTP (${r + 1}/${options.resends})...`);
                    let rReq = (parseInt('r', 36) + r + 1).toString(36); // Increment __req (e.g., 's', 't', 'u')
                    let resendPayload = `contact_point=%2B${barePhone}&caa_event_flow=ntf&csi=${csi}&source_app_id=1522763855472543&waterfall_id=${waterfall_id}&qpl_join_id=${genQplJoinId()}&` + getBasePayload(rReq);
                    debugLog(barePhone, 'resend-nonce-req', { url: 'https://auth.meta.com/api/login-email-otp/send-nonce/', method: 'POST', headers: getHeaders(), payload: resendPayload });
                    let resendRes = await sendRequest('https://auth.meta.com/api/login-email-otp/send-nonce/', 'POST', getHeaders(), resendPayload, proxy, timeout);
                    debugLog(barePhone, 'resend-nonce-res', { status: resendRes.status, headers: resendRes.headers, body: resendRes.data });
                    updateCookies(resendRes.cookies);
                }

                return { success: true, message: 'Login OTP Sent successfully', phone: normalizedPhone, type: 'login_otp', password: 'N/A (existing)', dob: generatedDob, browser: client.name, lang: langHeader.substring(0, 5), proxy: proxy || 'direct' };
            } else {
                throw new Error('Login OTP flow failed - could not send OTP');
            }
        }

        // ═══════════════════════════════════════════════════════════
        // CONTINUE: Normal Registration Flow (for new numbers)
        // ═══════════════════════════════════════════════════════════

        // 3. Check password + marketing (Aug 5 capture: q → t → u sequence)
        onStatus(`[3/4] Password + DOB check...`);
        const hardcodedPassword = 'akash99ak';
        const encPasswordStr = `#PWD_BROWSER:0:${Math.floor(Date.now() / 1000)}:${hardcodedPassword}`;

        // Step q: First check-password call (Aug 5 capture shows this BEFORE marketing, __req=q)
        const passPayloadQ = `contact_point=${encodeURIComponent(normalizedPhone)}&date_of_birth=${generatedDob.full}&name=&password=${encodeURIComponent(encPasswordStr)}&contact_pointless_account=false&qpl_join_id=${genQplJoinId()}&` + getBasePayload('q');
        debugLog(barePhone, 'check-password-1-req', { url: 'https://auth.meta.com/api/check-password/', method: 'POST', headers: getHeaders(), payload: passPayloadQ });
        const passResQ = await sendRequest('https://auth.meta.com/api/check-password/', 'POST', getHeaders(), passPayloadQ, proxy, timeout);
        debugLog(barePhone, 'check-password-1-res', { status: passResQ.status, headers: passResQ.headers, body: passResQ.data });
        updateCookies(passResQ.cookies);

        // Step t: First marketing opt-in call (Aug 5 capture: __req=t, comes BEFORE second check-password)
        const marketingPayloadT = `date_of_birth=${generatedDob.full}&` + getBasePayload('t');
        const marketingResT = await sendRequest('https://auth.meta.com/api/eligible-for-default-marketing-opt-in/', 'POST', getHeaders(), marketingPayloadT, proxy, timeout);
        updateCookies(marketingResT.cookies);

        // Step u: Second check-password call (__req=u — same as before)
        const passPayload = `contact_point=${encodeURIComponent(normalizedPhone)}&date_of_birth=${generatedDob.full}&name=&password=${encodeURIComponent(encPasswordStr)}&contact_pointless_account=false&qpl_join_id=${genQplJoinId()}&` + getBasePayload('u');
        debugLog(barePhone, 'check-password-2-req', { url: 'https://auth.meta.com/api/check-password/', method: 'POST', headers: getHeaders(), payload: passPayload });
        const passRes = await sendRequest('https://auth.meta.com/api/check-password/', 'POST', getHeaders(), passPayload, proxy, timeout);
        debugLog(barePhone, 'check-password-2-res', { status: passRes.status, headers: passRes.headers, body: passRes.data });
        updateCookies(passRes.cookies);

        // check-date-of-birth: __req=w (capture)
        const dobPayload = `caa_event_flow=ntm&date_of_birth=${generatedDob.full}&first_name=&has_youth_consent=false&isf=false&last_name=&phone_number=${encodeURIComponent(normalizedPhone)}&qpl_join_id=${genQplJoinId()}&reg_integrity=${regIntegrity}&source_app_id=1522763855472543&` + getBasePayload('w');
        debugLog(barePhone, 'check-dob-req', { url: 'https://auth.meta.com/api/check-date-of-birth/', method: 'POST', headers: getHeaders(), payload: dobPayload });
        const dobRes = await sendRequest('https://auth.meta.com/api/check-date-of-birth/', 'POST', getHeaders(), dobPayload, proxy, timeout);
        debugLog(barePhone, 'check-dob-res', { status: dobRes.status, headers: dobRes.headers, body: dobRes.data });
        updateCookies(dobRes.cookies);



        // If check-dob returns a server-issued regIntegrity, use THAT for register_save
        try {
            const dobData = JSON.parse(dobRes.data.replace('for (;;);', ''));
            if (dobData.error) throw new Error(dobData.errorDescription || dobData.errorSummary || 'DOB check failed');
            if (dobData.payload && dobData.payload.regIntegrity) {
                regIntegrity = encodeURIComponent(dobData.payload.regIntegrity);
                onStatus(`[3/4] Got server-issued regIntegrity (pure API, no browser!)...`);
            }
        } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
        }

        // suggest_username: __req=x (Aug 5 capture — comes right after check-dob, marketing call moved to t)
        const suggestPayload = `linked_account_display_name=&linked_account_type=&linked_account_username=&` + getBasePayload('x');
        debugLog(barePhone, 'suggest-username-req', { url: 'https://auth.meta.com/api/kadabra/suggest_username/', method: 'POST', headers: getHeaders(), payload: suggestPayload });
        const suggestRes = await sendRequest('https://auth.meta.com/api/kadabra/suggest_username/', 'POST', getHeaders(), suggestPayload, proxy, timeout);
        updateCookies(suggestRes.cookies);
        let serverUsername = '';
        try {
            const suggestData = JSON.parse(suggestRes.data.replace('for (;;);', ''));
            if (suggestData.payload && suggestData.payload.username) serverUsername = suggestData.payload.username;
        } catch (e) { }
        const username = serverUsername || (generatedName.first.toLowerCase() + '_' + generatedName.last.toLowerCase() + '_' + Math.floor(Math.random() * 9999));

        // BZ telemetry skipped — client-side tracking only, not required for OTP dispatch

        // 4. Finalize Profile & Save Credentials (Triggers SMS dispatch)
        onStatus(`[4/4] Finalizing profile to dispatch SMS...`);
        // Second marketing call — __req=y (Aug 5 capture: after suggest_username, before check_profile)
        const marketingPayload2 = `date_of_birth=${generatedDob.full}&` + getBasePayload('y');
        const marketingRes2 = await sendRequest('https://auth.meta.com/api/eligible-for-default-marketing-opt-in/', 'POST', getHeaders(), marketingPayload2, proxy, timeout);
        updateCookies(marketingRes2.cookies);

        // check_profile: __req=13, caa_event_flow=ntf (Aug 5 capture — was ntm, now ntf)
        const profilePayload = `client_consent_timestamp=${Math.floor(Date.now() / 1000)}&display_name=&foa_import_source_name=&foa_import_source_obid=&nta_disclosures_summary_cms_id=&picture_source=&tos_cms_id=957798449862312&username=${username}&caa_event_flow=ntf&csi=${csi}&source_app_id=1522763855472543&waterfall_id=${waterfall_id}&is_submit=true&` + getBasePayload('13');
        debugLog(barePhone, 'check-profile-req', { url: 'https://auth.meta.com/api/kadabra/check_profile/', method: 'POST', headers: getHeaders(), payload: profilePayload });
        const profileRes = await sendRequest('https://auth.meta.com/api/kadabra/check_profile/', 'POST', getHeaders(), profilePayload, proxy, timeout);
        debugLog(barePhone, 'check-profile-res', { status: profileRes.status, headers: profileRes.headers, body: profileRes.data });
        updateCookies(profileRes.cookies);


        // Final trigger for SMS
        const stateObj = {
            "csrf_token": crypto.randomBytes(32).toString('base64url'),
            "redirect_to": "https://www.meta.ai/oidc/callback",
            "waterfall_id": waterfall_id
        };
        const encodedState = Buffer.from(JSON.stringify(stateObj)).toString('base64');
        const codeChallenge = crypto.randomBytes(32).toString('base64url');

        // Dynamically extracted proxy jurisdiction from initial server HTML payload
        let serverIso = 'US';
        try { serverIso = JSON.parse(tokens.regulation_jurisdiction)[0]; } catch (e) { }

        const redirectUriStr = encodeURIComponent(`https://auth.meta.com/oidc/?app_id=1522763855472543&redirect_uri=https%3A%2F%2Fauth.meta.ai%2Fecto&response_type=code&scope=openid%2Blinking&state=${encodedState}&waterfall_id=${waterfall_id}&code_challenge=${codeChallenge}&code_challenge_method=S256`);

        // regulation_jurisdiction: use actual phone country ISO (matches capture: ["BD"] for Bangladesh, etc.)
        // Falls back to server-extracted proxy jurisdiction if phone country not detected
        const jurisdictionIso = phoneCountryISO && phoneCountryISO !== 'US' ? phoneCountryISO : serverIso;
        const jurisdictionEncoded = encodeURIComponent(JSON.stringify([jurisdictionIso]));

        // register-save: __req=15, caa_event_flow=ntf (Aug 5 capture — was ntm, now ntf)
        const registerPayload = `client_consent_timestamp=${Math.floor(Date.now() / 1000)}&display_name=&foa_import_source_name=&foa_import_source_obid=&nta_disclosures_summary_cms_id=&picture_source=&tos_cms_id=957798449862312&username=${username}&consent_version=&contact_point=${encodeURIComponent(normalizedPhone)}&contact_point_type=PHONE_NUMBER&csi=${csi}&date_of_birth=${generatedDob.full}&device_id=${serverDeviceId}&fb_encrypted_access_token=&fb_oidc_access_token=&first_name=&google_id_token=&has_youth_consent=false&ig_encrypted_access_token=&ig_encrypted_auth_header=&ig_oidc_access_token=&last_name=&opt_into_marketing=false&password=${encodeURIComponent(encPasswordStr)}&redirect_uri=${redirectUriStr}&reg_integrity=${regIntegrity}&should_save_credentials=true&source_app_id=1522763855472543&third_party_age_verification_id=&waterfall_id=${waterfall_id}&caa_event_flow=ntf&entry_point=login_home&event_client_time=${(Date.now() / 1000).toFixed(3)}&is_kadabra_zero=false&reg_navigation_flow_name=new_to_family_c50_r1&regulation_jurisdiction=${jurisdictionEncoded}&qpl_join_id=${genQplJoinId()}&` + getBasePayload('15');

        debugLog(barePhone, 'register-save-req', { url: 'https://auth.meta.com/login/device-based/kadabra-register-save-credentials/', method: 'POST', headers: getHeaders(), payload: registerPayload });
        const regRes = await sendRequest('https://auth.meta.com/login/device-based/kadabra-register-save-credentials/', 'POST', getHeaders(), registerPayload, proxy, timeout);
        debugLog(barePhone, 'register-save-res', { status: regRes.status, headers: regRes.headers, body: regRes.data });
        updateCookies(regRes.cookies);

        // ── Extract dtsgToken from register-save response ──
        // Capture shows: "dtsgToken":"NAfy_wPEby-U06_...","dtsgAsyncGetToken":"Ad58dzo5..."
        // These are the REAL fb_dtsg tokens available for use in resend mutations
        try {
            const regRawForDtsg = (regRes.data || '').replace('for (;;);', '');
            const dtsgMatch = regRawForDtsg.match(/"dtsgToken":"([^"]+)"/);
            const dtsgAsyncMatch = regRawForDtsg.match(/"dtsgAsyncGetToken":"([^"]+)"/);
            if (dtsgMatch) tokens.fb_dtsg = dtsgMatch[1].split(':')[0]; // strip the ":13:timestamp" suffix
            if (dtsgAsyncMatch && !tokens.fb_dtsg) tokens.fb_dtsg = dtsgAsyncMatch[1].split(':')[0];
        } catch (_) { }

        if (regRes.status !== 200) throw new Error(`Meta API failed with HTTP ${regRes.status}`);

        // ── STRICT SUCCESS VALIDATION ──
        // Meta ALWAYS returns HTTP 200, even when silently blocking.
        // We must parse the actual response body to confirm SMS dispatch.
        const rawRegBody = regRes.data || '';
        let registrationConfirmed = false;
        let regResultMessage = '';

        try {
            const finalData = JSON.parse(rawRegBody.replace('for (;;);', ''));

            // CASE 1: Explicit error from Meta
            if (finalData.error) {
                throw new Error(finalData.errorDescription || finalData.errorSummary || `Registration blocked (Error ${finalData.error})`);
            }
            if (finalData.payload && finalData.payload.error_message) {
                throw new Error(finalData.payload.error_message);
            }

            // CASE 2: Confirmed success indicators
            // Meta returns a redirect_uri or nonce_sent when SMS is actually dispatched
            if (finalData.payload) {
                if (finalData.payload.redirect_uri || finalData.payload.redirectUri || finalData.payload.redirect) {
                    registrationConfirmed = true;
                    regResultMessage = 'Registration confirmed (redirect received)';
                } else if (finalData.payload.nonce_sent === true || finalData.payload.nonceSent === true) {
                    registrationConfirmed = true;
                    regResultMessage = 'OTP confirmed (nonce_sent=true)';
                } else if (finalData.payload.session_id || finalData.payload.sessionId || finalData.payload.confirmation_code) {
                    registrationConfirmed = true;
                    regResultMessage = 'Registration confirmed (session created)';
                } else {
                    // Payload exists but no known confirmation signal
                    // Check if payload is non-empty (Meta sometimes returns minimal success payloads)
                    const payloadKeys = Object.keys(finalData.payload);
                    if (payloadKeys.length > 0 && !finalData.payload.error_message) {
                        registrationConfirmed = true;
                        regResultMessage = `Registration likely succeeded (payload keys: ${payloadKeys.join(', ')})`;
                    } else {
                        throw new Error(`Silent block: Meta returned empty/unrecognized payload → ${JSON.stringify(finalData.payload).substring(0, 200)}`);
                    }
                }
            } else if (finalData.redirect_uri || finalData.redirectUri) {
                registrationConfirmed = true;
                regResultMessage = 'Registration confirmed (top-level redirect)';
            } else {
                // No payload, no redirect, no error — this is a silent block
                throw new Error(`Silent block: Meta returned no payload → ${JSON.stringify(finalData).substring(0, 300)}`);
            }

        } catch (e) {
            if (e instanceof SyntaxError) {
                // Response was not JSON — could be HTML redirect (which is actually a success!)
                if (rawRegBody.includes('checkpoint') || rawRegBody.includes('security_check')) {
                    throw new Error('Account hit checkpoint/security block');
                } else if (rawRegBody.includes('auth.meta.com/oidc') || rawRegBody.includes('confirmation') || rawRegBody.includes('verify')) {
                    registrationConfirmed = true;
                    regResultMessage = 'Registration confirmed (HTML redirect to verification)';
                } else {
                    throw new Error(`Silent block: Non-JSON response (${rawRegBody.length} bytes) → ${rawRegBody.substring(0, 200)}`);
                }
            } else {
                throw e;
            }
        }

        if (!registrationConfirmed) {
            throw new Error('Registration failed: no confirmation signal from Meta');
        }

        // ── Loop for requested resends ──
        let actualResends = Math.max(0, (options.resends || 0));
        const resendMethod = options.resendMethod || 'old';
        for (let r = 0; r < actualResends; r++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            if (options.onLog) options.onLog(`Resending OTP to ${normalizedPhone} (${r + 1}/${actualResends})`, 'retry');
            onStatus(`[4/4] 🔄 Resending OTP (${r + 1}/${actualResends})...`);

            if (resendMethod === 'new') {
                // NEW: FRLResendOTPMutation via /api/graphql/
                // fb_dtsg: prefer HTML-parsed token, fallback to cookie
                const fbDtsg = tokens.fb_dtsg || cookieMap['fb_dtsg'] || '';
                const resendVariables = JSON.stringify({
                    "input": {
                        "contact_point": { "sensitive_string_value": normalizedPhone },
                        "contact_point_type": "PHONE_NUMBER",
                        "event_flow": "ntm",
                        "rl_client_session_id": csi,
                        "source_app_id": 1522763855472543,
                        "waterfall_id": waterfall_id,
                        "actor_id": "0",
                        "client_mutation_id": String(r + 1)
                    }
                });
                const resendBody = new URLSearchParams({
                    'av': '0',
                    '__user': '0',
                    '__a': '1',
                    '__req': (parseInt('1t', 36) + r).toString(36),
                    '__hs': '20670.HYP:frl_comet_auth_pkg.2.1...0',
                    'dpr': '1',
                    '__ccg': 'EXCELLENT',
                    '__rev': tokens.rev || '1044526173',
                    '__s': sessionId,
                    '__hsi': tokens.hsi || '',
                    '__dyn': liveDyn,
                    '__csr': liveCsr,
                    '__hsdp': liveHsdp,
                    '__hblp': liveHblp,
                    '__sjsp': liveSjsp,
                    '__comet_req': '33',
                    'fb_dtsg': fbDtsg,
                    'jazoest': tokens.jazoest || '',
                    'lsd': tokens.lsd,
                    '__spin_r': tokens.spin_r || tokens.rev || '1042969831',
                    '__spin_b': 'trunk',
                    '__spin_t': tokens.spin_t || String(Math.floor(Date.now() / 1000)),
                    '__jssesw': '1',
                    'fb_api_caller_class': 'RelayModern',
                    'fb_api_req_friendly_name': 'FRLResendOTPMutation',
                    'server_timestamps': 'true',
                    'variables': resendVariables,
                    'doc_id': '25885129117818218'
                }).toString();
                const resendHeaders = {
                    ...getHeaders(),
                    'x-fb-friendly-name': 'FRLResendOTPMutation'
                };
                let resendRes = await sendRequest('https://auth.meta.com/api/graphql/', 'POST', resendHeaders, resendBody, proxy, timeout);
                debugLog(barePhone, 'resend-graphql-res', { status: resendRes.status, body: resendRes.data });
                updateCookies(resendRes.cookies);
            } else {
                // OLD: re-post to kadabra-register-save-credentials
                // __req was 15 in the original, increment from there for resends
                let rReq = (parseInt('15', 36) + r + 1).toString(36);
                let resendPayload = registerPayload.replace(/&__req=15&/, `&__req=${rReq}&`);
                let resendRes = await sendRequest('https://auth.meta.com/login/device-based/kadabra-register-save-credentials/', 'POST', getHeaders(), resendPayload, proxy, timeout);
                debugLog(barePhone, 'resend-register-res', { status: resendRes.status, body: resendRes.data });
                updateCookies(resendRes.cookies);
            }
        }

        onStatus(`[4/4] ✅ ${regResultMessage}`);


        return { success: true, message: regResultMessage, phone: normalizedPhone, type: 'registration', password: generatedPassword, dob: generatedDob, browser: client.name, lang: langHeader.substring(0, 5), proxy: proxy || 'direct' };
    } catch (error) {
        return { success: false, message: `Failed: ${error.message}`, phone: normalizedPhone };
    }
}


// ── 9. Main Orchestrator (index.js logic) ──────────────────────
if (isMainThread) {
    class Dashboard {
        constructor(totalNumbers) {
            this.totalNumbers = totalNumbers;
            this.processed = 0;
            this.successful = 0;
            this.failed = 0;
            this.startTime = Date.now();
        }

        addLog(msg, type, metaInfo = '') {
            let line = '';
            const phoneMatch = msg.match(/\d{8,}/);
            const phone = phoneMatch ? phoneMatch[0] : '';
            const metaStr = metaInfo ? chalk.gray(` ${metaInfo}`) : '';

            if (type === 'success') {
                line = chalk.hex('#00FF88')('SK — Meta │ OTP Sent → ') +
                    chalk.hex('#FCAF45').bold(phone || msg) + metaStr;
            } else if (type === 'error' || type === 'failed') {
                let reason = msg.replace(/Failed on \S+: /, '').replace(/Fatal error on \S+: /, '');
                if (reason.toLowerCase().includes('proxy')) {
                    line = chalk.hex('#FF4466')('SK — Meta │ Proxy Drop → ') +
                        chalk.hex('#888888')(reason) + metaStr;
                } else {
                    line = chalk.hex('#FF4466')('SK — Meta │ Failed → ') +
                        chalk.hex('#FCAF45').bold(phone) + metaStr +
                        chalk.hex('#888888')(` (${reason})`);
                }
            } else if (type === 'retry') {
                let retryContext = msg.includes('(') ? msg.substring(msg.indexOf('(')) : '';
                line = chalk.hex('#FCAF45')('SK — Meta │ Resending  → ') +
                    chalk.hex('#FCAF45').bold(phone) + metaStr +
                    chalk.hex('#888888')(` ${retryContext}`);
            } else {
                return; // Do not print other types
            }
            process.stdout.write(`\r\x1b[K${line}\n`);
            this.render();
        }

        setStatus(msg) { }
        update() { }

        render() {
            const pct = ((this.processed / Math.max(this.totalNumbers, 1)) * 100).toFixed(1);
            const bar = `  ${W.bold('SK-V5')} ⮞ [${this.processed}/${this.totalNumbers}] ${pct}% │ ${B('OK: ' + this.successful)} │ ${R('Err: ' + this.failed)}`;
            process.stdout.write(`\r\x1b[K${bar}`);
        }

        stop() {
            process.stdout.write('\x1b[2K\r\n');
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            const timeStr = `${m}m ${s}s`;

            console.log(C(`  ╔════════════════════════════════════════════╗`));
            console.log(C(`  ║`) + W.bold(`  SKING V5 — COMPLETE                       `) + C(`║`));
            console.log(C(`  ╠════════════════════════════════════════════╣`));
            console.log(C(`  ║`) + `  ${chalk.greenBright('Successful')}   ${chalk.greenBright(String(this.successful).padStart(6))}                       ` + C(`║`));
            console.log(C(`  ║`) + `  ${chalk.red('Failed')}       ${chalk.red(String(this.failed).padStart(6))}                       ` + C(`║`));
            console.log(C(`  ║`) + `  ${chalk.cyan('Total Time')}   ${chalk.cyan(timeStr.padEnd(6))}                       ` + C(`║`));
            console.log(C(`  ╚════════════════════════════════════════════╝\n`));
        }
    }



    async function selectOption(title, options) {
        return new Promise((resolve) => {
            let cursor = 0;
            process.stdin.resume(); // Force un-pause terminal stream
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);

            // Re-render function
            const draw = () => {
                process.stdout.write('\x1b[2J\x1b[H'); // clear screen
                printHeader();
                console.log(`   \x1b[33m${title}\x1b[0m\n`);
                options.forEach((opt, idx) => {
                    if (idx === cursor) {
                        console.log(`   \x1b[36m➔\x1b[32m ${opt.name}\x1b[0m`);
                    } else {
                        console.log(`     \x1b[90m${opt.name}\x1b[0m`);
                    }
                });
            };

            draw();

            const onKeyPress = (_, key) => {
                if (key.ctrl && key.name === 'c') {
                    process.exit(0);
                }
                if (key.name === 'up') {
                    cursor = (cursor - 1 + options.length) % options.length;
                    draw();
                } else if (key.name === 'down') {
                    cursor = (cursor + 1) % options.length;
                    draw();
                } else if (key.name === 'return') {
                    process.stdin.setRawMode(false);
                    process.stdin.removeListener('keypress', onKeyPress);
                    resolve(options[cursor].value);
                }
            };

            process.stdin.on('keypress', onKeyPress);
        });
    }

    async function promptText(title, defaultValue) {
        return new Promise((resolve) => {
            process.stdout.write(`   \x1b[33m${title}\x1b[0m `);
            let input = '';

            // Ensure raw mode is off for text entry
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.resume();

            const onData = (chunk) => {
                const str = chunk.toString();
                if (str.includes('\n') || str.includes('\r')) {
                    process.stdin.removeListener('data', onData);
                    input += str.split(/[\r\n]/)[0]; // Capture the text before the newline
                    let cleanAnswer = input.trim();
                    if (cleanAnswer.startsWith('"') && cleanAnswer.endsWith('"')) {
                        cleanAnswer = cleanAnswer.slice(1, -1);
                    } else if (cleanAnswer.startsWith("'") && cleanAnswer.endsWith("'")) {
                        cleanAnswer = cleanAnswer.slice(1, -1);
                    }
                    resolve(cleanAnswer || defaultValue);
                } else {
                    input += str;
                }
            };
            process.stdin.on('data', onData);
        });
    }

    async function interactiveWizard() {
        let step = 1;
        let numSource = 'file';
        let numbersFile = 'numbers.txt';
        let nexaConfig = null;
        let twoOoConfig = null;
        let smsBowerConfig = null;
        let zenexConfig = null;
        let proxiesFile = 'none';
        let threads = 20;
        let region = 'random';
        let browser = 'random';
        let resends = 0;
        let resendMethod = 'old';

        let apiKey = '';
        let ranges = [];
        let totalCount = 50;
        let serverEndpoint = '/api/v1/numbers/get';

        const NEXA_KEY_FILE = path.join(__dirname, '.nexa_api_key');

        while (true) {
            process.stdout.write('\x1b[2J\x1b[H');
            printHeader();

            if (step === 1) {
                // Step 1: Number Source
                const choice = await selectOption("SELECT NUMBER SOURCE", [
                    { name: "📁 Load from file (numbers.txt)", value: "file" },
                    { name: "🌐 Auto fetch from NexaOTP Panel", value: "nexa" },
                    { name: "⚡ Auto fetch from Voltx (2oo9)", value: "voltx" },
                    { name: "🔥 Auto fetch from Stex (2oo9)", value: "stex" },
                    { name: "📱 Auto fetch from SMS Bower", value: "smsbower" },
                    { name: "⚡ Auto fetch from Zenex", value: "zenex" },
                    { name: "❌ Exit Program", value: "exit" }
                ]);

                if (choice === 'exit') process.exit(0);
                numSource = choice;
                step = 2;
            } else if (step === 2) {
                // Step 2: Numbers File OR NexaOTP Config
                if (numSource === 'file') {
                    const fileChoice = await selectOption("SELECT TARGET NUMBERS FILE", [
                        { name: "📄 numbers.txt (Default)", value: "numbers.txt" },
                        { name: "✏️ Custom File Path", value: "custom" },
                        { name: "⬅️ Go Back to Number Source", value: "back" }
                    ]);

                    if (fileChoice === 'back') {
                        step = 1;
                        continue;
                    }
                    if (fileChoice === 'custom') {
                        const input = await promptText("Enter Numbers File Path:", "numbers.txt");
                        if (input.toLowerCase() === 'back') continue;
                        numbersFile = input;
                    } else {
                        numbersFile = fileChoice;
                    }

                    if (!fs.existsSync(numbersFile)) fs.writeFileSync(numbersFile, '');
                    nexaConfig = null;
                    step = 3;
                } else if (numSource === 'voltx' || numSource === 'stex') {
                    const providerLabel = numSource === 'voltx' ? 'Voltx ⚡' : 'Stex 🔥';
                    const keyFile = numSource === 'voltx' ? VOLTX_KEY_FILE : STEX_KEY_FILE;
                    const getPath = numSource === 'voltx' ? TWOOO_VOLTX_GET : TWOOO_STEX_GET;
                    const consolePath = numSource === 'voltx' ? TWOOO_VOLTX_CONSOLE : TWOOO_STEX_CONSOLE;
                    let ooApiKey = '', ooRanges = [], ooTotal = 50, cancelOo = false, ooStep = 1;
                    while (ooStep <= 3 && !cancelOo) {
                        process.stdout.write('\x1b[2J\x1b[H'); printHeader();
                        if (ooStep === 1) {
                            if (fs.existsSync(keyFile)) {
                                ooApiKey = fs.readFileSync(keyFile, 'utf8').trim();
                                const ka = await selectOption(`${providerLabel} key found (${ooApiKey.substring(0, 10)}...)`, [
                                    { name: 'Use saved key', value: 'use' }, { name: 'Enter new key', value: 'new' },
                                    { name: 'Remove saved key', value: 'remove' }, { name: '⬅️ Back', value: 'back' }
                                ]);
                                if (ka === 'back') { cancelOo = true; break; }
                                if (ka === 'remove') { fs.existsSync(keyFile) && fs.unlinkSync(keyFile); ooApiKey = ''; }
                                else if (ka === 'new') { ooApiKey = ''; }
                            }
                            if (!ooApiKey) {
                                const ki = await promptText(`Enter ${providerLabel} API Key (mauthapi):`, '');
                                if (ki.toLowerCase() === 'back') { cancelOo = true; break; }
                                ooApiKey = ki;
                                const sv = await selectOption('Save key?', [{ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }]);
                                if (sv === 'yes' && ooApiKey) fs.writeFileSync(keyFile, ooApiKey, 'utf8');
                            }
                            if (ooApiKey) ooStep = 2;
                        } else if (ooStep === 2) {
                            const rm = await selectOption('How to select ranges?', [
                                { name: '🔍 Auto Range Finder (scan console)', value: 'auto' },
                                { name: '✏️  Enter manually', value: 'manual' },
                                { name: '⬅️ Back', value: 'back' }
                            ]);
                            if (rm === 'back') { ooStep = 1; continue; }
                            if (rm === 'auto') {
                                const found = await autoRangeFinderFor2Oo(ooApiKey, consolePath, selectOption, promptText);
                                if (found && found.length > 0) { ooRanges = found; ooStep = 3; }
                            } else {
                                ooRanges = [];
                                let addMore = true;
                                while (addMore) {
                                    const r = await promptText(`Enter range #${ooRanges.length + 1} (e.g. 26134XXX) or 'back':`, '');
                                    if (r.toLowerCase() === 'back') { if (ooRanges.length === 0) break; else { ooRanges.pop(); continue; } }
                                    if (r) ooRanges.push(r);
                                    const a = await selectOption(`Added ${ooRanges.length}. Add another?`, [{ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }]);
                                    if (a === 'no') addMore = false;
                                }
                                if (ooRanges.length > 0) ooStep = 3;
                            }
                        } else if (ooStep === 3) {
                            const ci = await promptText('How many numbers? [default:50]:', '50');
                            if (ci.toLowerCase() === 'back') { ooStep = 2; continue; }
                            ooTotal = parseInt(ci) || 50;
                            twoOoConfig = { provider: numSource, apiKey: ooApiKey, getPath, consolePath, ranges: ooRanges, totalCount: ooTotal };
                            nexaConfig = null; ooStep = 4;
                        }
                    }
                    if (cancelOo) { step = 1; continue; }
                    step = 3;

                } else if (numSource === 'smsbower') {
                    let sbKey = '', sbService = 'fb', sbCountry = '0', sbMaxPrice = '0.5', sbTotal = 50, sbStep = 1, cancelSb = false;
                    while (sbStep <= 4 && !cancelSb) {
                        process.stdout.write('\x1b[2J\x1b[H'); printHeader();
                        if (sbStep === 1) {
                            if (fs.existsSync(SMSBOWER_KEY_FILE)) {
                                sbKey = fs.readFileSync(SMSBOWER_KEY_FILE, 'utf8').trim();
                                const ka = await selectOption(`SMS Bower key found (${sbKey.substring(0, 10)}...)`, [
                                    { name: 'Use saved key', value: 'use' }, { name: 'Enter new key', value: 'new' },
                                    { name: 'Remove saved key', value: 'remove' }, { name: '⬅️ Back', value: 'back' }
                                ]);
                                if (ka === 'back') { cancelSb = true; break; }
                                if (ka === 'remove') { fs.existsSync(SMSBOWER_KEY_FILE) && fs.unlinkSync(SMSBOWER_KEY_FILE); sbKey = ''; }
                                else if (ka === 'new') sbKey = '';
                            }
                            if (!sbKey) {
                                sbKey = await promptText('Enter SMS Bower API Key:', '');
                                if (sbKey.toLowerCase() === 'back') { cancelSb = true; break; }
                                const sv = await selectOption('Save key?', [{ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }]);
                                if (sv === 'yes' && sbKey) fs.writeFileSync(SMSBOWER_KEY_FILE, sbKey, 'utf8');
                            }
                            if (sbKey) sbStep = 2;
                        } else if (sbStep === 2) {
                            sbService = await promptText('Service code (e.g. fb, ig, wa) [default: fb]:', 'fb');
                            if (sbService.toLowerCase() === 'back') { sbStep = 1; continue; }
                            sbService = sbService || 'fb'; sbStep = 3;
                        } else if (sbStep === 3) {
                            sbCountry = await promptText('Country code (0 = any) [default: 0]:', '0');
                            if (sbCountry.toLowerCase() === 'back') { sbStep = 2; continue; }
                            sbCountry = sbCountry || '0';
                            const mp = await promptText('Max price per number [default: 0.5]:', '0.5');
                            sbMaxPrice = mp || '0.5'; sbStep = 4;
                        } else if (sbStep === 4) {
                            const ci = await promptText('How many numbers? [default: 50]:', '50');
                            if (ci.toLowerCase() === 'back') { sbStep = 3; continue; }
                            sbTotal = parseInt(ci) || 50;
                            smsBowerConfig = { apiKey: sbKey, service: sbService, country: sbCountry, maxPrice: sbMaxPrice, totalCount: sbTotal };
                            nexaConfig = null; twoOoConfig = null; zenexConfig = null; sbStep = 5;
                        }
                    }
                    if (cancelSb) { step = 1; continue; }
                    step = 3;

                } else if (numSource === 'zenex') {
                    let zKey = '', zRanges = [], zTotal = 50, zStep = 1, cancelZ = false;
                    while (zStep <= 3 && !cancelZ) {
                        process.stdout.write('\x1b[2J\x1b[H'); printHeader();
                        if (zStep === 1) {
                            if (fs.existsSync(ZENEX_KEY_FILE)) {
                                zKey = fs.readFileSync(ZENEX_KEY_FILE, 'utf8').trim();
                                const ka = await selectOption(`Zenex key found (${zKey.substring(0, 10)}...)`, [
                                    { name: 'Use saved key', value: 'use' }, { name: 'Enter new key', value: 'new' },
                                    { name: 'Remove saved key', value: 'remove' }, { name: '⬅️ Back', value: 'back' }
                                ]);
                                if (ka === 'back') { cancelZ = true; break; }
                                if (ka === 'remove') { fs.existsSync(ZENEX_KEY_FILE) && fs.unlinkSync(ZENEX_KEY_FILE); zKey = ''; }
                                else if (ka === 'new') zKey = '';
                            }
                            if (!zKey) {
                                zKey = await promptText('Enter Zenex API Key (mapikey):', '');
                                if (zKey.toLowerCase() === 'back') { cancelZ = true; break; }
                                const sv = await selectOption('Save key?', [{ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }]);
                                if (sv === 'yes' && zKey) fs.writeFileSync(ZENEX_KEY_FILE, zKey, 'utf8');
                            }
                            if (zKey) zStep = 2;
                        } else if (zStep === 2) {
                            zRanges = [];
                            let addMore = true;
                            while (addMore) {
                                const r = await promptText(`Enter range #${zRanges.length + 1} (e.g. 4473845XXX) or 'back':`, '');
                                if (r.toLowerCase() === 'back') { if (zRanges.length === 0) { cancelZ = true; break; } else { zRanges.pop(); continue; } }
                                if (r) zRanges.push(r);
                                const a = await selectOption(`Added ${zRanges.length}. Add another?`, [{ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }]);
                                if (a === 'no') addMore = false;
                            }
                            if (zRanges.length > 0) zStep = 3;
                        } else if (zStep === 3) {
                            const ci = await promptText('How many numbers? [default: 50]:', '50');
                            if (ci.toLowerCase() === 'back') { zStep = 2; continue; }
                            zTotal = parseInt(ci) || 50;
                            zenexConfig = { apiKey: zKey, ranges: zRanges, totalCount: zTotal };
                            nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zStep = 4;
                        }
                    }
                    if (cancelZ) { step = 1; continue; }
                    step = 3;

                } else {
                    // NexaOTP Sub-Wizard
                    let nexaStep = 1;
                    let cancelNexa = false;

                    while (nexaStep <= 4 && !cancelNexa) {
                        process.stdout.write('\x1b[2J\x1b[H');
                        printHeader();

                        if (nexaStep === 1) {
                            if (fs.existsSync(NEXA_KEY_FILE)) {
                                const savedKey = fs.readFileSync(NEXA_KEY_FILE, 'utf8').trim();
                                const useSaved = await selectOption(`Found saved API Key (...${savedKey.slice(-4)}). Use it?`, [
                                    { name: "Yes, use saved key", value: "yes" },
                                    { name: "No, enter new key", value: "no" },
                                    { name: "Delete saved key", value: "delete" },
                                    { name: "⬅️ Go Back to Number Source", value: "back" }
                                ]);
                                if (useSaved === 'back') { cancelNexa = true; break; }
                                if (useSaved === 'yes') {
                                    apiKey = savedKey;
                                } else if (useSaved === 'delete') {
                                    if (fs.existsSync(NEXA_KEY_FILE)) fs.unlinkSync(NEXA_KEY_FILE);
                                    apiKey = '';
                                }
                            }

                            if (!apiKey) {
                                const kInput = await promptText("Enter NexaOTP API Key (type 'back' to go back):", "");
                                if (kInput.toLowerCase() === 'back') { cancelNexa = true; break; }
                                apiKey = kInput;
                                const saveIt = await selectOption("Save this key for future use?", [
                                    { name: "Yes, save it", value: "yes" },
                                    { name: "No", value: "no" }
                                ]);
                                if (saveIt === 'yes' && apiKey) {
                                    fs.writeFileSync(NEXA_KEY_FILE, apiKey, 'utf8');
                                }
                            }
                            if (apiKey) nexaStep = 2;
                        } else if (nexaStep === 2) {
                            ranges = [];
                            let addMore = true;
                            while (addMore) {
                                const r = await promptText(`Enter range #${ranges.length + 1} (e.g. 21624485XXX) or type 'back':`, "");
                                if (r.toLowerCase() === 'back') {
                                    if (ranges.length === 0) {
                                        nexaStep = 1;
                                        break;
                                    } else {
                                        ranges.pop();
                                        continue;
                                    }
                                }
                                if (r) ranges.push(r);
                                const another = await selectOption(`Added ${ranges.length} range(s). Add another?`, [
                                    { name: "Yes, add another range", value: "yes" },
                                    { name: "No, proceed to next step", value: "no" },
                                    { name: "⬅️ Go Back to API Key", value: "back" }
                                ]);
                                if (another === 'back') {
                                    nexaStep = 1;
                                    break;
                                }
                                if (another === 'no') addMore = false;
                            }
                            if (ranges.length > 0) nexaStep = 3;
                        } else if (nexaStep === 3) {
                            const countInput = await promptText("How many numbers to process? (type 'back' to go back) [default: 50]:", "50");
                            if (countInput.toLowerCase() === 'back') {
                                nexaStep = 2;
                                continue;
                            }
                            totalCount = parseInt(countInput) || 50;
                            nexaStep = 4;
                        } else if (nexaStep === 4) {
                            const endpointChoice = await selectOption("SELECT NEXA SERVER", [
                                { name: "Server 1 (/get)", value: "/api/v1/numbers/get" },
                                { name: "Server 2 (/p2/get)", value: "/api/v1/numbers/p2/get" },
                                { name: "Server 3 (/p3/get)", value: "/api/v1/numbers/p3/get" },
                                { name: "⬅️ Go Back to Count Input", value: "back" }
                            ]);
                            if (endpointChoice === 'back') {
                                nexaStep = 3;
                                continue;
                            }
                            serverEndpoint = endpointChoice;
                            nexaConfig = { apiKey, ranges, totalCount, serverEndpoint };
                            nexaStep = 5;
                        }
                    }

                    if (cancelNexa) {
                        step = 1;
                        continue;
                    }
                    step = 3;
                }
            } else if (step === 3) {
                // Step 3: Proxies File
                const proxyChoice = await selectOption("SELECT PROXIES FILE", [
                    { name: "📄 proxies.txt (Default)", value: "proxies.txt" },
                    { name: "🚫 None (Direct Connection)", value: "none" },
                    { name: "✏️ Custom File Path", value: "custom" },
                    { name: "⬅️ Go Back to Numbers Selection", value: "back" }
                ]);

                if (proxyChoice === 'back') {
                    step = 2;
                    continue;
                }
                if (proxyChoice === 'custom') {
                    const input = await promptText("Enter Proxies File Path:", "proxies.txt");
                    if (input.toLowerCase() === 'back') continue;
                    proxiesFile = input;
                } else if (proxyChoice === 'none') {
                    proxiesFile = '';
                } else {
                    proxiesFile = proxyChoice;
                }
                step = 4;
            } else if (step === 4) {
                // Step 4: Threads
                const threadsOpt = await selectOption("SELECT THREADS", [
                    { name: "10 Threads", value: 10 },
                    { name: "20 Threads (Default)", value: 20 },
                    { name: "50 Threads (Fast)", value: 50 },
                    { name: "100 Threads (Extreme)", value: 100 },
                    { name: "⌨️  Custom...", value: -1 },
                    { name: "⬅️ Go Back to Proxies Selection", value: "back" }
                ]);

                if (threadsOpt === 'back') {
                    step = 3;
                    continue;
                }
                if (threadsOpt === -1) {
                    const customRaw = await promptText("Enter custom thread count (type 'back' to go back):", "20");
                    if (customRaw.toLowerCase() === 'back') continue;
                    threads = parseInt(customRaw) || 20;
                } else {
                    threads = threadsOpt;
                }
                step = 5;
            } else if (step === 5) {
                // Step 5: Region
                const regionChoice = await selectOption("SELECT REGION", [
                    { name: "🎲 Random", value: "random" },
                    { name: "🇺🇸 English (en-US)", value: "en-US" },
                    { name: "🇪🇸 Spanish (es-ES)", value: "es-ES" },
                    { name: "⬅️ Go Back to Threads Selection", value: "back" }
                ]);

                if (regionChoice === 'back') {
                    step = 4;
                    continue;
                }
                region = regionChoice;
                step = 6;
            } else if (step === 6) {
                // Step 6: Browser Profile
                const browserChoice = await selectOption("SELECT BROWSER PROFILE", [
                    { name: "🎲 Random (Desktop + Mobile)", value: "random" },
                    { name: "📱 Mobile Chrome (Android Only)", value: "mobile" },
                    { name: "💻 Desktop Chrome (Windows Only)", value: "desktop" },
                    { name: "⬅️ Go Back to Region Selection", value: "back" }
                ]);

                if (browserChoice === 'back') {
                    step = 5;
                    continue;
                }
                browser = browserChoice;
                step = 7;
            } else if (step === 7) {
                // Step 7: OTP Resends & Method
                const resendsRaw = await promptText("Enter number of OTP resends per number (type 'back' to go back) [default: 0]:", "0");
                if (resendsRaw.toLowerCase() === 'back') {
                    step = 6;
                    continue;
                }
                resends = parseInt(resendsRaw) || 0;

                const methodChoice = await selectOption("SELECT OTP RESEND METHOD", [
                    { name: "⚡ OTP Resend Old", value: "old" },
                    { name: "🆕 OTP Resend New", value: "new" },
                    { name: "⬅️ Go Back to Resend Count", value: "back" }
                ]);

                if (methodChoice === 'back') continue;
                resendMethod = methodChoice;
                step = 8; // Done
            } else if (step === 8) {
                break;
            }
        }

        process.stdin.pause();
        return { numbersFile, threads: String(threads), proxiesFile, region, browser, resends: String(resends), resendMethod, nexaConfig, twoOoConfig, smsBowerConfig, zenexConfig };
    }

    // ── HWID: Multi-source hardware fingerprint ───────────────────
    function generateHWID() {
        const os = require('os');
        const osType = os.platform();

        try {
            if (osType === 'win32') {
                const raw = execSync(
                    `powershell -NoProfile -Command "` +
                    `$mg = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -ErrorAction SilentlyContinue).MachineGuid; ` +
                    `$cpu = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).ProcessorId; ` +
                    `$disk = (Get-CimInstance Win32_LogicalDisk -Filter 'DeviceID=\\'C:\\'' -ErrorAction SilentlyContinue).VolumeSerialNumber; ` +
                    `$mb = (Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue).SerialNumber; ` +
                    `Write-Output (($mg,$cpu,$disk,$mb) -join '|')"`,
                    { stdio: 'pipe', timeout: 15000 }
                ).toString().trim();

                if (!raw) throw new Error('No hardware data');
                const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
                return 'SKING-' + hash.substring(0, 8) + '-' + hash.substring(8, 12) + '-' + hash.substring(12, 16);

            } else {
                let sources = [];

                try {
                    const androidId = execSync('settings get secure android_id 2>/dev/null || echo ""', { stdio: 'pipe', timeout: 5000 }).toString().trim();
                    if (androidId && androidId !== 'null') sources.push('A:' + androidId);
                } catch (_) { }

                try {
                    if (fs.existsSync('/proc/cpuinfo')) {
                        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                        const serialMatch = cpuinfo.match(/Serial\s*:\s*(\S+)/i);
                        const hardwareMatch = cpuinfo.match(/Hardware\s*:\s*(.+)/i);
                        if (serialMatch && serialMatch[1] !== '0000000000000000') sources.push('S:' + serialMatch[1].trim());
                        if (hardwareMatch) sources.push('H:' + hardwareMatch[1].trim());
                    }
                } catch (_) { }

                try {
                    if (fs.existsSync('/etc/machine-id')) {
                        const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
                        if (machineId) sources.push('M:' + machineId);
                    }
                } catch (_) { }

                try {
                    const cpus = os.cpus();
                    const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : 'UnknownCPU';
                    const totalMem = os.totalmem();
                    const release = os.release();
                    const hostname = os.hostname();
                    sources.push(`F:${cpuModel}|${totalMem}|${release}|${hostname}`);
                } catch (_) { }

                const combined = sources.join('||');
                const hash = crypto.createHash('sha256').update(combined).digest('hex').toUpperCase();

                return 'ANKING-' + hash.substring(0, 8) + '-' + hash.substring(8, 12) + '-' + hash.substring(12, 16);
            }
        } catch (e) {
            return '';
        }
    }

    // ── Asymmetric Ed25519 Signature Verification ─────────────────
    function verifyServerSignature(payload, signatureBase64) {
        if (!signatureBase64) return false;

        const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIU7Pc75ao+Fn7XGC7kFGeDh7JAs3o4NSL2LgmN0YmfY=
-----END PUBLIC KEY-----`;

        try {
            return crypto.verify(
                null,
                Buffer.from(payload, 'utf8'),
                publicKeyPem,
                Buffer.from(signatureBase64, 'base64')
            );
        } catch (e) {
            return false;
        }
    }

    async function start() {

        const hwid = generateHWID();

        if (!hwid) {
            console.error(R(`\n  ✗ Could not generate Hardware ID.`));
            console.error(R(`  ✗ Please run on Windows or provide HWID as argument.\n`));
            process.exit(1);
        }

        // Anti-tamper
        const hwidVerify = generateHWID();
        if (hwidVerify !== hwid) {
            console.error(R(`\n  ✗ HWID integrity check failed. Tampering detected.\n`));
            process.exit(1);
        }

        printHeader();
        console.log(W('┌──────────────────────────────────────────────┐'));
        console.log(W('│ [•] Tool      : ') + C('Meta Account Creator         ') + W('│'));
        console.log(W('│ [•] Your HWID : ') + Y(hwid.padEnd(29)) + W('│'));
        console.log(W('│ [•] Status    : ') + Y('Verifying License...         ') + W('│'));
        console.log(W('└──────────────────────────────────────────────┘'));
        console.log('');

        // ── LICENSE CHECK with Asymmetric Signature Verification ────────
        let licenseValid = false;
        let licenseUser = 'Licensed';
        const reqTimestamp = Date.now();

        try {
            const SERVER_HOST = '188.137.176.163';

            const http = require('http'); // Raw IP Connection
            const licenseData = await new Promise((resolve, reject) => {
                const postData = JSON.stringify({
                    hwid: hwid,
                    app_id: 'meta',
                    version: '2.0.2',
                    timestamp: reqTimestamp
                });

                const options = {
                    hostname: SERVER_HOST,
                    port: 3777,
                    path: '/api/verify',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: 10000
                };

                const req = http.request(options, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                    });
                });

                req.on('error', reject);
                req.on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
                req.write(postData);
                req.end();
            });

            // ── Verify Server Response ──
            if (licenseData) {
                if (licenseData.status === "update_required") {
                    console.error(R(`\n  ✗ Update required! Please download the latest version.\n`));
                    process.exit(1);
                }

                if (licenseData.status === "banned" || licenseData.status === "expired" || !licenseData.sig) {
                    await new Promise(r => setTimeout(r, 2000));

                    let reason = String(licenseData.reason || 'NOT REGISTERED');
                    if (!licenseData.reason && !licenseData.sig) reason = 'NOT REGISTERED / REMOVED';

                    console.error(R(`\n  ╔══════════════════════════════════════════════╗`));
                    console.error(R(`  ║    ✗ UNAUTHORIZED HARDWARE — META TOOL     ║`));
                    console.error(R(`  ╠══════════════════════════════════════════════╣`));
                    console.error(R(`  ║  HWID   : `) + Y(hwid.padEnd(33)) + R(`║`));
                    console.error(R(`  ║  Status : ${reason.padEnd(26)}║`));
                    console.error(R(`  ║  Contact: t.me/scraper_king to register     ║`));
                    console.error(R(`  ╚══════════════════════════════════════════════╝\n`));
                    process.exit(1);
                }

                // Verify the cryptographic signature (Ed25519)
                const payloadToVerify = `${hwid}|meta|2.0.2|${reqTimestamp}`;

                if (!verifyServerSignature(payloadToVerify, licenseData.sig)) {
                    console.error(R(`\n  ✗ Internal Server Error (500). Please try again later.\n`));
                    process.exit(1);
                }

                licenseValid = true;

                // ── Active Session Token (Heartbeat) ──
                let sessionToken = licenseData.token;
                if (!sessionToken) {
                    console.error(R(`\n  ✗ Invalid Server Response: Missing Active Session Token. Aborting.\n`));
                    process.exit(1);
                }

                setInterval(() => {
                    if (!sessionToken) {
                        console.error(R(`\n  ✗ Session Token lost. Aborting...\n`));
                        process.exit(1);
                    }

                    const pingData = JSON.stringify({
                        hwid: hwid,
                        app_id: 'meta',
                        token: sessionToken
                    });

                    const pingOpts = {
                        hostname: SERVER_HOST,
                        port: 3777,
                        path: '/api/ping',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(pingData)
                        },
                        timeout: 5000
                    };

                    const pingReq = http.request(pingOpts, (res) => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            try {
                                const response = JSON.parse(body);
                                if (response.status === 'ok' && response.token) {
                                    sessionToken = response.token; // Refresh token
                                } else {
                                    console.error(R(`\n  ✗ Session invalidated by server (kill). Exiting...\n`));
                                    process.exit(1);
                                }
                            } catch (e) {
                                console.error(R(`\n  ✗ Network error during session ping. Exiting...\n`));
                                process.exit(1);
                            }
                        });
                    });

                    pingReq.on('error', () => {
                        console.error(R(`\n  ✗ Disconnected from License Server. Exiting...\n`));
                        process.exit(1);
                    });
                    pingReq.on('timeout', function () {
                        this.destroy();
                        console.error(R(`\n  ✗ License Server timeout. Exiting...\n`));
                        process.exit(1);
                    });

                    pingReq.write(pingData);
                    pingReq.end();

                }, 45000); // Ping every 45 seconds

            }
        } catch (e) {
            console.error(R(`\n  ✗ License server is currently undergoing maintenance or is unreachable.`));
            console.error(R(`    Please check your internet connection or try again later.\n`));
            process.exit(1);
        }

        // ── Explicit license gate ─────────────────────────────────
        if (!licenseValid) {
            console.error(R(`\n  ✗ License verification failed. Exiting.\n`));
            process.exit(1);
        }

        // ═══════════════════════════════════════════════════════════
        // LICENSE OK — Now proceed with setup
        // ═══════════════════════════════════════════════════════════
        const cliArgs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
        let args = cliArgs;
        let nexaConfig = null;
        let twoOoConfig = null;
        let smsBowerConfig = null;
        let zenexConfig = null;
        let resendMethodOpt = 'old';
        if (args.length === 0) {
            const wiz = await interactiveWizard();
            args = [wiz.numbersFile, wiz.threads, wiz.proxiesFile, wiz.region, wiz.browser, 'SKING-UI-HARDWARE-ID', wiz.resends];
            nexaConfig = wiz.nexaConfig;
            twoOoConfig = wiz.twoOoConfig || null;
            smsBowerConfig = wiz.smsBowerConfig || null;
            zenexConfig = wiz.zenexConfig || null;
            resendMethodOpt = wiz.resendMethod || 'old';
        }

        // Strip quotes from all args just in case they were passed via CLI/Batch file
        args = args.map(arg => {
            if (typeof arg === 'string') {
                if (arg.startsWith('"') && arg.endsWith('"')) return arg.slice(1, -1);
                if (arg.startsWith("'") && arg.endsWith("'")) return arg.slice(1, -1);
            }
            return arg;
        });

        let numbersFile = path.resolve(args[0] || 'numbers.txt');
        let workersCount = parseInt(args[1]) || 20;

        let proxiesFile = args[2] !== undefined ? args[2] : 'proxies.txt';
        if (proxiesFile.toLowerCase() === 'none' || proxiesFile === 'false') proxiesFile = '';

        let regionOpt = args[3] || 'random';
        let browserOpt = args[4] || 'random';
        let resendCount = parseInt(args[6]) || 0;

        if (proxiesFile && !proxiesFile.includes(':') && !path.isAbsolute(proxiesFile)) {
            proxiesFile = path.resolve(proxiesFile);
        }

        printHeader();
        console.log(B(`  ✓ License: ${licenseUser}`) + G(` | HWID: ${hwid}`));

        let runningTool = true;

        while (runningTool) {
            let numbers = [];
            if (!nexaConfig && !twoOoConfig && !smsBowerConfig && !zenexConfig) {
                if (!fs.existsSync(numbersFile)) {
                    console.error(R(`✗ Error: Numbers file not found: ${numbersFile}`));
                    process.exit(1);
                }

                numbers = fs.readFileSync(numbersFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && l.replace(/\D/g, '').length >= 7);
                if (numbers.length === 0) {
                    console.error(R(`✗ No valid phone numbers found in file`));
                    process.exit(1);
                }
            }

            let rawProxies = [];
            if (proxiesFile && fs.existsSync(proxiesFile)) {
                rawProxies = fs.readFileSync(proxiesFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
            }

            let proxies = [];
            for (const line of rawProxies) {
                const parsed = parseProxy(line);
                if (!parsed) {
                    console.error(R(`\n  ✗ Invalid proxy format detected: "${line}"`));
                    console.error(R(`  Please use one of the supported formats:`));
                    console.error(R(`    - host:port`));
                    console.error(R(`    - user:pass@host:port`));
                    console.error(R(`    - host:port:user:pass`));
                    console.error(R(`    - user:pass:host:port\n`));
                    process.exit(1);
                }
                proxies.push(parsed);
            }

            const activeConfig = nexaConfig || twoOoConfig || smsBowerConfig || zenexConfig;
            if (activeConfig) {
                const pt = nexaConfig ? 'NexaOTP' : (twoOoConfig ? (twoOoConfig.provider === 'voltx' ? 'Voltx ⚡' : 'Stex 🔥') : (smsBowerConfig ? '📱 SMS Bower' : '⚡ Zenex'));
                console.log(C(`✓ Target  : ${pt} API (${activeConfig.totalCount} numbers)`));
            } else {
                console.log(Y(`✓ Loaded ${numbers.length} targets`));
            }
            if (proxies.length === 0) console.log(G(`  No proxies configured (running direct)`));
            else console.log(G(`  Proxies loaded: ${proxies.length}`));
            console.log(C(`✓ Threads: ${workersCount}\n`));

            fs.writeFileSync(SUCCESSFUL_FILE, '');
            fs.writeFileSync(FAILED_FILE, '');
            fs.writeFileSync(DEBUG_FILE, `=== DEBUG SESSION ===\n`);

            const dashboard = new Dashboard(activeConfig ? activeConfig.totalCount : numbers.length);

            let nexaBuffer = [];
            let nexaWaiters = [];
            let nexaFetched = 0;
            let nexaDone = false;

            if (nexaConfig || twoOoConfig) {
                const providerTag = nexaConfig ? 'NexaOTP' : (twoOoConfig.provider === 'voltx' ? 'Voltx ⚡' : 'Stex 🔥');
                (async () => {
                    let consecutiveFails = 0;
                    let lastError = '';
                    try {
                        for (let i = 0; i < activeConfig.totalCount; i++) {
                            try {
                                const range = activeConfig.ranges[Math.floor(Math.random() * activeConfig.ranges.length)];
                                let num;
                                if (nexaConfig) {
                                    num = await nexaLimiter.enqueue(() => nexaFetchNumber(nexaConfig.apiKey, range, nexaConfig.serverEndpoint));
                                } else {
                                    num = await twoOoLimiter.enqueue(() => twoOoFetchNumber(twoOoConfig.apiKey, range, twoOoConfig.getPath));
                                }
                                if (num) {
                                    nexaFetched++;
                                    consecutiveFails = 0;
                                    if (nexaWaiters.length > 0) {
                                        nexaWaiters.shift()(num);
                                    } else {
                                        nexaBuffer.push(num);
                                    }
                                }
                            } catch (e) {
                                lastError = e.message;
                                consecutiveFails++;
                                if (e.message.includes('Insufficient balance')) {
                                    console.error(R(`\n  [${providerTag}] \u2717 Insufficient balance \u2014 aborting.\n`));
                                    break;
                                }
                                if (e.message.includes('No numbers available')) { continue; }
                                // Abort early if we got 5 consecutive fails with 0 success
                                if (consecutiveFails >= 5 && nexaFetched === 0) {
                                    console.error(R(`\n  [${providerTag}] \u2717 Aborting — 5 consecutive fetch failures.`));
                                    console.error(R(`  Last error: ${lastError}`));
                                    console.error(R(`  Check your API key, range format (e.g. 26134XXX), and internet connection.\n`));
                                    break;
                                }
                            }
                        }
                    } finally {
                        if (nexaFetched === 0) {
                            console.error(R(`\n  [${providerTag}] \u2717 No numbers were fetched. Last error: ${lastError || 'Unknown'}\n`));
                        } else {
                            console.log(G(`\n  [${providerTag}] \u2713 Feeder done — ${nexaFetched} numbers fetched.\n`));
                        }
                        nexaDone = true;
                        while (nexaWaiters.length > 0) nexaWaiters.shift()(null);
                    }
                })();
            } else if (smsBowerConfig) {
                const sbCfg = smsBowerConfig;
                (async () => {
                    let consecutiveFails = 0;
                    try {
                        for (let i = 0; i < sbCfg.totalCount; i++) {
                            try {
                                const { activationId, phoneNumber } = await smsBowerFetchNumber(sbCfg.apiKey, sbCfg.service, sbCfg.country, sbCfg.maxPrice);
                                nexaFetched++; consecutiveFails = 0;
                                if (nexaWaiters.length > 0) nexaWaiters.shift()(phoneNumber); else nexaBuffer.push(phoneNumber);
                            } catch (e) {
                                consecutiveFails++;
                                if (consecutiveFails >= 5 && nexaFetched === 0) break;
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    } finally { nexaDone = true; while (nexaWaiters.length > 0) nexaWaiters.shift()(null); }
                })();
            } else if (zenexConfig) {
                const zCfg = zenexConfig;
                (async () => {
                    let consecutiveFails = 0;
                    try {
                        for (let i = 0; i < zCfg.totalCount; i++) {
                            try {
                                const range = zCfg.ranges[Math.floor(Math.random() * zCfg.ranges.length)];
                                const num = await zenexFetchNumber(zCfg.apiKey, range);
                                nexaFetched++; consecutiveFails = 0;
                                if (nexaWaiters.length > 0) nexaWaiters.shift()(num); else nexaBuffer.push(num);
                            } catch (e) {
                                consecutiveFails++;
                                if (consecutiveFails >= 5 && nexaFetched === 0) break;
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    } finally { nexaDone = true; while (nexaWaiters.length > 0) nexaWaiters.shift()(null); }
                })();
            }

            const isAutoFeeder = !!(nexaConfig || twoOoConfig || smsBowerConfig || zenexConfig);

            const pickNextNumber = isAutoFeeder
                ? () => {
                    if (nexaBuffer.length > 0) return Promise.resolve(nexaBuffer.shift());
                    if (nexaDone) return Promise.resolve(null);
                    return new Promise(resolve => nexaWaiters.push(resolve));
                }
                : (() => {
                    // Debounced write — coalesces concurrent worker writes into one FS op
                    let _writeTimer = null;
                    const persistNumbers = () => {
                        if (_writeTimer) clearTimeout(_writeTimer);
                        _writeTimer = setTimeout(() => {
                            try {
                                fs.writeFileSync(numbersFile, numbers.join('\n'), 'utf8');
                            } catch (e) { /* non-fatal */ }
                        }, 50);
                    };
                    return () => {
                        if (numbers.length === 0) return Promise.resolve(null);
                        const idx = Math.floor(Math.random() * numbers.length);
                        const picked = numbers.splice(idx, 1)[0];
                        persistNumbers(); // write remaining numbers back to disk
                        return Promise.resolve(picked);
                    };
                })();


            let proxyIndex = 0;
            const getNextProxy = () => {
                if (proxies.length === 0) return null;
                const p = proxies[proxyIndex % proxies.length];
                proxyIndex++;
                return rotateSessionId(p);
            };

            // ── In-memory completed Set — O(1) per number, no sync file rewrites ──
            const completedNumbers = new Set();

            // ── Async write streams for non-blocking file output ──
            const successStream = fs.createWriteStream(SUCCESSFUL_FILE, { flags: 'a' });
            const failStream = fs.createWriteStream(FAILED_FILE, { flags: 'a' });

            const initialWorkers = isAutoFeeder
                ? Math.min(workersCount, activeConfig.totalCount)
                : Math.min(workersCount, numbers.length);
            const workerPromises = [];
            const dashboardInterval = setInterval(() => dashboard.render(), 500);

            async function processWorker(workerId) {
                while (true) {
                    const phone = await pickNextNumber();
                    if (!phone) break;

                    const currentProxy = getNextProxy();
                    const barePhone = normalizePhoneNumber(phone).replace('+', '');
                    const phoneGeo = getCountryFromPhone(barePhone);
                    const countryIso = phoneGeo.iso;
                    const langHeader = phoneGeo.lang.split(',')[0];
                    let countryName = countryIso;
                    try { countryName = _displayNames.of(countryIso) || countryIso; } catch (e) { }
                    const proxyCountry = currentProxy ? await getProxyCountry(currentProxy) : 'Direct';
                    const metaInfo = `[${langHeader}] Proxy: ${proxyCountry} | ${countryName}`;


                    try {
                        const result = await createAccount(phone, {
                            onStatus: (msg) => dashboard.setStatus(`Worker ${workerId}: ${msg}`),
                            onLog: (msg, type) => dashboard.addLog(msg, type, metaInfo),
                            proxy: currentProxy,
                            workerId: workerId,
                            browserPref: browserOpt,
                            regionPref: regionOpt,
                            resends: resendCount,
                            resendMethod: resendMethodOpt
                        });

                        if (result.success) {
                            dashboard.successful++;
                            dashboard.processed++;
                            completedNumbers.add(phone.trim());
                            const dobStr = result.dob ? `${result.dob.month}/${result.dob.day}/${result.dob.year}` : 'N/A';
                            const proxyStr = currentProxy ? `${currentProxy.host}:${currentProxy.port}` : 'direct';
                            const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
                            successStream.write(
                                `${result.phone}` +
                                `|pass:${result.password || 'N/A'}` +
                                `|dob:${dobStr}` +
                                `|type:${result.type || 'registration'}` +
                                `|browser:${result.browser || 'unknown'}` +
                                `|lang:${result.lang || 'N/A'}` +
                                `|proxy:${result.proxy || proxyStr}` +
                                `|country:${countryName}` +
                                `|ts:${ts}\n`
                            );
                            dashboard.addLog(`Triggered OTP for ${result.phone}`, 'success', metaInfo);
                        } else {
                            dashboard.failed++;
                            dashboard.processed++;
                            failStream.write(`${result.phone}|${result.message}\n`);
                            if (!result.message.includes('429')) {
                                dashboard.addLog(`Failed on ${result.phone}: ${result.message}`, 'error', metaInfo);
                            }
                        }
                    } catch (err) {
                        dashboard.failed++;
                        dashboard.processed++;
                        failStream.write(`${phone}|${err.message}\n`);
                        if (!err.message.includes('429')) {
                            dashboard.addLog(`Fatal error on ${phone}: ${err.message}`, 'error', metaInfo);
                        }
                    }

                    const delayMs = Math.floor(Math.random() * 3000) + 1500;
                    await sleep(delayMs);
                }
            }

            for (let i = 0; i < initialWorkers; i++) {
                workerPromises.push(processWorker(i));
            }

            await Promise.all(workerPromises);
            clearInterval(dashboardInterval);

            // Close write streams gracefully
            await new Promise(r => successStream.end(r));
            await new Promise(r => failStream.end(r));
            dashboard.render();
            dashboard.stop();

            // Post-run menu
            const choice = await selectOption('Processing Complete. What next?', [
                { name: `Reuse successful numbers (${SUCCESSFUL_FILE})`, value: 'reuse' },
                { name: 'Go Home (Restart)', value: 'home' },
                { name: 'Exit', value: 'exit' }
            ]);

            if (choice === 'reuse') {
                if (fs.existsSync(SUCCESSFUL_FILE)) {
                    let successData = fs.readFileSync(SUCCESSFUL_FILE, 'utf8').split('\n').map(l => l.split('|')[0].trim()).filter(l => l.length > 5);
                    fs.writeFileSync(numbersFile, successData.join('\n'));
                    fs.writeFileSync(SUCCESSFUL_FILE, '');
                    console.log(`\n  \x1b[32m✓ Copied ${successData.length} successful numbers to ${numbersFile} and cleared ${SUCCESSFUL_FILE}.\x1b[0m\n`);
                } else {
                    console.log(`\n  \x1b[31m✗ No successful numbers found.\x1b[0m\n`);
                    runningTool = false;
                }
            } else if (choice === 'home') {
                const wiz = await interactiveWizard();
                args = [wiz.numbersFile, wiz.threads, wiz.proxiesFile, wiz.region, wiz.browser, 'SKING-UI-HARDWARE-ID', wiz.resends];
                nexaConfig = wiz.nexaConfig;
                numbersFile = path.resolve(args[0] || 'numbers.txt');
                workersCount = parseInt(args[1]) || 20;
                proxiesFile = args[2] !== undefined ? args[2] : 'proxies.txt';
                if (proxiesFile.toLowerCase() === 'none' || proxiesFile === 'false') proxiesFile = '';
            } else {
                runningTool = false;
            }
        }
    }

    start().catch(error => {
        console.error(R(`Fatal error: ${error.message}`));
        process.exit(1);
    });
}
