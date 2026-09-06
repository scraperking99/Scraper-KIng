// ── IG Account Creator — Single File Edition ────────────────
// Contains Orchestrator, Worker, and API Logic in one file
// Features: Auto-dependency installation, Interactive CLI, Native HWID
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
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const chalk = require('chalk');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

function debugLog(tag, action, data) {
    try {
        const timestamp = new Date().toISOString();
        let content = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        const logEntry = `[${timestamp}] [${tag}] [${action}]\n${content}\n────────────────────────────────────────────────────────────────────────────────\n`;
        fs.appendFileSync(path.join(__dirname, 'debug.txt'), logEntry);
    } catch (_) { }
}

// ── NexaOTP Panel Integration ─────────────────────────────────
const NEXA_KEY_FILE = path.join(__dirname, 'nexa_key.txt');
const NEXA_BASE = 'http://nexaotpservice.com/api/v1';
// ── Voltx / Stex (2oo9.cloud) Key Files ────────────────────────
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
        const opts = {
            hostname: SMSBOWER_HOST, port: 443,
            path: `/stubs/handler_api.php?${qs}`, method: 'GET',
            headers: { 'Accept': 'text/plain', 'Connection': 'close' }
        };
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
        const opts = {
            hostname: ZENEX_HOST, port: 443, path: '/v1/getnum', method: 'POST',
            headers: { 'mapikey': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };
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
            const opts = {
                hostname: ZENEX_HOST, port: 443, path: '/v1/numsuccess/info', method: 'GET',
                headers: { 'mapikey': apiKey }
            };
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
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(tryFetch, 4000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(tryFetch, 4000); else resolve(null); });
            req.end();
        };
        tryFetch();
    });
}

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

const nexaLimiter = new NexaRateLimiter(500); // 120 req/min = 2/sec = 500ms

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

// ── Voltx / Stex (2oo9.cloud) Fetch Functions ─────────────────
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

    const appChoice = await selectOptionFn('Filter by app (from message body):', [
        { name: '📘 Facebook', value: 'facebook' },
        { name: '📸 Instagram', value: 'instagram' },
        { name: '🌐 Meta', value: 'meta' },
        { name: '📦 All (FB + IG + Meta)', value: 'all' }
    ]);

    const keywords = APP_FILTERS[appChoice];
    const filtered = recent.filter(hit => {
        const sid = (hit.sid || '').toLowerCase();
        const msg = (hit.message || '').toLowerCase();
        return keywords.some(kw => sid.includes(kw) || msg.includes(kw));
    });
    if (filtered.length === 0) { console.log(chalk.red('\n  ✗ No hits for selected app.\n')); return null; }

    const freqMap = {}; const appMap = {};
    for (const hit of filtered) {
        const r = hit.range || ''; if (!r) continue;
        freqMap[r] = (freqMap[r] || 0) + 1;
        appMap[r] = appMap[r] || { facebook: 0, instagram: 0, meta: 0 };
        if (APP_FILTERS.facebook.some(kw => (hit.sid || '').toLowerCase().includes(kw) || (hit.message || '').toLowerCase().includes(kw))) appMap[r].facebook++;
        if (APP_FILTERS.instagram.some(kw => (hit.sid || '').toLowerCase().includes(kw) || (hit.message || '').toLowerCase().includes(kw))) appMap[r].instagram++;
        if (APP_FILTERS.meta.some(kw => (hit.sid || '').toLowerCase().includes(kw) || (hit.message || '').toLowerCase().includes(kw))) appMap[r].meta++;
    }
    const top5 = Object.entries(freqMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top5.length === 0) { console.log(chalk.red('\n  ✗ No valid ranges found.\n')); return null; }

    const mode = await selectOptionFn('Auto Range Finder — Choose mode:', [
        { name: '⚡ Auto detect & send (use #1 range instantly)', value: 'auto' },
        { name: '📊 Show top 5 & select (pick from ranked list)', value: 'select' }
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
        console.log(chalk.cyan(`\n  App filter: ${APP_LABELS[appChoice]}  |  Scanned: ${filtered.length} hits\n`));
        console.log(chalk.yellow('  #   Range              Hits  Apps'));
        console.log(chalk.gray('  ──────────────────────────────────────────────'));
        top5.forEach(([range, count], idx) => {
            const apps = appMap[range] || {};
            const tags = [];
            if (apps.facebook) tags.push(`📘FB(${apps.facebook})`);
            if (apps.instagram) tags.push(`📸IG(${apps.instagram})`);
            if (apps.meta) tags.push(`🌐Meta(${apps.meta})`);
            console.log(
                chalk.cyan(`  ${String(idx + 1).padEnd(3)} `) +
                chalk.green(range.padEnd(16)) +
                chalk.yellow(String(count).padEnd(5)) +
                chalk.gray('█'.repeat(Math.min(count, 12)) + '  ') +
                (tags.join(' ') || chalk.gray('?'))
            );
        });
        console.log(chalk.gray('\n  ──────────────────────────────────────────────'));
        console.log(chalk.gray('  Enter selection (e.g.  1,3  |  1 2 5  |  1-3  |  1-3 5)\n'));
        const raw = await promptTextFn('Select ranges:', '');
        const chosen = parseTwoOoRangeSelection(raw, top5.length);
        if (chosen.length === 0) { console.log(chalk.red('\n  ✗ No valid selection.\n')); return null; }
        const sel = chosen.map(i => top5[i][0]);
        console.log(chalk.green(`\n  ✓ Selected: ${sel.join(', ')}\n`));
        return sel;
    }
}

// ── Outlook OAuth2 & Tempmail Services Engine ────────────────────────────────
const OUTLOOK_FILE = 'outlook.txt';
const MAILSINK_KEY_FILE = path.join(__dirname, 'mailsink_key.txt');
const MAILCX_KEY_FILE = path.join(__dirname, 'mailcx_key.txt');

// Extract 6-digit or 5-8 digit confirmation OTP code from text/HTML/subject
function extractOtpCode(str) {
    if (!str) return null;
    const text = String(str);
    // 1. IG-123456 or FB-123456
    const igMatch = text.match(/(?:IG|FB)-(\d{6})/i);
    if (igMatch) return igMatch[1];
    // 2. Link with c=123456 or code=123456
    const linkMatch = text.match(/(?:[?&]c=|[?&]code=)(\d{6})/i);
    if (linkMatch) return linkMatch[1];
    // 3. Instagram specific: "123456 is your Instagram code" or "123456 ... Instagram"
    const igSubjectMatch = text.match(/\b(\d{6})\b\s*(?:is\s+your\s+Instagram\s+code|là\s+mã\s+Instagram|es\s+tu\s+código\s+de\s+Instagram|è\s+il\s+tuo\s+codice\s+Instagram|ist\s+dein\s+Instagram)/i);
    if (igSubjectMatch) return igSubjectMatch[1];
    const igNearMatch = text.match(/(?:Instagram\D{1,35}\b(\d{6})\b|\b(\d{6})\b\D{1,35}Instagram)/i);
    if (igNearMatch) return igNearMatch[1] || igNearMatch[2];
    // 4. Keyword followed by 6 digits
    const kwMatch = text.match(/(?:code|código|kod|pin|is|to|kodas|hasło|verification|confirmation)\D{1,15}(\d{6})/i);
    if (kwMatch) return kwMatch[1];
    // 5. Any standalone 6-digit number
    const digitsMatch = text.match(/\b(\d{6})\b/);
    if (digitsMatch) return digitsMatch[1];
    // 6. Fallback 4-8 digits
    const anyDigit = text.match(/\b(\d{4,8})\b/);
    if (anyDigit) return anyDigit[1];
    return null;
}

// 1. Outlook OAuth2 Poller
function parseOutlookFile(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 5);
    const accounts = [];
    for (const line of lines) {
        const delim = line.includes('|') ? '|' : (line.includes('---') ? '---' : ':');
        const parts = line.split(delim).map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length >= 2) {
            const email = parts.find(p => p.includes('@'));
            if (!email) continue;
            const pass = parts.find(p => p !== email && p.length < 40 && !p.includes('@')) || 'Password123!';
            const refreshToken = parts.find(p => p !== email && p !== pass && p.length > 20) || (parts.length > 2 ? parts[2] : '');
            const clientId = parts.find(p => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) || '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
            if (email) {
                accounts.push({ email, pass, refreshToken, clientId, rawLine: line });
            }
        }
    }
    return accounts;
}

function fetchOutlookOtp(optionsOrEmail, passArg, refreshTokenArg, proxyArg) {
    let email, pass, refreshToken, clientId = '9e5f94bc-e8a4-4e73-b8be-63364c29d753', timeoutMs = 90000, excludeCodes = [];
    if (typeof optionsOrEmail === 'object' && optionsOrEmail !== null) {
        email = optionsOrEmail.email;
        pass = optionsOrEmail.pass;
        refreshToken = optionsOrEmail.refreshToken || optionsOrEmail.refresh_token;
        clientId = optionsOrEmail.clientId || clientId;
        timeoutMs = optionsOrEmail.timeoutMs || timeoutMs;
        excludeCodes = optionsOrEmail.excludeCodes || excludeCodes;
    } else {
        email = optionsOrEmail;
        pass = passArg;
        refreshToken = refreshTokenArg;
    }

    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const payload = JSON.stringify({ email, pass, refresh_token: refreshToken, client_id: clientId, mail: email, password: pass });
        const isExcluded = (code) => code && excludeCodes && excludeCodes.some(ex => String(ex).trim() === String(code).trim());

        const tryFetch = () => {
            const opts = {
                hostname: 'tools.dongvanfb.net', port: 443, path: '/api/get_messages_oauth2', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Origin': 'https://dongvanfb.net', 'Referer': 'https://dongvanfb.net/' }
            };
            const req = https.request(opts, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    debugLog(email, 'outlook-poll-raw', d);
                    try {
                        const p = JSON.parse(d);
                        debugLog(email, 'outlook-poll', { status: p.status, message: p.message || p.error, count: (p.messages || p.data)?.length });

                        // 1. Direct code field in root or data
                        const directRootCode = p.code || p.data?.code;
                        if (directRootCode && /^\d{5,8}$/.test(String(directRootCode).trim()) && !isExcluded(directRootCode)) {
                            debugLog(email, 'outlook-otp-found', directRootCode);
                            return resolve(String(directRootCode).trim());
                        }

                        // 2. Array of messages (in p.messages, p.data, or p itself)
                        const msgs = Array.isArray(p.messages) ? p.messages : (Array.isArray(p.data) ? p.data : (Array.isArray(p) ? p : []));
                        for (const m of msgs) {
                            if (typeof m === 'object' && m !== null) {
                                const directCode = m.code || m.otp;
                                if (directCode && /^\d{5,8}$/.test(String(directCode).trim()) && !isExcluded(directCode)) {
                                    debugLog(email, 'outlook-otp-found', directCode);
                                    return resolve(String(directCode).trim());
                                }
                                const code = extractOtpCode(m.content) || extractOtpCode(m.subject) || extractOtpCode(m.body) || extractOtpCode(m.message) || extractOtpCode(m.text) || extractOtpCode(JSON.stringify(m));
                                if (code && !isExcluded(code)) {
                                    debugLog(email, 'outlook-otp-found', code);
                                    return resolve(code);
                                }
                            } else if (typeof m === 'string') {
                                const code = extractOtpCode(m);
                                if (code && !isExcluded(code)) {
                                    debugLog(email, 'outlook-otp-found', code);
                                    return resolve(code);
                                }
                            }
                        }

                        // 3. Whole raw response scan for Instagram code
                        const rawCode = extractOtpCode(d);
                        if (rawCode && !isExcluded(rawCode)) {
                            debugLog(email, 'outlook-otp-found-raw', rawCode);
                            return resolve(rawCode);
                        }
                    } catch (e) {
                        debugLog(email, 'outlook-poll-parse-err', d);
                        const rawCode = extractOtpCode(d);
                        if (rawCode && !isExcluded(rawCode)) {
                            debugLog(email, 'outlook-otp-found-raw', rawCode);
                            return resolve(rawCode);
                        }
                    }
                    if (Date.now() < deadline) setTimeout(tryFetch, 2500); else resolve(null);
                });
            });
            req.on('error', (err) => {
                debugLog(email, 'outlook-net-err', err.message);
                if (Date.now() < deadline) setTimeout(tryFetch, 2500); else resolve(null);
            });
            req.setTimeout(10000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(tryFetch, 2500); else resolve(null); });
            req.write(payload); req.end();
        };
        tryFetch();
    });
}

// 2. Mailsink (api.mailsink.dev)
function mailsinkCreateInbox(apiKey) {
    return new Promise((resolve, reject) => {
        if (!apiKey || apiKey.trim().length === 0) return reject(new Error('Mailsink: API key is empty.'));
        const body = '{}';
        const req = https.request({
            hostname: 'api.mailsink.dev', port: 443, path: '/v1/inboxes', method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    if (p.address && p.id) resolve(p);
                    else reject(new Error(`Mailsink: ${p.message || p.error || 'error'}`));
                } catch (e) { reject(new Error(`Mailsink: invalid JSON`)); }
            });
        });
        req.on('error', e => reject(new Error('Mailsink network: ' + e.message)));
        req.setTimeout(12000, () => { req.destroy(); reject(new Error('Mailsink timeout')); });
        req.write(body); req.end();
    });
}

function mailsinkPollOtp(apiKey, inboxId, timeoutMs = 75000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const tryFetch = () => {
            const req = https.request({
                hostname: 'api.mailsink.dev', port: 443, path: `/v1/inboxes/${encodeURIComponent(inboxId)}/latest-code`, method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const p = JSON.parse(d);
                        if (p.code && /^\d{5,8}$/.test(String(p.code).trim())) return resolve(String(p.code).trim());
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(tryFetch, 2500); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(tryFetch, 2500); else resolve(null); });
            req.setTimeout(10000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(tryFetch, 2500); else resolve(null); });
            req.end();
        };
        tryFetch();
    });
}

// 3. Temp.tf (temp.tf)
function temptfGetAccount(providers = '') {
    return new Promise((resolve, reject) => {
        const provStr = (typeof providers === 'string' && providers.length > 0) ? providers : '';
        const query = `dot=1&plus=1${provStr ? `&providers=${encodeURIComponent(provStr)}` : ''}`;
        const req = https.request({
            hostname: 'temp.tf', port: 443, path: `/api/account?${query}`, method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    if (p.email) resolve({ email: p.email }); else reject(new Error(p.error || 'Temp.tf error'));
                } catch (e) { reject(new Error('Temp.tf JSON error')); }
            });
        });
        req.on('error', e => reject(new Error('Temp.tf network: ' + e.message)));
        req.setTimeout(12000, () => { req.destroy(); reject(new Error('Temp.tf timeout')); });
        req.end();
    });
}

function temptfPollOtp(email, timeoutMs = 75000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const payload = JSON.stringify({ email: email.trim() });
        const tryFetch = () => {
            const req = https.request({
                hostname: 'temp.tf', port: 443, path: '/api/check', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const p = JSON.parse(d);
                        const msgs = Array.isArray(p.data) ? p.data : [];
                        for (const m of msgs) {
                            const code = extractOtpCode(m.subject) || extractOtpCode(m.body);
                            if (code) return resolve(code);
                        }
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(tryFetch, 3000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(tryFetch, 3000); else resolve(null); });
            req.setTimeout(12000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(tryFetch, 3000); else resolve(null); });
            req.write(payload); req.end();
        };
        tryFetch();
    });
}

// 4. 1SecMail (1secmail.com)
let _secmailDomainsCache = null;
async function secmailGetDomains() {
    if (_secmailDomainsCache && _secmailDomainsCache.length > 0) return _secmailDomainsCache;
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'www.1secmail.com', port: 443, path: '/api/v1/?action=getDomainList', method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const list = JSON.parse(d);
                    if (Array.isArray(list) && list.length > 0) { _secmailDomainsCache = list; return resolve(list); }
                } catch (_) { }
                _secmailDomainsCache = ['1secmail.com', '1secmail.org', '1secmail.net']; resolve(_secmailDomainsCache);
            });
        });
        req.on('error', () => { _secmailDomainsCache = ['1secmail.com', '1secmail.org', '1secmail.net']; resolve(_secmailDomainsCache); });
        req.setTimeout(8000, () => { req.destroy(); _secmailDomainsCache = ['1secmail.com', '1secmail.org', '1secmail.net']; resolve(_secmailDomainsCache); });
        req.end();
    });
}

function secmailCreateAccount(domainOrProxy = '1secmail.com') {
    let domain = (typeof domainOrProxy === 'string' && domainOrProxy.includes('.')) ? domainOrProxy : '1secmail.com';
    const fn = 'iguser' + crypto.randomBytes(3).toString('hex');
    const login = `${fn}${Math.floor(1000 + Math.random() * 9000)}`;
    const email = `${login}@${domain}`;
    return { login, domain, email };
}

function secmailPollOtp(login, domain, timeoutMs = 75000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const pollInbox = () => {
            const req = https.request({
                hostname: 'www.1secmail.com', port: 443, path: `/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`, method: 'GET',
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', async () => {
                    try {
                        const msgs = JSON.parse(d);
                        if (Array.isArray(msgs) && msgs.length > 0) {
                            for (const msg of msgs) {
                                const subjectCode = extractOtpCode(msg.subject);
                                if (subjectCode) return resolve(subjectCode);
                                const bodyCode = await new Promise((resBody) => {
                                    const bReq = https.request({
                                        hostname: 'www.1secmail.com', port: 443,
                                        path: `/api/v1/?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${msg.id}`, method: 'GET',
                                        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                                    }, (bRes) => {
                                        let bd = ''; bRes.on('data', c => bd += c);
                                        bRes.on('end', () => {
                                            try { const bParsed = JSON.parse(bd); resBody(extractOtpCode(bParsed.textBody || bParsed.body || bParsed.htmlBody || '')); }
                                            catch (_) { resBody(null); }
                                        });
                                    });
                                    bReq.on('error', () => resBody(null));
                                    bReq.setTimeout(5000, () => { bReq.destroy(); resBody(null); });
                                    bReq.end();
                                });
                                if (bodyCode) return resolve(bodyCode);
                            }
                        }
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null); });
            req.setTimeout(8000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null); });
            req.end();
        };
        pollInbox();
    });
}

// 5. GuerrillaMail (api.guerrillamail.com)
function guerrillaCreateAccount() {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.guerrillamail.com', port: 443, path: '/ajax.php?f=get_email_address&lang=en', method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    if (p.email_addr && p.sid_token) return resolve({ email: p.email_addr, sidToken: p.sid_token });
                    reject(new Error('GuerrillaMail: Invalid response'));
                } catch (e) { reject(new Error('GuerrillaMail JSON error')); }
            });
        });
        req.on('error', e => reject(new Error('GuerrillaMail network: ' + e.message)));
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('GuerrillaMail timeout')); });
        req.end();
    });
}

function guerrillaPollOtp(sidToken, timeoutMs = 75000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const pollInbox = () => {
            const req = https.request({
                hostname: 'api.guerrillamail.com', port: 443, path: `/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(sidToken)}`, method: 'GET',
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const p = JSON.parse(d);
                        const list = Array.isArray(p.list) ? p.list : [];
                        for (const item of list) {
                            const code = extractOtpCode((item.mail_subject || '') + ' ' + (item.mail_excerpt || ''));
                            if (code) return resolve(code);
                        }
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null); });
            req.setTimeout(8000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null); });
            req.end();
        };
        pollInbox();
    });
}

// 6. TempMail.lol (api.tempmail.lol)
function tempmaillolGetAccount() {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.tempmail.lol', port: 443, path: '/v2/inbox/create', method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        }, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    if (p.address && p.token) return resolve({ email: p.address, token: p.token });
                    reject(new Error('TempMail.lol: Invalid response'));
                } catch (e) { reject(new Error('TempMail.lol JSON error')); }
            });
        });
        req.on('error', e => reject(new Error('TempMail.lol network: ' + e.message)));
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('TempMail.lol timeout')); });
        req.end();
    });
}

function tempmaillolPollOtp(token, timeoutMs = 75000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const pollInbox = () => {
            const req = https.request({
                hostname: 'api.tempmail.lol', port: 443, path: `/v2/inbox?token=${encodeURIComponent(token)}`, method: 'GET',
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const p = JSON.parse(d);
                        const emails = Array.isArray(p.emails) ? p.emails : [];
                        for (const em of emails) {
                            const code = extractOtpCode((em.subject || '') + ' ' + (em.body || '') + ' ' + (em.html || ''));
                            if (code) return resolve(code);
                        }
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null); });
            req.setTimeout(8000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(pollInbox, 3000); else resolve(null); });
            req.end();
        };
        pollInbox();
    });
}

// 7. Mail.tm (api.mail.tm)
let _mailtmDomainsCache = [];
let _mailtmActiveHost = 'api.mail.tm';

async function mailtmGetDomains() {
    if (_mailtmDomainsCache.length > 0) return _mailtmDomainsCache;
    const hosts = ['api.mail.tm', 'api.mailgw.net'];
    for (const host of hosts) {
        try {
            const domains = await new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: host, port: 443, path: '/domains', method: 'GET',
                    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                }, (res) => {
                    let d = ''; res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const p = JSON.parse(d);
                            const list = (p['hydra:member'] || []).filter(x => x.isActive !== false).map(x => x.domain);
                            if (list && list.length > 0) { _mailtmActiveHost = host; resolve(list); }
                            else reject(new Error('No domains'));
                        } catch (e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
                req.end();
            });
            if (domains && domains.length > 0) { _mailtmDomainsCache = domains; return domains; }
        } catch (_) { }
    }
    const fallbackDomains = ['vwh.me', 'mepost.net', 'somelora.com', 'bugfoo.com', 'bupkes.org', 'mohmal.im'];
    _mailtmDomainsCache = fallbackDomains;
    return fallbackDomains;
}

async function mailtmCreateAccount(domainOrProxy) {
    let domain = (typeof domainOrProxy === 'string' && domainOrProxy.includes('.')) ? domainOrProxy : null;
    if (!domain) {
        const domains = await mailtmGetDomains();
        domain = domains[Math.floor(Math.random() * domains.length)];
    }
    return new Promise(async (resolve, reject) => {
        const host = _mailtmActiveHost || 'api.mail.tm';
        try {
            const user = 'ig_' + crypto.randomBytes(4).toString('hex');
            const address = `${user}@${domain}`;
            const password = 'Pwd' + crypto.randomBytes(4).toString('hex') + '!9A';
            const regPayload = JSON.stringify({ address, password });

            await new Promise((resAcc, rejAcc) => {
                const req = https.request({
                    hostname: host, port: 443, path: '/accounts', method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(regPayload), 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                }, (res) => {
                    let d = ''; res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const p = JSON.parse(d);
                            if (p.address || res.statusCode === 201 || res.statusCode === 200) resAcc(p);
                            else rejAcc(new Error(p.message || `HTTP ${res.statusCode}`));
                        } catch (e) { rejAcc(e); }
                    });
                });
                req.on('error', rejAcc);
                req.setTimeout(10000, () => { req.destroy(); rejAcc(new Error('Timeout creating account')); });
                req.write(regPayload); req.end();
            });

            const tokenPayload = JSON.stringify({ address, password });
            const token = await new Promise((resTok, rejTok) => {
                const req = https.request({
                    hostname: host, port: 443, path: '/token', method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tokenPayload), 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                }, (res) => {
                    let d = ''; res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const p = JSON.parse(d);
                            if (p.token) resTok(p.token); else rejTok(new Error('No token'));
                        } catch (e) { rejTok(e); }
                    });
                });
                req.on('error', rejTok);
                req.setTimeout(10000, () => { req.destroy(); rejTok(new Error('Timeout getting token')); });
                req.write(tokenPayload); req.end();
            });

            resolve({ address, password, token, host });
        } catch (err) { reject(err); }
    });
}

function mailtmPollOtp(token, timeoutMs = 75000, host = 'api.mail.tm') {
    const activeHost = host || _mailtmActiveHost || 'api.mail.tm';
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const tryFetch = () => {
            const req = https.request({
                hostname: activeHost, port: 443, path: '/messages', method: 'GET',
                headers: { 'Authorization': `Bearer ${token.trim()}`, 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', async () => {
                    try {
                        const p = JSON.parse(d);
                        const msgs = Array.isArray(p['hydra:member']) ? p['hydra:member'] : [];
                        for (const m of msgs) {
                            const code = extractOtpCode(m.subject) || extractOtpCode(m.intro);
                            if (code) return resolve(code);
                            if (m.id) {
                                const fullMsg = await new Promise((resMsg) => {
                                    const reqMsg = https.request({
                                        hostname: activeHost, port: 443, path: `/messages/${encodeURIComponent(m.id)}`, method: 'GET',
                                        headers: { 'Authorization': `Bearer ${token.trim()}`, 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                                    }, (rMsg) => {
                                        let dMsg = ''; rMsg.on('data', c => dMsg += c);
                                        rMsg.on('end', () => { try { resMsg(JSON.parse(dMsg)); } catch (_) { resMsg(null); } });
                                    });
                                    reqMsg.on('error', () => resMsg(null));
                                    reqMsg.setTimeout(8000, () => { reqMsg.destroy(); resMsg(null); });
                                    reqMsg.end();
                                });
                                if (fullMsg) {
                                    const codeF = extractOtpCode((fullMsg.text || '') + ' ' + (fullMsg.html || ''));
                                    if (codeF) return resolve(codeF);
                                }
                            }
                        }
                    } catch (_) { }
                    if (Date.now() < deadline) setTimeout(tryFetch, 3000); else resolve(null);
                });
            });
            req.on('error', () => { if (Date.now() < deadline) setTimeout(tryFetch, 3000); else resolve(null); });
            req.setTimeout(12000, () => { req.destroy(); if (Date.now() < deadline) setTimeout(tryFetch, 3000); else resolve(null); });
            req.end();
        };
        tryFetch();
    });
}

// 8. Mail.cx (api.mail.cx — Long-poll, Unlimited)
let _mailcxDomainsCache = [];

async function mailcxGetDomains(apiKey = '') {
    if (_mailcxDomainsCache.length > 0) return _mailcxDomainsCache;

    const extractDomainStrings = (data) => {
        if (!data) return [];
        let rawList = [];
        if (Array.isArray(data)) {
            rawList = data;
        } else if (typeof data === 'object') {
            if (Array.isArray(data.domains)) rawList = data.domains;
            else if (Array.isArray(data.system_domains)) rawList = data.system_domains;
            else if (Array.isArray(data.allowed_domains)) rawList = data.allowed_domains;
            else if (Array.isArray(data.data)) rawList = data.data;
            else if (Array.isArray(data.results)) rawList = data.results;
        }
        const clean = [];
        for (const item of rawList) {
            if (typeof item === 'string' && item.includes('.')) {
                clean.push(item.trim());
            } else if (item && typeof item === 'object') {
                const d = item.domain || item.name || item.host || item.domain_name || item.address;
                if (typeof d === 'string' && d.includes('.')) clean.push(d.trim());
            }
        }
        return [...new Set(clean)];
    };

    // 1. Try GET /v1/config (Public system domains like 9k3r.com)
    try {
        const sysD = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.mail.cx',
                port: 443,
                path: '/v1/config',
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }, (res) => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(d);
                        const doms = extractDomainStrings(parsed);
                        if (doms.length > 0) resolve(doms);
                        else reject(new Error('No domains in config'));
                    } catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
        if (sysD && sysD.length > 0) {
            _mailcxDomainsCache = sysD;
            return sysD;
        }
    } catch (_) { }

    // 2. Try GET /v1/domains if apiKey provided
    if (apiKey && apiKey.trim().length > 0) {
        try {
            const customD = await new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: 'api.mail.cx',
                    port: 443,
                    path: '/v1/domains',
                    method: 'GET',
                    headers: {
                        'x-api-token': apiKey.trim(),
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }, (res) => {
                    let d = '';
                    res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(d);
                            const doms = extractDomainStrings(parsed);
                            if (doms.length > 0) resolve(doms);
                            else reject(new Error('No custom domains'));
                        } catch (e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
                req.end();
            });
            if (customD && customD.length > 0) {
                _mailcxDomainsCache = customD;
                return customD;
            }
        } catch (_) { }
    }

    // 3. Fallback active system domain
    _mailcxDomainsCache = ['9k3r.com', 'mail.cx'];
    return _mailcxDomainsCache;
}

const _usedMailcxHandles = new Set();

function mailcxCreateAccount(domain = '9k3r.com') {
    let d = '9k3r.com';
    if (typeof domain === 'string' && domain.includes('.')) {
        d = domain.trim();
    } else if (domain && typeof domain === 'object') {
        d = domain.domain || domain.name || domain.host || '9k3r.com';
    }

    let attempts = 0;
    while (attempts < 50) {
        attempts++;
        const nameObj = generateRandomName();
        const first = (nameObj.first || 'alex')
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().replace(/[^a-z0-9]/g, '');
        const last = (nameObj.last || 'miller')
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().replace(/[^a-z0-9]/g, '');

        const sepChoices = ['.', '_', ''];
        const sep = sepChoices[Math.floor(Math.random() * sepChoices.length)];
        const rndNum = Math.floor(Math.random() * 90000) + 1000;
        const user = `${first}${sep}${last}${rndNum}`;
        const email = `${user}@${d}`;

        if (!_usedMailcxHandles.has(email)) {
            _usedMailcxHandles.add(email);
            return { email, domain: d, isMailcx: true, firstName: nameObj.first, lastName: nameObj.last };
        }
    }

    const fallbackUser = `user.${crypto.randomBytes(3).toString('hex')}${Math.floor(Math.random() * 9000) + 1000}`;
    const email = `${fallbackUser}@${d}`;
    _usedMailcxHandles.add(email);
    return { email, domain: d, isMailcx: true };
}

function mailcxPollOtp(apiKey, email, timeoutMs = 90000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const cleanEmail = email.trim();

        const fetchEmailBody = (emailId) => {
            return new Promise((resBody) => {
                const req = https.request({
                    hostname: 'api.mail.cx',
                    port: 443,
                    path: `/v1/email/${encodeURIComponent(emailId)}`,
                    method: 'GET',
                    headers: {
                        ...(apiKey && { 'x-api-token': apiKey.trim() }),
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                    }
                }, (res) => {
                    let d = '';
                    res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const p = JSON.parse(d);
                            const body = p?.text || p?.html || p?.body || d;
                            resBody(body);
                        } catch (_) { resBody(d); }
                    });
                });
                req.on('error', () => resBody(''));
                req.setTimeout(8000, () => { req.destroy(); resBody(''); });
                req.end();
            });
        };

        const tryPoll = () => {
            const pathQuery = `/v1/inbox/${encodeURIComponent(cleanEmail)}`;
            const req = https.request({
                hostname: 'api.mail.cx',
                port: 443,
                path: pathQuery,
                method: 'GET',
                headers: {
                    ...(apiKey && { 'x-api-token': apiKey.trim() }),
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            }, (res) => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', async () => {
                    if (res.statusCode === 200) {
                        try {
                            const p = JSON.parse(d);
                            const emails = Array.isArray(p?.emails) ? p.emails : (Array.isArray(p) ? p : []);
                            for (const m of emails) {
                                const codeSubj = extractOtpCode(m.subject || '');
                                if (codeSubj) return resolve(codeSubj);

                                const codePrev = extractOtpCode(m.preview_text || m.preview || '');
                                if (codePrev) return resolve(codePrev);

                                if (m.id) {
                                    const fullBody = await fetchEmailBody(m.id);
                                    const codeBody = extractOtpCode(fullBody);
                                    if (codeBody) return resolve(codeBody);
                                }
                            }
                        } catch (err) { }
                    }
                    if (Date.now() < deadline) {
                        setTimeout(tryPoll, 2000);
                    } else {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => {
                if (Date.now() < deadline) setTimeout(tryPoll, 2500);
                else resolve(null);
            });
            req.setTimeout(12000, () => {
                req.destroy();
                if (Date.now() < deadline) setTimeout(tryPoll, 2500);
                else resolve(null);
            });
            req.end();
        };

        tryPoll();
    });
}


// ── 3. Configuration & Branding ────────────────────────────────
let SUCCESSFUL_FILE = 'successful.txt';
let CONFIRMED_FILE = 'confirmed.txt';
let TWO_FA_FILE = '2fa.txt';
let FAILED_FILE = 'failed.txt';
let DEBUG_FILE = 'debug.txt';
const ENABLE_DEBUG_LOG = false; // Toggle to true to enable debug.txt logging

function debugLog(phone, step, data) {
    if (!ENABLE_DEBUG_LOG) return;
    try {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${phone}] [${step}]\n${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n${'─'.repeat(80)}\n`;
        fs.appendFileSync(DEBUG_FILE, line, 'utf8');
    } catch (e) { /* never crash on debug */ }
}

const B = chalk.hex('#FF0066'); // IG Pinkish
const C = chalk.hex('#FCAF45'); // IG Orange
const Y = chalk.hex('#FFD700');
const W = chalk.white;
const G = chalk.gray;
const R = chalk.hex('#FF6B6B');
const DIM = chalk.hex('#555555');

function printHeader() {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    console.log(B('   ___ ____    ____                _             '));
    console.log(B('  |_ _/ ___|  / ___| ___( )____ __| |_ ___  ____ '));
    console.log(C('   | | |  _  | |   / _ \\|/ __/ _` | __/ _ \\|  __|'));
    console.log(C('   | | |_| | | |__|  __/  | | (_| | || (_) | |   '));
    console.log(Y('  |___\\____|  \\____\\___|  |_|\\__,_|\\__\\___/|_|   \n'));
    console.log(W('┌──────────────────────────────────────────────┐'));
    console.log(W('│ [•] OWNER      : ') + B('SCRAPER KING         ') + W('│'));
    console.log(W('│ [•] Telegram  : ') + C('t.me/scraper_king     ') + W('│'));
    console.log(W('│ [•] Status    : ') + G('Premium License       ') + W('│'));
    console.log(W('│ [•] Version   : ') + Y('V5.0.0                ') + W('│'));
    console.log(W('└──────────────────────────────────────────────┘\n'));
}

// ── 4. Common Helpers ──────────────────────────────────────────
function normalizePhoneNumber(phone) {
    let normalized = phone.replace(/[^0-9@.]/g, ''); // Allow email parsing if @ is present
    return normalized;
}

const uuid = () => crypto.randomUUID();

// Aug 5 2026: __s is a static-per-session token (3 groups of 6 alphanum chars, colon-separated)
// e.g. "zykr0e:o6786o:9vxvi1" — generated ONCE per registration attempt and reused for all calls
const SESSID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function genSessionId() {
    const seg = () => Array.from({ length: 6 }, () => SESSID_CHARS[Math.floor(Math.random() * SESSID_CHARS.length)]).join('');
    return `${seg()}:${seg()}:${seg()}`;
}

function generateRandomDOB() {
    const currentYear = new Date().getFullYear();
    const minAge = 19;
    const maxAge = 40;
    const age = Math.floor(Math.random() * (maxAge - minAge + 1)) + minAge;
    const year = currentYear - age;
    const month = Math.floor(Math.random() * 12) + 1;
    const daysInMonth = (month === 2) ? 28 : ([4, 6, 9, 11].includes(month) ? 30 : 31);
    const day = Math.floor(Math.random() * daysInMonth) + 1;
    return { day, month, year, age, full: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function generateRandomPassword(mode = 'default', customVal = '') {
    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
    const syms = '!@#$%^&*';
    const digits = '0123456789';

    if (mode === 'custom' && customVal) {
        if (customVal.includes('###') || customVal.includes('Date')) {
            const r3 = syms[Math.floor(Math.random() * syms.length)] + digits[Math.floor(Math.random() * digits.length)] + syms[Math.floor(Math.random() * syms.length)];
            return customVal.replace(/###/g, r3).replace(/Date/g, dateStr);
        }
        return customVal;
    }
    if (mode === 'random') {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        let pass = '';
        for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
        return pass;
    }
    // Default mode: ScraperKing###Date (e.g. ScraperKing@7#19082026)
    const randSymbols = syms[Math.floor(Math.random() * syms.length)] + digits[Math.floor(Math.random() * digits.length)] + syms[Math.floor(Math.random() * syms.length)];
    return `ScraperKing${randSymbols}${dateStr}`;
}

const REGIONAL_NAMES = {
    // Hispanic / Latin America / Spain (ES, MX, AR, CO, CL, PE, VE, EC, GT, CU, BO, DO, HN, PY, SV, NI, CR, PA, UY, PR)
    'es': {
        first: ['Mateo', 'Santiago', 'Matias', 'Sebastian', 'Alejandro', 'Diego', 'Samuel', 'Nicolas', 'Daniel', 'Lucas', 'Joaquin', 'Emiliano', 'Gabriel', 'Tomas', 'Martin', 'Lucas', 'Leonardo', 'Sofia', 'Isabella', 'Camila', 'Valentina', 'Valeria', 'Mariana', 'Luciana', 'Daniela', 'Gabriela', 'Victoria', 'Martina', 'Sara', 'Samantha', 'Andrea', 'Natalia', 'Elena', 'Paula'],
        last: ['Garcia', 'Rodriguez', 'Gonzalez', 'Fernandez', 'Lopez', 'Martinez', 'Sanchez', 'Perez', 'Gomez', 'Martin', 'Jimenez', 'Ruiz', 'Hernandez', 'Diaz', 'Moreno', 'Alvarez', 'Romero', 'Alonso', 'Gutierrez', 'Navarro', 'Torres', 'Dominguez', 'Vazquez', 'Ramos', 'Ramirez', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Morales', 'Suarez', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marin', 'Sanz', 'Nunez', 'Iglesias', 'Medina', 'Garrido', 'Cortes', 'Castillo', 'Santos', 'Lozano', 'Guerrero', 'Cano', 'Prieto', 'Mendez', 'Cruz', 'Calvo', 'Gallego', 'Vidal', 'Leon', 'Marquez', 'Herrera', 'Pena', 'Flores', 'Cabrera', 'Campos', 'Vega', 'Fuentes', 'Carrasco', 'Diez', 'Caballero', 'Reyes', 'Nieto', 'Aguilar', 'Pascual', 'Santana', 'Herrero', 'Lorenzo', 'Montero', 'Hidalgo', 'Gimenez', 'Ibanez', 'Ferrer', 'Duran', 'Santiago', 'Benitez', 'Mora', 'Vicente', 'Vargas', 'Arias', 'Carmona', 'Crespo', 'Roman', 'Pastor', 'Soto', 'Saez', 'Velasco', 'Soler', 'Moya', 'Esteban', 'Parra', 'Bravo', 'Gallardo', 'Rojas']
    },
    // Portuguese / Brazil (PT, BR, AO, MZ, CV)
    'pt': {
        first: ['Miguel', 'Arthur', 'Gael', 'Heitor', 'Bernardo', 'Davi', 'Gabriel', 'Noah', 'Samuel', 'Pedro', 'Lucas', 'Benjamin', 'Matheus', 'Rafael', 'Joaquim', 'Helena', 'Alice', 'Laura', 'Maria', 'Sophia', 'Manuela', 'Maitê', 'Liz', 'Cecilia', 'Isabella', 'Luisa', 'Eloa', 'Heloisa', 'Julia', 'Lorena', 'Livia', 'Maria Luiza', 'Beatriz', 'Lara', 'Antonella'],
        last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas', 'Cardoso', 'Ramos', 'Goncalves', 'Santana', 'Teixeira']
    },
    // French (FR, BE, CA, CH, MC, SN, CI, CM, CD, etc.)
    'fr': {
        first: ['Gabriel', 'Leo', 'Raphael', 'Louis', 'Noah', 'Jules', 'Arthur', 'Adam', 'Lucas', 'Liam', 'Sacha', 'Hugo', 'Gaspard', 'Mael', 'Paul', 'Jade', 'Louise', 'Ambre', 'Alba', 'Emma', 'Rose', 'Alice', 'Romy', 'Anna', 'Lina', 'Mia', 'Lea', 'Julia', 'Chloe', 'Lou', 'Elena', 'Ines', 'Agathe', 'Jeanne', 'Iris', 'Eva', 'Charlie', 'Adele', 'Victoire', 'Manon'],
        last: ['Martin', 'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard', 'Durand', 'Dubois', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre', 'Leroy', 'Roux', 'David', 'Bertrand', 'Morel', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Muller', 'Lefevre', 'Faure', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer', 'Garnier']
    },
    // German (DE, AT, CH, LI, LU)
    'de': {
        first: ['Noah', 'Matteo', 'Leon', 'Finn', 'Paul', 'Elias', 'Emil', 'Luca', 'Louis', 'Felix', 'Henry', 'Theo', 'Maximilian', 'Anton', 'Liam', 'Mia', 'Emilia', 'Emma', 'Sophia', 'Hannah', 'Lina', 'Ella', 'Mila', 'Clara', 'Lea', 'Marie', 'Ida', 'Charlotte', 'Frieda', 'Luisa', 'Amelie', 'Leni', 'Leonie', 'Johanna', 'Maja', 'Emily', 'Anna', 'Mathilda', 'Pia', 'Lilly'],
        last: ['Muller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schafer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schroder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Kruger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Kohler']
    },
    // Italian (IT, SM, CH)
    'it': {
        first: ['Leonardo', 'Francesco', 'Alessandro', 'Lorenzo', 'Mattia', 'Tommaso', 'Gabriele', 'Andrea', 'Riccardo', 'Edoardo', 'Matteo', 'Diego', 'Nicolo', 'Giuseppe', 'Federico', 'Sofia', 'Aurora', 'Giulia', 'Ginevra', 'Vittoria', 'Beatrice', 'Alice', 'Emma', 'Ludovica', 'Matilde', 'Chiara', 'Giorgia', 'Camilla', 'Nicole', 'Bianca', 'Greta', 'Gaia', 'Martina', 'Anna', 'Noemi'],
        last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferraro', 'Fausti', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale']
    },
    // Russian / Slavic / Post-Soviet (RU, BY, KZ, KG, UZ, TJ, AM, AZ, GE)
    'ru': {
        first: ['Alexander', 'Mikhail', 'Maxim', 'Artem', 'Ivan', 'Dmitry', 'Matvey', 'Daniil', 'Mark', 'Ilya', 'Kirill', 'Timofey', 'Nikita', 'Roman', 'Egor', 'Sofia', 'Anna', 'Maria', 'Eva', 'Victoria', 'Polina', 'Alisa', 'Varvara', 'Alexandra', 'Anastasia', 'Daria', 'Ksenia', 'Ekaterina', 'Vasilisa', 'Miroslava', 'Arina', 'Milana', 'Veronika', 'Elena', 'Olga'],
        last: ['Ivanov', 'Smirnov', 'Kuznetsov', 'Popov', 'Vasilyev', 'Petrov', 'Sokolov', 'Mikhailov', 'Novikov', 'Fedorov', 'Morozov', 'Volkov', 'Alekseev', 'Lebedev', 'Semenov', 'Egorov', 'Pavlov', 'Kozlov', 'Stepanov', 'Nikolaev', 'Orlov', 'Andreev', 'Makarov', 'Nikitin', 'Zakharov', 'Zaytsev', 'Solovyov', 'Borisov', 'Yakovlev', 'Grigoryev', 'Romanov', 'Vorobyov', 'Sergeev', 'Kuzmin', 'Frolov']
    },
    // Polish (PL)
    'pl': {
        first: ['Nikodem', 'Antoni', 'Jan', 'Aleksander', 'Franciszek', 'Leon', 'Jakub', 'Ignacy', 'Mikolaj', 'Stanislaw', 'Filip', 'Wojciech', 'Tymon', 'Szymon', 'Adam', 'Zofia', 'Zuzanna', 'Laura', 'Hanna', 'Maja', 'Julia', 'Oliwia', 'Pola', 'Alicja', 'Maria', 'Wiktoria', 'Emilia', 'Antonina', 'Lena', 'Klara', 'Michalina', 'Iga', 'Gabriela', 'Helena', 'Nadia'],
        last: ['Nowak', 'Kowalski', 'Wisniewski', 'Wojcik', 'Kowalczyk', 'Kaminski', 'Lewandowski', 'Zielinski', 'Szymanski', 'Wozniak', 'Dabrowski', 'Kozlowski', 'Jankowski', 'Mazur', 'Wojciechowski', 'Kwiatkowski', 'Krawczyk', 'Kaczmarek', 'Piotrowski', 'Grabowski', 'Zajac', 'Pawlak', 'Michalski', 'Krol', 'Wieczorek', 'Jablonski', 'Wrobel', 'Nowakowski', 'Majewski', 'Olszewski']
    },
    // Romanian (RO, MD)
    'ro': {
        first: ['Andrei', 'Alexandru', 'Stefan', 'David', 'Mihai', 'Ionut', 'Gabriel', 'Matei', 'Cristian', 'Darius', 'Maria', 'Elena', 'Ioana', 'Andreea', 'Sofia', 'Alexandra', 'Ana', 'Gabriela', 'Stefania', 'Daria'],
        last: ['Popa', 'Popescu', 'Radu', 'Ionescu', 'Dumitru', 'Stoica', 'Stan', 'Gheorghe', 'Rusu', 'Munteanu', 'Matei', 'Constantin', 'Serban', 'Florea', 'Marin', 'Dobre', 'Barbu', 'Nistor', 'Toma', 'Enache']
    },
    // Dutch (NL, BE, SR)
    'nl': {
        first: ['Noah', 'Lucas', 'Sem', 'Daan', 'Milan', 'Levi', 'Liam', 'Finn', 'Luuk', 'Bram', 'Emma', 'Mila', 'Sophie', 'Tess', 'Zoe', 'Julia', 'Sara', 'Evi', 'Noor', 'Liv'],
        last: ['De Jong', 'Jansen', 'De Vries', 'Van de Berg', 'Van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer', 'De Boer', 'Mulder', 'De Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'Van Leeuwen', 'Dekker', 'Brouwer']
    },
    // Nordic (SE, NO, DK, FI, IS)
    'scand': {
        first: ['William', 'Liam', 'Oliver', 'Lucas', 'Hugo', 'Elias', 'Noah', 'Astrid', 'Maja', 'Alma', 'Elsa', 'Ella', 'Wilma', 'Freja', 'Olivia', 'Signe', 'Agnes', 'Lilly', 'Klara', 'Saga'],
        last: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Hansen', 'Jensen', 'Olsen', 'Pedersen', 'Nielsen', 'Larsen', 'Rasmussen', 'Christensen', 'Petersen', 'Madsen']
    },
    // Arabic (SA, AE, EG, IQ, JO, KW, LB, LY, MA, OM, QA, SY, TN, YE, DZ, BH, SD, PS)
    'ar': {
        first: ['Mohamed', 'Ahmed', 'Youssef', 'Omar', 'Ali', 'Ibrahim', 'Mahmoud', 'Mustafa', 'Khaled', 'Tarek', 'Karim', 'Amr', 'Hassan', 'Hussein', 'Hamza', 'Fatima', 'Mariam', 'Aya', 'Nour', 'Sara', 'Salma', 'Jana', 'Habiba', 'Malak', 'Farida', 'Reem', 'Yasmine', 'Laila', 'Nada', 'Hana', 'Zainab', 'Amina', 'Dina', 'Rania', 'Shahd'],
        last: ['Elsayed', 'Hassan', 'Ali', 'Ibrahim', 'Mahmoud', 'Mohamed', 'Ahmed', 'Mostafa', 'Abdelrahman', 'Khalil', 'Mansour', 'Salem', 'Farag', 'Soliman', 'Amer', 'Othman', 'Kamel', 'Fawzy', 'Saeed', 'Younis', 'Metwally', 'Shawky', 'Shaban', 'Gaber', 'Salama', 'Hamdy', 'Amin', 'Nasser', 'Shehata', 'Radwan']
    },
    // Turkish (TR, CY)
    'tr': {
        first: ['Yusuf', 'Alparslan', 'Goktug', 'Kerem', 'Omer', 'Mustafa', 'Eymen', 'Ali', 'Aras', 'Emir', 'Zeynep', 'Defne', 'Asel', 'Zumra', 'Elif', 'Asya', 'Azra', 'Nehir', 'Meryem', 'Eylul'],
        last: ['Yilmaz', 'Kaya', 'Demir', 'Celik', 'Sahin', 'Yildiz', 'Yildirim', 'Ozturk', 'Aydin', 'Ozdemir', 'Arslan', 'Dogan', 'Kilic', 'Aslan', 'Cetin', 'Kara', 'Koc', 'Kurt', 'Ozkan', 'Simsek']
    },
    // Indian (IN - Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Punjabi, Kannada, Malayalam)
    'in': {
        first: ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Muhammad', 'Sai', 'Aryan', 'Ishaan', 'Shaurya', 'Aayush', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Aadhya', 'Saanvi', 'Ananya', 'Diya', 'Advika', 'Isha', 'Aarohi', 'Kavya', 'Pari', 'Avani', 'Myra', 'Ira', 'Riya', 'Anvi', 'Prisha', 'Khushi', 'Navya', 'Tanvi', 'Sara', 'Neha', 'Pooja', 'Priya', 'Sneha', 'Shreya'],
        last: ['Sharma', 'Verma', 'Gupta', 'Patel', 'Singh', 'Kumar', 'Shah', 'Mehta', 'Mishra', 'Joshi', 'Reddy', 'Rao', 'Nair', 'Iyer', 'Menon', 'Pillai', 'Chauhan', 'Pandey', 'Yadav', 'Deshmukh', 'Kulkarni', 'Patil', 'Banerjee', 'Chatterjee', 'Bhattacharya', 'Mukherjee', 'Dutta', 'Das', 'Sen', 'Ghosh', 'Bose', 'Choudhury', 'Kapoor', 'Malhotra', 'Khanna', 'Chopra', 'Arora', 'Bhatia', 'Sethi', 'Grover']
    },
    // Pakistani (PK)
    'pk': {
        first: ['Muhammad', 'Ahmed', 'Ali', 'Hamza', 'Usman', 'Bilal', 'Hassan', 'Hussain', 'Zain', 'Saad', 'Fatima', 'Ayesha', 'Zainab', 'Maryam', 'Hafsa', 'Noor', 'Khadija', 'Sadia', 'Hira', 'Sana'],
        last: ['Khan', 'Malik', 'Chaudhry', 'Bhatti', 'Raza', 'Shah', 'Qureshi', 'Abbasi', 'Butt', 'Siddiqui', 'Rehman', 'Javed', 'Akhtar', 'Iqbal', 'Mirza', 'Farooq', 'Mughal', 'Gondal', 'Tariq', 'Rasheed']
    },
    // Bangladeshi (BD)
    'bd': {
        first: ['Rahim', 'Karim', 'Tanvir', 'Shakib', 'Tamim', 'Rakib', 'Arif', 'Hasan', 'Mahmud', 'Sabbir', 'Nusrat', 'Sadia', 'Farhana', 'Tanjina', 'Sumaiya', 'Tasnim', 'Jannat', 'Mehnaz', 'Afroza', 'Rimi'],
        last: ['Islam', 'Hossain', 'Rahman', 'Ahmed', 'Chowdhury', 'Hasan', 'Uddin', 'Khan', 'Miah', 'Sarker', 'Ali', 'Bhuiyan', 'Haque', 'Sikder', 'Akter', 'Begum', 'Khatun', 'Tarafdar', 'Majumder', 'Dewan']
    },
    // Indonesian (ID)
    'id': {
        first: ['Muhammad', 'Dimas', 'Bintang', 'Fajar', 'Rizky', 'Aditya', 'Bayu', 'Budi', 'Agus', 'Reza', 'Siti', 'Nur', 'Dewi', 'Putri', 'Anggi', 'Ayu', 'Rina', 'Indah', 'Lestari', 'Maya'],
        last: ['Pratama', 'Saputra', 'Wijaya', 'Kusuma', 'Setiawan', 'Hidayat', 'Santoso', 'Gunawan', 'Wibowo', 'Nugroho', 'Permana', 'Lestari', 'Kurniawan', 'Firmansyah', 'Putra', 'Utomo', 'Siregar', 'Harahap', 'Nasution', 'Simanjuntak']
    },
    // Filipino (PH)
    'ph': {
        first: ['Joshua', 'Angelo', 'Christian', 'Daniel', 'John', 'Gabriel', 'Mark', 'James', 'Nathaniel', 'Carl', 'Angel', 'Princess', 'Nicole', 'Bea', 'Samantha', 'Jasmine', 'Chloe', 'Andrea', 'Sophia', 'Mary'],
        last: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Tomas', 'Andrada', 'Castillo', 'Flores', 'Villanueva', 'Ramos', 'Castro', 'Rivera', 'Aquino', 'Dela Cruz', 'Mercado', 'Valdez']
    },
    // Vietnamese (VN)
    'vn': {
        first: ['Minh', 'Duc', 'Hoang', 'Long', 'Huy', 'Tuan', 'Phong', 'Nam', 'Thang', 'Dung', 'Linh', 'Trang', 'Huong', 'Mai', 'Lan', 'Ngoc', 'Ha', 'Thu', 'Anh', 'Chau'],
        last: ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Phan', 'Vu', 'Vo', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong', 'Ly']
    },
    // Thai (TH)
    'th': {
        first: ['Somchai', 'Somsak', 'Arthit', 'Kittisak', 'Chatchai', 'Nutthapong', 'Worawat', 'Thanakorn', 'Supaporn', 'Kannika', 'Siriporn', 'Ratree', 'Patcharee', 'Narumon', 'Chutima', 'Wannisa'],
        last: ['Saetang', 'Saelim', 'Suksomboon', 'Rattanakul', 'Charoensuk', 'Wongsuwan', 'Panyarachun', 'Songprasert', 'Chantaramongkol', 'Phonphiboon']
    },
    // Japanese (JP)
    'jp': {
        first: ['Haruto', 'Riku', 'Haru', 'Hinata', 'Kaito', 'Asahi', 'Sora', 'Yuto', 'Touma', 'Ren', 'Yui', 'Rio', 'Tsumugi', 'Hina', 'Mei', 'Koharu', 'Sana', 'Ema', 'Mio', 'Ichika'],
        last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Saito', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu']
    },
    // Korean (KR)
    'kr': {
        first: ['Minjun', 'Seojun', 'Doyun', 'Yejun', 'Siwoo', 'Hajun', 'Juwan', 'Jiho', 'Joonwoo', 'Minjae', 'Seoyeon', 'Seoyun', 'Jiwoo', 'Seoah', 'Haeun', 'Yuna', 'Mina', 'Sua', 'Jian', 'Chaewon'],
        last: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Jeon', 'Hong']
    },
    // Chinese (CN, TW, HK, MO, SG)
    'zh': {
        first: ['Wei', 'Jie', 'Hao', 'Yi', 'Chen', 'Yu', 'Bo', 'Lei', 'Jun', 'Feng', 'Ying', 'Ting', 'Jing', 'Yan', 'Hui', 'Mei', 'Li', 'Fang', 'Na', 'Min'],
        last: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo', 'He', 'Gao', 'Lin', 'Luo']
    }
};

function generateRandomName(locale = 'en-US') {
    let lang = 'en';
    let country = 'US';

    if (locale && typeof locale === 'string') {
        const parts = locale.toLowerCase().split(/[-_]/);
        lang = parts[0] || 'en';
        country = (parts[1] || '').toUpperCase();
    }

    let bucket = null;

    if (['es', 'mx', 'ar', 'co', 'cl', 'pe', 've', 'ec', 'gt', 'cu', 'bo', 'do', 'hn', 'py', 'sv', 'ni', 'cr', 'pa', 'uy', 'pr'].includes(lang) || ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR'].includes(country)) {
        bucket = REGIONAL_NAMES['es'];
    } else if (['pt', 'br', 'ao', 'mz', 'cv'].includes(lang) || ['PT', 'BR', 'AO', 'MZ', 'CV'].includes(country)) {
        bucket = REGIONAL_NAMES['pt'];
    } else if (['fr', 'be', 'mc', 'sn', 'ci', 'cm', 'cd', 'mg', 'ml', 'gn', 'bf', 'ne', 'tg', 'bj'].includes(lang) || ['FR', 'BE', 'MC', 'SN', 'CI', 'CM', 'CD', 'MG', 'ML', 'GN', 'BF', 'NE', 'TG', 'BJ'].includes(country)) {
        bucket = REGIONAL_NAMES['fr'];
    } else if (['de', 'at', 'li', 'lu'].includes(lang) || ['DE', 'AT', 'LI', 'LU'].includes(country)) {
        bucket = REGIONAL_NAMES['de'];
    } else if (['it', 'sm', 'va'].includes(lang) || ['IT', 'SM', 'VA'].includes(country)) {
        bucket = REGIONAL_NAMES['it'];
    } else if (['ru', 'by', 'kz', 'kg', 'uz', 'tj', 'am', 'az', 'ge'].includes(lang) || ['RU', 'BY', 'KZ', 'KG', 'UZ', 'TJ', 'AM', 'AZ', 'GE'].includes(country)) {
        bucket = REGIONAL_NAMES['ru'];
    } else if (['pl'].includes(lang) || ['PL'].includes(country)) {
        bucket = REGIONAL_NAMES['pl'];
    } else if (['ro', 'md'].includes(lang) || ['RO', 'MD'].includes(country)) {
        bucket = REGIONAL_NAMES['ro'];
    } else if (['nl', 'aw', 'cw', 'sr'].includes(lang) || ['NL', 'AW', 'CW', 'SR'].includes(country)) {
        bucket = REGIONAL_NAMES['nl'];
    } else if (['sv', 'no', 'da', 'fi', 'is', 'se', 'dk'].includes(lang) || ['SE', 'NO', 'DK', 'FI', 'IS'].includes(country)) {
        bucket = REGIONAL_NAMES['scand'];
    } else if (['ar', 'sa', 'ae', 'eg', 'iq', 'jo', 'kw', 'lb', 'ly', 'ma', 'om', 'qa', 'sy', 'tn', 'ye', 'dz', 'bh', 'sd', 'ps'].includes(lang) || ['SA', 'AE', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'QA', 'SY', 'TN', 'YE', 'DZ', 'BH', 'SD', 'PS'].includes(country)) {
        bucket = REGIONAL_NAMES['ar'];
    } else if (['tr'].includes(lang) || ['TR', 'CY'].includes(country)) {
        bucket = REGIONAL_NAMES['tr'];
    } else if (['hi', 'ta', 'te', 'mr', 'bn', 'gu', 'pa', 'kn', 'ml', 'sa'].includes(lang) || ['IN'].includes(country)) {
        bucket = REGIONAL_NAMES['in'];
    } else if (['ur', 'pk'].includes(lang) || ['PK'].includes(country)) {
        bucket = REGIONAL_NAMES['pk'];
    } else if (['bd'].includes(country)) {
        bucket = REGIONAL_NAMES['bd'];
    } else if (['id', 'in'].includes(lang) || ['ID'].includes(country)) {
        bucket = REGIONAL_NAMES['id'];
    } else if (['tl', 'fil', 'ph'].includes(lang) || ['PH'].includes(country)) {
        bucket = REGIONAL_NAMES['ph'];
    } else if (['vi', 'vn'].includes(lang) || ['VN'].includes(country)) {
        bucket = REGIONAL_NAMES['vn'];
    } else if (['th'].includes(lang) || ['TH'].includes(country)) {
        bucket = REGIONAL_NAMES['th'];
    } else if (['ja', 'jp'].includes(lang) || ['JP'].includes(country)) {
        bucket = REGIONAL_NAMES['jp'];
    } else if (['ko', 'kr'].includes(lang) || ['KR'].includes(country)) {
        bucket = REGIONAL_NAMES['kr'];
    } else if (['zh', 'cn', 'tw', 'hk', 'mo', 'sg'].includes(lang) || ['CN', 'TW', 'HK', 'MO', 'SG'].includes(country)) {
        bucket = REGIONAL_NAMES['zh'];
    }

    if (!bucket) {
        // Master International / Anglo fallback (covers all remaining countries)
        bucket = {
            first: [
                'John', 'David', 'Michael', 'Chris', 'James', 'Daniel', 'Matthew', 'Andrew', 'Joshua', 'Robert',
                'William', 'Joseph', 'Thomas', 'Charles', 'Christopher', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul',
                'Kevin', 'Brian', 'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan', 'Jacob',
                'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin',
                'Samuel', 'Gregory', 'Alexander', 'Frank', 'Patrick', 'Raymond', 'Jack', 'Dennis', 'Jerry', 'Tyler',
                'Aaron', 'Jose', 'Adam', 'Nathan', 'Henry', 'Douglas', 'Zachary', 'Peter', 'Kyle', 'Walter',
                'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn',
                'Abigail', 'Emily', 'Elizabeth', 'Mila', 'Ella', 'Avery', 'Sofia', 'Camila', 'Aria', 'Scarlett',
                'Victoria', 'Madison', 'Luna', 'Grace', 'Chloe', 'Penelope', 'Layla', 'Riley', 'Zoey', 'Nora',
                'Lily', 'Eleanor', 'Hannah', 'Lillian', 'Addison', 'Aubrey', 'Ellie', 'Stella', 'Natalie', 'Zoe',
                'Leah', 'Hazel', 'Violet', 'Aurora', 'Savannah', 'Audrey', 'Brooklyn', 'Bella', 'Claire', 'Skylar',
                'Lucas', 'Mason', 'Oliver', 'Ethan', 'Liam', 'Noah', 'Logan', 'Jackson', 'Aiden', 'Leo'
            ],
            last: [
                'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
                'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
                'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
                'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
                'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
                'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes',
                'Stewart', 'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper',
                'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
                'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes'
            ]
        };
    }

    const first = bucket.first[Math.floor(Math.random() * bucket.first.length)];
    const last = bucket.last[Math.floor(Math.random() * bucket.last.length)];
    return { first, last, full: `${first} ${last}` };
}

function appendConfirmedSpreadsheet(csvPath, xlsPath, user, pass, cookies, twoFaKey = '') {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // 1. Append to CSV (UTF-8 BOM for native Excel compatibility)
    try {
        if (!fs.existsSync(csvPath)) {
            fs.writeFileSync(csvPath, '\uFEFFUser,Password,Cookie,2FA Key,Created At\n', 'utf8');
        }
        const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
        const csvRow = `${esc(user)},${esc(pass)},${esc(cookies)},${esc(twoFaKey)},${esc(timestamp)}\n`;
        fs.appendFileSync(csvPath, csvRow, 'utf8');
    } catch (_) { }

    // 2. Append to Excel XML Spreadsheet (.xls)
    try {
        const escXml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const newRowXml = `   <Row>\n    <Cell><Data ss:Type="String">${escXml(user)}</Data></Cell>\n    <Cell><Data ss:Type="String">${escXml(pass)}</Data></Cell>\n    <Cell><Data ss:Type="String">${escXml(cookies)}</Data></Cell>\n    <Cell><Data ss:Type="String">${escXml(twoFaKey)}</Data></Cell>\n    <Cell><Data ss:Type="String">${escXml(timestamp)}</Data></Cell>\n   </Row>\n`;

        if (!fs.existsSync(xlsPath)) {
            const initialXml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n xmlns:o="urn:schemas-microsoft-com:office:office"\n xmlns:x="urn:schemas-microsoft-com:office:excel"\n xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n <Worksheet ss:Name="Confirmed Accounts">\n  <Table>\n   <Row>\n    <Cell><Data ss:Type="String">User</Data></Cell>\n    <Cell><Data ss:Type="String">Password</Data></Cell>\n    <Cell><Data ss:Type="String">Cookie</Data></Cell>\n    <Cell><Data ss:Type="String">2FA Key</Data></Cell>\n    <Cell><Data ss:Type="String">Created At</Data></Cell>\n   </Row>\n${newRowXml}  </Table>\n </Worksheet>\n</Workbook>`;
            fs.writeFileSync(xlsPath, initialXml, 'utf8');
        } else {
            let content = fs.readFileSync(xlsPath, 'utf8');
            if (content.includes('</Table>')) {
                content = content.replace('</Table>', `${newRowXml}  </Table>`);
                fs.writeFileSync(xlsPath, content, 'utf8');
            }
        }
    } catch (_) { }
}

function getRandomClient(browserPref = 'random', isMobile = false) {
    const v = Math.floor(Math.random() * (151 - 126 + 1)) + 126;
    const buildNum = Math.floor(Math.random() * 200) + 6400;
    const patch = Math.floor(Math.random() * 150) + 50;

    // Real Chrome GREASE brand per major version (Meta validates this!)
    const greaseMap = {
        126: '"Not/A)Brand";v="8"',
        127: '"Not)A;Brand";v="99"',
        128: '"Not;A=Brand";v="8"',
        129: '"Not=A?Brand";v="8"',
        130: '"Not?A_Brand";v="99"',
        131: '"Not_A Brand";v="24"',
        132: '"Not A(Brand";v="8"',
        133: '"Not(A;Brand";v="99"',
        134: '"Not;A)Brand";v="24"',
        135: '"Not)A=Brand";v="8"',
        136: '"Not=A_Brand";v="99"',
        137: '"Not=A?Brand";v="99"',
        138: '"Not?A_Brand";v="8"',
        139: '"Not_A Brand";v="99"',
        140: '"Not A(Brand";v="24"',
        141: '"Not(A;Brand";v="8"',
        142: '"Not;A)Brand";v="8"',
        143: '"Not)A=Brand";v="24"',
        144: '"Not=A?Brand";v="8"',
        145: '"Not?A_Brand";v="24"',
        146: '"Not_A Brand";v="8"',
        147: '"Not A(Brand";v="99"',
        148: '"Not(A;Brand";v="24"',
        149: '"Not;A)Brand";v="99"',
        150: '"Not)A=Brand";v="99"',
        151: '"Not=A?Brand";v="99"'
    };
    const grease = greaseMap[v] || '"Not A(Brand";v="24"';

    if (isMobile) {
        // ── Comprehensive Real-World Mobile Device Database ────────────────────────
        const mobileModels = [
            // Google Pixel Series (Android 14 & 13)
            { name: 'Google Pixel 9 Pro', model: 'Pixel 9 Pro', os: '14', brand: 'Google' },
            { name: 'Google Pixel 9', model: 'Pixel 9', os: '14', brand: 'Google' },
            { name: 'Google Pixel 8 Pro', model: 'Pixel 8 Pro', os: '14', brand: 'Google' },
            { name: 'Google Pixel 8', model: 'Pixel 8', os: '14', brand: 'Google' },
            { name: 'Google Pixel 8a', model: 'Pixel 8a', os: '14', brand: 'Google' },
            { name: 'Google Pixel 7 Pro', model: 'Pixel 7 Pro', os: '14', brand: 'Google' },
            { name: 'Google Pixel 7', model: 'Pixel 7', os: '14', brand: 'Google' },
            { name: 'Google Pixel 7a', model: 'Pixel 7a', os: '14', brand: 'Google' },
            { name: 'Google Pixel 6 Pro', model: 'Pixel 6 Pro', os: '13', brand: 'Google' },
            { name: 'Google Pixel 6a', model: 'Pixel 6a', os: '13', brand: 'Google' },
            { name: 'Google Pixel Fold', model: 'Pixel Fold', os: '14', brand: 'Google' },

            // Samsung Galaxy Flagship & Foldables (S-Series / Z-Series)
            { name: 'Samsung Galaxy S24 Ultra', model: 'SM-S928B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy S24+', model: 'SM-S926B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy S24', model: 'SM-S921B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy S23 Ultra', model: 'SM-S918B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy S23+', model: 'SM-S916B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy S23', model: 'SM-S911B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy S22 Ultra', model: 'SM-S908B', os: '13', brand: 'Samsung' },
            { name: 'Samsung Galaxy S22', model: 'SM-S901B', os: '13', brand: 'Samsung' },
            { name: 'Samsung Galaxy S21 FE', model: 'SM-G990B', os: '13', brand: 'Samsung' },
            { name: 'Samsung Galaxy Z Fold 5', model: 'SM-F946B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy Z Flip 5', model: 'SM-F731B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy Z Fold 6', model: 'SM-F956B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy Z Flip 6', model: 'SM-F741B', os: '14', brand: 'Samsung' },

            // Samsung Galaxy Midrange & Budget (A-Series / M-Series)
            { name: 'Samsung Galaxy A55 5G', model: 'SM-A556B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy A54 5G', model: 'SM-A546B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy A35 5G', model: 'SM-A356B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy A34 5G', model: 'SM-A346B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy A25 5G', model: 'SM-A256B', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy A15', model: 'SM-A155F', os: '14', brand: 'Samsung' },
            { name: 'Samsung Galaxy A14', model: 'SM-A145R', os: '13', brand: 'Samsung' },
            { name: 'Samsung Galaxy M54 5G', model: 'SM-M546B', os: '13', brand: 'Samsung' },

            // Xiaomi / Redmi / POCO
            { name: 'Xiaomi 14 Ultra', model: '24030PN60G', os: '14', brand: 'Xiaomi' },
            { name: 'Xiaomi 14', model: '23127PN0CC', os: '14', brand: 'Xiaomi' },
            { name: 'Xiaomi 13 Pro', model: '2210132G', os: '13', brand: 'Xiaomi' },
            { name: 'Xiaomi 13T Pro', model: '23078PND5G', os: '13', brand: 'Xiaomi' },
            { name: 'Redmi Note 13 Pro+', model: '23090RA98G', os: '14', brand: 'Xiaomi' },
            { name: 'Redmi Note 13 5G', model: '2312DRAABG', os: '14', brand: 'Xiaomi' },
            { name: 'Redmi Note 12 Pro', model: '22101316G', os: '13', brand: 'Xiaomi' },
            { name: 'POCO F6 Pro', model: '23113RKC6G', os: '14', brand: 'Xiaomi' },
            { name: 'POCO X6 Pro 5G', model: '2311DRK48G', os: '14', brand: 'Xiaomi' },
            { name: 'POCO F5', model: '23049PCD8G', os: '13', brand: 'Xiaomi' },

            // OnePlus
            { name: 'OnePlus 12', model: 'CPH2583', os: '14', brand: 'OnePlus' },
            { name: 'OnePlus 12R', model: 'CPH2609', os: '14', brand: 'OnePlus' },
            { name: 'OnePlus 11 5G', model: 'CPH2449', os: '13', brand: 'OnePlus' },
            { name: 'OnePlus Nord 3', model: 'CPH2493', os: '13', brand: 'OnePlus' },
            { name: 'OnePlus Nord CE 3', model: 'CPH2569', os: '13', brand: 'OnePlus' },
            { name: 'OnePlus Open', model: 'CPH2551', os: '14', brand: 'OnePlus' },

            // Oppo & Vivo & Realme
            { name: 'Oppo Find X7 Ultra', model: 'PHY110', os: '14', brand: 'Oppo' },
            { name: 'Oppo Reno 11 Pro', model: 'CPH2607', os: '14', brand: 'Oppo' },
            { name: 'Oppo A78 5G', model: 'CPH2565', os: '13', brand: 'Oppo' },
            { name: 'Vivo X100 Pro', model: 'V2309', os: '14', brand: 'Vivo' },
            { name: 'Vivo V30 Pro', model: 'V2319', os: '14', brand: 'Vivo' },
            { name: 'Vivo Y200 5G', model: 'V2307', os: '13', brand: 'Vivo' },
            { name: 'Realme GT 5 Pro', model: 'RMX3888', os: '14', brand: 'Realme' },
            { name: 'Realme 12 Pro+ 5G', model: 'RMX3840', os: '14', brand: 'Realme' },
            { name: 'Realme C67', model: 'RMX3890', os: '14', brand: 'Realme' },

            // Motorola & Sony
            { name: 'Motorola Edge 50 Pro', model: 'motorola edge 50 pro', os: '14', brand: 'Motorola' },
            { name: 'Motorola Moto G84', model: 'moto g84 5g', os: '13', brand: 'Motorola' },
            { name: 'Motorola Moto G54', model: 'moto g54 5g', os: '13', brand: 'Motorola' },
            { name: 'Sony Xperia 1 V', model: 'XQ-DQ72', os: '14', brand: 'Sony' },
            { name: 'Sony Xperia 5 V', model: 'XQ-DE72', os: '13', brand: 'Sony' }
        ];

        const m = mobileModels[Math.floor(Math.random() * mobileModels.length)];

        // 1. Samsung Internet Browser Mode
        if (browserPref === 'samsung') {
            const smVer = Math.floor(Math.random() * 3) + 24; // 24.0, 25.0, 26.0
            return {
                name: `${m.name} (Samsung Internet ${smVer}.0)`,
                isMobile: true,
                userAgent: `Mozilla/5.0 (Linux; Android ${m.os}; SAMSUNG ${m.model}) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/${smVer}.0 Chrome/${v}.0.${buildNum}.${patch} Mobile Safari/537.36`,
                clientHints: {
                    'sec-ch-ua': `"Chromium";v="${v}", ${grease}, "Samsung Internet";v="${smVer}.0"`,
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"Android"',
                    'sec-ch-ua-platform-version': `"${m.os}"`,
                    'sec-ch-ua-model': `"${m.model}"`,
                    'sec-ch-prefers-color-scheme': 'dark'
                }
            };
        }

        // 2. Mobile Firefox (Fenix) Mode
        if (browserPref === 'firefox') {
            const ffVersion = Math.floor(Math.random() * (154 - 150 + 1)) + 150;
            return {
                name: `${m.name} (Firefox Mobile ${ffVersion}.0)`,
                isMobile: true,
                userAgent: `Mozilla/5.0 (Android ${m.os}; Mobile; rv:${ffVersion}.0) Gecko/${ffVersion}.0 Firefox/${ffVersion}.0`,
                clientHints: {} // Firefox mobile doesn't send client hints
            };
        }

        // 3. Mobile Microsoft Edge Mode
        if (browserPref === 'edge') {
            return {
                name: `${m.name} (Edge Mobile)`,
                isMobile: true,
                userAgent: `Mozilla/5.0 (Linux; Android ${m.os}; ${m.model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Mobile Safari/537.36 EdgA/${v}.0.${buildNum}.${patch}`,
                clientHints: {
                    'sec-ch-ua': `"Chromium";v="${v}", ${grease}, "Microsoft Edge";v="${v}"`,
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"Android"',
                    'sec-ch-ua-platform-version': `"${m.os}"`,
                    'sec-ch-ua-model': `"${m.model}"`,
                    'sec-ch-prefers-color-scheme': 'dark'
                }
            };
        }

        // 4. Default: Mobile Google Chrome on Android
        return {
            name: `${m.name} (Android Chrome)`,
            isMobile: true,
            userAgent: `Mozilla/5.0 (Linux; Android ${m.os}; ${m.model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Mobile Safari/537.36`,
            clientHints: {
                'sec-ch-ua': `"Chromium";v="${v}", ${grease}, "Google Chrome";v="${v}"`,
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-ch-ua-platform-version': `"${m.os}"`,
                'sec-ch-ua-model': `"${m.model}"`,
                'sec-ch-prefers-color-scheme': 'dark'
            }
        };
    }

    const isMac = Math.random() > 0.5;

    if (browserPref === 'firefox') {
        const ffVersion = Math.floor(Math.random() * (154 - 150 + 1)) + 150;
        return {
            name: isMac ? 'Mac Firefox' : 'Windows Firefox',
            isMobile: false,
            userAgent: isMac
                ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${ffVersion}.0) Gecko/20100101 Firefox/${ffVersion}.0`
                : `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${ffVersion}.0) Gecko/20100101 Firefox/${ffVersion}.0`,
            clientHints: {} // Firefox doesn't use sec-ch-ua
        };
    } else if (browserPref === 'edge') {
        return {
            name: 'Windows Edge',
            isMobile: false,
            userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Safari/537.36 Edg/${v}.0.${buildNum}.${patch}`,
            clientHints: {
                'sec-ch-ua': `"Chromium";v="${v}", ${grease}, "Microsoft Edge";v="${v}"`,
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua-platform-version': `"10.0.0"`
            }
        };
    }

    // Default to Desktop Chrome (Windows or Mac)
    return {
        name: isMac ? 'Mac Chrome' : 'Windows Chrome',
        isMobile: false,
        userAgent: isMac
            ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Safari/537.36`
            : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNum}.${patch} Safari/537.36`,
        clientHints: {
            'sec-ch-ua': `"Chromium";v="${v}", ${grease}, "Google Chrome";v="${v}"`,
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': isMac ? '"macOS"' : '"Windows"',
            'sec-ch-ua-platform-version': isMac ? `"10.15.7"` : `"10.0.0"`
        }
    };
}

// ── 5. Proxy Management ────────────────────────────────────────
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

const CARRIERS_BY_COUNTRY = {
    'Bangladesh': [{ name: 'Grameenphone', mcc: '470', mnc: '01' }, { name: 'Robi', mcc: '470', mnc: '02' }, { name: 'Banglalink', mcc: '470', mnc: '03' }, { name: 'Teletalk', mcc: '470', mnc: '04' }],
    'Myanmar': [{ name: 'MPT', mcc: '414', mnc: '01' }, { name: 'Ooredoo Myanmar', mcc: '414', mnc: '05' }, { name: 'Atom (Telenor)', mcc: '414', mnc: '06' }, { name: 'Mytel', mcc: '414', mnc: '09' }],
    'India': [{ name: 'Reliance Jio', mcc: '405', mnc: '854' }, { name: 'Airtel', mcc: '404', mnc: '45' }, { name: 'Vodafone Idea', mcc: '404', mnc: '86' }, { name: 'BSNL', mcc: '404', mnc: '34' }],
    'Pakistan': [{ name: 'Jazz', mcc: '410', mnc: '01' }, { name: 'Zong', mcc: '410', mnc: '04' }, { name: 'Telenor Pakistan', mcc: '410', mnc: '06' }, { name: 'Ufone', mcc: '410', mnc: '03' }],
    'United States': [{ name: 'AT&T', mcc: '310', mnc: '410' }, { name: 'T-Mobile', mcc: '310', mnc: '260' }, { name: 'Verizon', mcc: '311', mnc: '480' }],
    'United Kingdom': [{ name: 'EE', mcc: '234', mnc: '30' }, { name: 'O2', mcc: '234', mnc: '10' }, { name: 'Vodafone UK', mcc: '234', mnc: '15' }, { name: 'Three UK', mcc: '234', mnc: '20' }],
    'Germany': [{ name: 'Telekom', mcc: '262', mnc: '01' }, { name: 'Vodafone', mcc: '262', mnc: '02' }, { name: 'O2 Germany', mcc: '262', mnc: '07' }],
    'France': [{ name: 'Orange', mcc: '208', mnc: '01' }, { name: 'SFR', mcc: '208', mnc: '10' }, { name: 'Bouygues', mcc: '208', mnc: '20' }, { name: 'Free Mobile', mcc: '208', mnc: '15' }],
    'UAE': [{ name: 'Etisalat', mcc: '424', mnc: '02' }, { name: 'du', mcc: '424', mnc: '03' }],
    'Saudi Arabia': [{ name: 'STC', mcc: '420', mnc: '01' }, { name: 'Mobily', mcc: '420', mnc: '03' }, { name: 'Zain', mcc: '420', mnc: '04' }],
    'Indonesia': [{ name: 'Telkomsel', mcc: '510', mnc: '10' }, { name: 'Indosat', mcc: '510', mnc: '01' }, { name: 'XL Axiata', mcc: '510', mnc: '11' }, { name: 'Smartfren', mcc: '510', mnc: '09' }],
    'Philippines': [{ name: 'Globe', mcc: '515', mnc: '02' }, { name: 'Smart', mcc: '515', mnc: '03' }, { name: 'DITO', mcc: '515', mnc: '66' }],
    'Thailand': [{ name: 'AIS', mcc: '520', mnc: '01' }, { name: 'TrueMove', mcc: '520', mnc: '05' }, { name: 'DTAC', mcc: '520', mnc: '18' }],
    'Malaysia': [{ name: 'Maxis', mcc: '502', mnc: '12' }, { name: 'CelcomDigi', mcc: '502', mnc: '16' }, { name: 'U Mobile', mcc: '502', mnc: '18' }],
    'Singapore': [{ name: 'Singtel', mcc: '525', mnc: '01' }, { name: 'StarHub', mcc: '525', mnc: '05' }, { name: 'M1', mcc: '525', mnc: '03' }],
    'Australia': [{ name: 'Telstra', mcc: '505', mnc: '01' }, { name: 'Optus', mcc: '505', mnc: '02' }, { name: 'Vodafone AU', mcc: '505', mnc: '03' }],
    'Canada': [{ name: 'Rogers', mcc: '302', mnc: '720' }, { name: 'Bell', mcc: '302', mnc: '610' }, { name: 'Telus', mcc: '302', mnc: '220' }],
    'Brazil': [{ name: 'Vivo', mcc: '724', mnc: '06' }, { name: 'Claro', mcc: '724', mnc: '05' }, { name: 'TIM', mcc: '724', mnc: '04' }],
    'South Africa': [{ name: 'Vodacom', mcc: '655', mnc: '01' }, { name: 'MTN', mcc: '655', mnc: '10' }, { name: 'Cell C', mcc: '655', mnc: '07' }],
    'Nigeria': [{ name: 'MTN Nigeria', mcc: '621', mnc: '30' }, { name: 'Airtel Nigeria', mcc: '621', mnc: '20' }, { name: 'Glo', mcc: '621', mnc: '50' }, { name: '9mobile', mcc: '621', mnc: '60' }],
    'Egypt': [{ name: 'Orange Egypt', mcc: '602', mnc: '01' }, { name: 'Vodafone Egypt', mcc: '602', mnc: '02' }, { name: 'Etisalat Egypt', mcc: '602', mnc: '03' }, { name: 'WE', mcc: '602', mnc: '04' }],
    'Turkey': [{ name: 'Turkcell', mcc: '286', mnc: '01' }, { name: 'Vodafone TR', mcc: '286', mnc: '02' }, { name: 'Turk Telekom', mcc: '286', mnc: '03' }],
    'Russia': [{ name: 'MTS', mcc: '250', mnc: '01' }, { name: 'MegaFon', mcc: '250', mnc: '02' }, { name: 'Beeline', mcc: '250', mnc: '99' }, { name: 'Tele2', mcc: '250', mnc: '20' }],
    'Japan': [{ name: 'NTT Docomo', mcc: '440', mnc: '10' }, { name: 'KDDI AU', mcc: '440', mnc: '50' }, { name: 'SoftBank', mcc: '440', mnc: '20' }, { name: 'Rakuten Mobile', mcc: '440', mnc: '11' }],
    'South Korea': [{ name: 'SK Telecom', mcc: '450', mnc: '05' }, { name: 'KT', mcc: '450', mnc: '08' }, { name: 'LG U+', mcc: '450', mnc: '06' }],
    'Afghanistan': [{ name: 'Afghan Wireless', mcc: '412', mnc: '01' }, { name: 'Roshan', mcc: '412', mnc: '20' }, { name: 'Etisalat Afghanistan', mcc: '412', mnc: '50' }, { name: 'MTN Afghanistan', mcc: '412', mnc: '40' }],
    'Albania': [{ name: 'Vodafone Albania', mcc: '276', mnc: '02' }, { name: 'One Telecommunications', mcc: '276', mnc: '01' }, { name: 'ALBtelecom', mcc: '276', mnc: '03' }],
    'Algeria': [{ name: 'Djezzy', mcc: '603', mnc: '02' }, { name: 'Mobilis', mcc: '603', mnc: '01' }, { name: 'Ooredoo Algeria', mcc: '603', mnc: '03' }],
    'Argentina': [{ name: 'Movistar', mcc: '722', mnc: '07' }, { name: 'Claro', mcc: '722', mnc: '310' }, { name: 'Personal', mcc: '722', mnc: '34' }],
    'Armenia': [{ name: 'Viva-MTS', mcc: '283', mnc: '01' }, { name: 'Beeline Armenia', mcc: '283', mnc: '04' }, { name: 'Ucom', mcc: '283', mnc: '05' }],
    'Austria': [{ name: 'A1 Telekom', mcc: '232', mnc: '01' }, { name: 'Magenta Telekom', mcc: '232', mnc: '03' }, { name: 'Drei', mcc: '232', mnc: '05' }],
    'Azerbaijan': [{ name: 'Azercell', mcc: '400', mnc: '01' }, { name: 'Bakcell', mcc: '400', mnc: '02' }, { name: 'Nar Mobile', mcc: '400', mnc: '04' }],
    'Belarus': [{ name: 'MTS Belarus', mcc: '257', mnc: '02' }, { name: 'A1 Belarus', mcc: '257', mnc: '01' }, { name: 'life:)', mcc: '257', mnc: '04' }],
    'Belgium': [{ name: 'Proximus', mcc: '206', mnc: '01' }, { name: 'Orange Belgium', mcc: '206', mnc: '10' }, { name: 'Telenet/Base', mcc: '206', mnc: '20' }],
    'Bolivia': [{ name: 'Entel Bolivia', mcc: '736', mnc: '01' }, { name: 'Tigo Bolivia', mcc: '736', mnc: '02' }, { name: 'Viva Bolivia', mcc: '736', mnc: '03' }],
    'Bosnia and Herzegovina': [{ name: 'BH Telecom', mcc: '218', mnc: '90' }, { name: 'HT Eronet', mcc: '218', mnc: '03' }, { name: 'm:tel', mcc: '218', mnc: '05' }],
    'Botswana': [{ name: 'Mascom', mcc: '652', mnc: '01' }, { name: 'Orange Botswana', mcc: '652', mnc: '02' }, { name: 'BTC Mobile', mcc: '652', mnc: '04' }],
    'Chile': [{ name: 'Entel Chile', mcc: '730', mnc: '01' }, { name: 'Movistar Chile', mcc: '730', mnc: '02' }, { name: 'Claro Chile', mcc: '730', mnc: '03' }],
    'Colombia': [{ name: 'Claro Colombia', mcc: '732', mnc: '101' }, { name: 'Movistar Colombia', mcc: '732', mnc: '123' }, { name: 'Tigo Colombia', mcc: '732', mnc: '103' }],
    'Costa Rica': [{ name: 'Kolbi ICE', mcc: '712', mnc: '01' }, { name: 'Claro Costa Rica', mcc: '712', mnc: '03' }, { name: 'Movistar Costa Rica', mcc: '712', mnc: '04' }],
    'Croatia': [{ name: 'Hrvatski Telekom', mcc: '219', mnc: '01' }, { name: 'A1 Croatia', mcc: '219', mnc: '10' }, { name: 'Telemach', mcc: '219', mnc: '02' }],
    'Czechia': [{ name: 'T-Mobile CZ', mcc: '230', mnc: '01' }, { name: 'O2 Czech Republic', mcc: '230', mnc: '02' }, { name: 'Vodafone CZ', mcc: '230', mnc: '03' }],
    'Denmark': [{ name: 'TDC', mcc: '238', mnc: '01' }, { name: 'Telenor Denmark', mcc: '238', mnc: '02' }, { name: 'Telia Denmark', mcc: '238', mnc: '20' }],
    'Dominican Republic': [{ name: 'Claro DR', mcc: '370', mnc: '02' }, { name: 'Altice', mcc: '370', mnc: '01' }, { name: 'Viva', mcc: '370', mnc: '04' }],
    'Ecuador': [{ name: 'Claro Ecuador', mcc: '740', mnc: '01' }, { name: 'Movistar Ecuador', mcc: '740', mnc: '00' }, { name: 'CNT', mcc: '740', mnc: '02' }],
    'El Salvador': [{ name: 'Claro El Salvador', mcc: '706', mnc: '01' }, { name: 'Tigo El Salvador', mcc: '706', mnc: '02' }, { name: 'Movistar El Salvador', mcc: '706', mnc: '04' }],
    'Guatemala': [{ name: 'Tigo Guatemala', mcc: '704', mnc: '01' }, { name: 'Claro Guatemala', mcc: '704', mnc: '02' }, { name: 'Movistar Guatemala', mcc: '704', mnc: '03' }],
    'Honduras': [{ name: 'Tigo Honduras', mcc: '708', mnc: '01' }, { name: 'Claro Honduras', mcc: '708', mnc: '02' }],
    'Jordan': [{ name: 'Zain Jordan', mcc: '416', mnc: '01' }, { name: 'Orange Jordan', mcc: '416', mnc: '77' }, { name: 'Umniah', mcc: '416', mnc: '03' }],
    'Lebanon': [{ name: 'Touch', mcc: '415', mnc: '03' }, { name: 'Alfa', mcc: '415', mnc: '01' }],
    'Mali': [{ name: 'Orange Mali', mcc: '610', mnc: '02' }, { name: 'Malitel', mcc: '610', mnc: '01' }, { name: 'Telecel Mali', mcc: '610', mnc: '03' }],
    'Nicaragua': [{ name: 'Claro Nicaragua', mcc: '710', mnc: '21' }, { name: 'Tigo Nicaragua', mcc: '710', mnc: '73' }],
    'Oman': [{ name: 'Ooredoo Oman', mcc: '422', mnc: '02' }, { name: 'Omantel', mcc: '422', mnc: '03' }],
    'Panama': [{ name: 'Claro Panama', mcc: '714', mnc: '03' }, { name: 'Digicel Panama', mcc: '714', mnc: '04' }, { name: 'Movistar Panama', mcc: '714', mnc: '02' }],
    'Paraguay': [{ name: 'Tigo Paraguay', mcc: '744', mnc: '04' }, { name: 'Claro Paraguay', mcc: '744', mnc: '02' }, { name: 'Personal Paraguay', mcc: '744', mnc: '01' }],
    'Qatar': [{ name: 'Ooredoo Qatar', mcc: '427', mnc: '01' }, { name: 'Vodafone Qatar', mcc: '427', mnc: '02' }],
    'Senegal': [{ name: 'Orange Senegal', mcc: '608', mnc: '01' }, { name: 'Free Senegal', mcc: '608', mnc: '02' }, { name: 'Expresso Senegal', mcc: '608', mnc: '03' }],
    'Sudan': [{ name: 'Zain Sudan', mcc: '634', mnc: '01' }, { name: 'MTN Sudan', mcc: '634', mnc: '02' }, { name: 'Sudani', mcc: '634', mnc: '07' }],
    'Tanzania': [{ name: 'Vodacom Tanzania', mcc: '640', mnc: '04' }, { name: 'Airtel Tanzania', mcc: '640', mnc: '03' }, { name: 'Tigo Tanzania', mcc: '640', mnc: '02' }, { name: 'Halotel', mcc: '640', mnc: '08' }],
    'Uganda': [{ name: 'MTN Uganda', mcc: '641', mnc: '10' }, { name: 'Airtel Uganda', mcc: '641', mnc: '14' }],
    'Uzbekistan': [{ name: 'Ucell', mcc: '434', mnc: '05' }, { name: 'Beeline UZ', mcc: '434', mnc: '04' }, { name: 'Uzmobile', mcc: '434', mnc: '01' }],
    'Yemen': [{ name: 'Yemen Mobile', mcc: '421', mnc: '02' }, { name: 'Sabafon', mcc: '421', mnc: '01' }, { name: 'MTN Yemen', mcc: '421', mnc: '03' }],
    'Zambia': [{ name: 'MTN Zambia', mcc: '645', mnc: '01' }, { name: 'Airtel Zambia', mcc: '645', mnc: '02' }, { name: 'Zamtel', mcc: '645', mnc: '03' }],
    'Zimbabwe': [{ name: 'Econet Zimbabwe', mcc: '648', mnc: '04' }, { name: 'NetOne', mcc: '648', mnc: '01' }, { name: 'Telecel Zimbabwe', mcc: '648', mnc: '03' }]
};

function getRandomCarrier(iso) {
    const isoMap = {
        'BD': 'Bangladesh', 'MM': 'Myanmar', 'IN': 'India', 'PK': 'Pakistan', 'US': 'United States',
        'GB': 'United Kingdom', 'DE': 'Germany', 'FR': 'France', 'AE': 'UAE', 'SA': 'Saudi Arabia',
        'ID': 'Indonesia', 'PH': 'Philippines', 'TH': 'Thailand', 'MY': 'Malaysia', 'SG': 'Singapore',
        'AU': 'Australia', 'CA': 'Canada', 'BR': 'Brazil', 'ZA': 'South Africa', 'NG': 'Nigeria',
        'EG': 'Egypt', 'TR': 'Turkey', 'RU': 'Russia', 'JP': 'Japan', 'KR': 'South Korea', 'AF': 'Afghanistan',
        'AL': 'Albania', 'DZ': 'Algeria', 'AR': 'Argentina', 'AM': 'Armenia', 'AT': 'Austria', 'AZ': 'Azerbaijan',
        'BY': 'Belarus', 'BE': 'Belgium', 'BO': 'Bolivia', 'BA': 'Bosnia and Herzegovina', 'BW': 'Botswana',
        'CL': 'Chile', 'CO': 'Colombia', 'CR': 'Costa Rica', 'HR': 'Croatia', 'CZ': 'Czechia', 'DK': 'Denmark',
        'DO': 'Dominican Republic', 'EC': 'Ecuador', 'SV': 'El Salvador', 'EE': 'Estonia', 'FI': 'Finland',
        'GH': 'Ghana', 'GR': 'Greece', 'GT': 'Guatemala', 'HU': 'Hungary', 'IS': 'Iceland', 'IE': 'Ireland',
        'IL': 'Israel', 'KZ': 'Kazakhstan', 'KE': 'Kenya', 'KW': 'Kuwait', 'LV': 'Latvia', 'LT': 'Lithuania',
        'LU': 'Luxembourg', 'MA': 'Morocco', 'NP': 'Nepal', 'NZ': 'New Zealand', 'NO': 'Norway', 'PE': 'Peru',
        'PL': 'Poland', 'PT': 'Portugal', 'RO': 'Romania', 'RS': 'Serbia', 'SK': 'Slovakia', 'SI': 'Slovenia',
        'LK': 'Sri Lanka', 'SE': 'Sweden', 'CH': 'Switzerland', 'TN': 'Tunisia', 'UA': 'Ukraine', 'UY': 'Uruguay',
        'VE': 'Venezuela', 'VN': 'Vietnam'
    };
    const cName = isoMap[iso] || 'United States';
    const list = CARRIERS_BY_COUNTRY[cName] || CARRIERS_BY_COUNTRY['United States'];
    if (!list || list.length === 0) return { name: 'AT&T', mcc: '310', mnc: '410' };
    return list[Math.floor(Math.random() * list.length)];
}

function rotateSessionId(proxy) {
    if (!proxy || !proxy.user) return proxy;
    const rotated = { ...proxy };
    // Rotate common residential proxy session keys
    if (rotated.user.includes('-ssid-')) {
        const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
        rotated.user = rotated.user.replace(/-ssid-[A-Za-z0-9_]+/, `-ssid-${newId}`);
    } else if (rotated.user.includes('-session-')) {
        const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
        rotated.user = rotated.user.replace(/-session-[A-Za-z0-9_]+/, `-session-${newId}`);
    } else if (rotated.user.includes('-sess-')) {
        const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
        rotated.user = rotated.user.replace(/-sess-[A-Za-z0-9_]+/, `-sess-${newId}`);
    } else if (rotated.user.includes('_session_')) {
        const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
        rotated.user = rotated.user.replace(/_session_[A-Za-z0-9_]+/, `_session_${newId}`);
    } else if (/_sid_/i.test(rotated.user)) {
        const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
        rotated.user = rotated.user.replace(/_sid_[A-Za-z0-9]+/i, `_sid_${newId}`);
    }
    return rotated;
}

const agentCache = new Map();
function createProxyAgent(proxy) {
    if (!proxy) return null;
    const p = typeof proxy === 'string' ? parseProxy(proxy) : proxy;
    if (!p) return null;
    const isSocks = p.type === 'socks5' || p.type === 'socks4';
    const proxyUrl = isSocks
        ? `socks5://${p.user ? encodeURIComponent(p.user) + ':' + encodeURIComponent(p.pass || '') + '@' : ''}${p.host}:${p.port}`
        : `http://${p.user ? encodeURIComponent(p.user) + ':' + encodeURIComponent(p.pass || '') + '@' : ''}${p.host}:${p.port}`;

    if (agentCache.has(proxyUrl)) {
        return agentCache.get(proxyUrl);
    }
    const agent = isSocks
        ? new SocksProxyAgent(proxyUrl, { keepAlive: true, maxSockets: 500, timeout: 8000 })
        : new HttpsProxyAgent(proxyUrl, { keepAlive: true, maxSockets: 500, timeout: 8000 });

    if (agentCache.size > 2000) agentCache.clear();
    agentCache.set(proxyUrl, agent);
    return agent;
}


// ── 6. HTTP Wrapper ────────────────────────────────────────────
function sendRequest(urlStr, method, headers, postData, proxyStr = null, timeout = 30000, opts = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        let localHeaders = { ...headers };
        // Always request compressed responses to save proxy bandwidth
        if (!localHeaders['Accept-Encoding']) {
            localHeaders['Accept-Encoding'] = 'gzip, deflate, br';
        }
        if (postData) {
            localHeaders['Content-Length'] = Buffer.byteLength(postData);
        }
        const reqOpts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: method,
            headers: localHeaders,
            // NOTE: do NOT put timeout here — Node.js fires "socket was not created before Xms"
            // when using HttpsProxyAgent/SocksProxyAgent because the socket isn't assigned until
            // AFTER the full proxy CONNECT + TLS handshake. Use a manual timer below instead.
            ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256",
            secureOptions: require('crypto').constants.SSL_OP_NO_SSLv3 | require('crypto').constants.SSL_OP_NO_TLSv1 | require('crypto').constants.SSL_OP_NO_TLSv1_1
        };

        let proxy = null;
        if (proxyStr) {
            proxy = typeof proxyStr === 'object' ? proxyStr : parseProxy(proxyStr);
            if (!proxy || isNaN(proxy.port) || proxy.port <= 0) return reject(new Error('FATAL: Invalid proxy. Aborting to prevent IP leak.'));
            reqOpts.agent = createProxyAgent(proxy);
        }

        const req = https.request(reqOpts, res => {
            const chunks = [];
            let totalBytes = 0;
            const maxBytes = opts.maxBytes || 0; // 0 = unlimited
            let aborted = false;

            res.on('data', c => {
                chunks.push(c);
                totalBytes += c.length;
                // Early abort: stop downloading after we have enough data (saves bandwidth)
                if (maxBytes > 0 && totalBytes >= maxBytes && !aborted) {
                    aborted = true;
                    res.destroy();
                }
            });
            res.on('error', (err) => {
                // If we aborted on purpose, treat as success with partial data
                if (aborted) return finalize();
                reject(err);
            });

            const finalize = () => {
                clearTimeout(reqTimer); // ← clear here (final state: response received)
                let body = Buffer.concat(chunks);
                const enc = res.headers['content-encoding'];
                if (enc === 'gzip') { try { body = zlib.gunzipSync(body); } catch (_) { } }
                else if (enc === 'deflate') { try { body = zlib.inflateSync(body); } catch (_) { } }
                else if (enc === 'br') { try { body = zlib.brotliDecompressSync(body); } catch (_) { } }
                const setCookie = res.headers['set-cookie'] || [];
                resolve({ status: res.statusCode, data: body.toString('utf8'), headers: res.headers, cookies: setCookie });
            };

            res.on('end', finalize);
        });

        req.on('error', (err) => {
            clearTimeout(reqTimer);
            // Normalise Node.js "socket was not created" noise into a readable message
            if (err && err.message && err.message.includes('socket') && err.message.includes('not created')) {
                return reject(new Error('proxy connect timeout'));
            }
            reject(err);
        });
        // NOTE: req.on('timeout') intentionally removed — timeout is not set in reqOpts
        // so that event never fires. We use reqTimer below instead.

        // Manual overall timeout — fires if request never resolves/rejects
        // NOT cleared on 'close' (close fires prematurely with HttpsProxyAgent during CONNECT)
        // Cleared only in finalize() or error handler above (both are true final states)
        const reqTimer = setTimeout(() => {
            req.destroy(new Error('request timeout'));
        }, timeout);
        // ← NO req.on('close') here — that was the bug (cleared timer too early)

        // Hard connect-timeout: fires if the proxy socket never establishes within 10s
        // Catches dead proxies that silently drop TCP SYN packets (no RST, no response)
        if (proxyStr) {
            req.on('socket', (socket) => {
                if (socket.connecting) {
                    const connectTimer = setTimeout(() => {
                        req.destroy(new Error('proxy connect timeout'));
                    }, 10000);
                    socket.once('connect', () => clearTimeout(connectTimer));
                    socket.once('error', () => clearTimeout(connectTimer));
                    socket.once('close', () => clearTimeout(connectTimer));
                }
            });
        }

        if (postData) req.write(postData);
        req.end();
    });
}

// ── Instagram Web Password Encryption (AES-256-GCM + RSA-OAEP) ───
function encryptPasswordWeb(password, time, publicKey, keyId = '10') {
    if (!publicKey) {
        return `#PWD_BROWSER:0:${time}:${password}`;
    }
    try {
        const timeStr = String(time);
        const timeBuf = Buffer.from(timeStr, 'utf8');
        const aesKey = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);

        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
        cipher.setAAD(timeBuf);
        const ciphertext = Buffer.concat([cipher.update(Buffer.from(password, 'utf8')), cipher.final()]);
        const tag = cipher.getAuthTag();

        let pemKey = publicKey.trim();
        if (!pemKey.includes('-----BEGIN')) {
            pemKey = `-----BEGIN PUBLIC KEY-----\n${publicKey.trim()}\n-----END PUBLIC KEY-----`;
        }

        const encryptedKey = crypto.publicEncrypt(
            {
                key: pemKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            aesKey
        );

        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16BE(encryptedKey.length, 0);

        const versionBuf = Buffer.from([1, parseInt(keyId, 10) || 10]);
        const payload = Buffer.concat([versionBuf, iv, lenBuf, encryptedKey, tag, ciphertext]);

        return `#PWD_BROWSER:${keyId}:${timeStr}:${payload.toString('base64')}`;
    } catch (_) {
        return `#PWD_BROWSER:0:${time}:${password}`;
    }
}

// ── Instagram Account Confirmation Mutation (GraphQL) ─────────────
async function confirmAccountGraphQL(params) {
    const {
        code,
        ntfContext,
        lsd,
        jazoest,
        sessionId,
        liveHs,
        liveRev,
        liveHsi,
        liveCsr,
        dynLate,
        hsdpLate,
        liveHblp,
        sjspLate,
        spinT,
        client,
        acceptLang,
        cookieMap,
        proxy,
        timeout
    } = params;

    const confVariables = {
        "input": {
            "actor_id": "0",
            "client_mutation_id": uuid(),
            "conf_code": { "sensitive_string_value": String(code).trim() },
            "ig_reg_data": ntfContext || null,
            "machine_id": cookieMap['mid'] || '',
            "sk_pipa_consent_given": null,
            "youth_consent_decision_time": null
        }
    };

    const confBody = new URLSearchParams({
        'av': '0',
        '__d': 'www',
        '__user': '0',
        '__a': '1',
        '__req': '13',
        '__hs': liveHs,
        'dpr': '1',
        '__ccg': 'GOOD',
        '__rev': liveRev,
        '__s': sessionId,
        '__hsi': liveHsi,
        '__dyn': dynLate,
        '__csr': liveCsr,
        '__hsdp': hsdpLate,
        '__hblp': liveHblp,
        '__sjsp': sjspLate,
        '__comet_req': '7',
        'lsd': lsd,
        'jazoest': jazoest,
        '__spin_r': liveRev,
        '__spin_b': 'trunk',
        '__spin_t': spinT,
        '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
        'qpl_active_flow_ids': '250360002,516759801',
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'useCAAFBConfirmationFormSubmitMutation',
        'server_timestamps': 'true',
        'variables': JSON.stringify(confVariables),
        'doc_id': '24050931851170558',
        'fb_api_analytics_tags': '["qpl_active_flow_ids=250360002,516759801"]'
    }).toString();

    const isFirefox = client.userAgent.includes('Firefox');
    const headers = isFirefox ? {
        'User-Agent': client.userAgent,
        'Accept': '*/*',
        'Accept-Language': acceptLang,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-FB-Friendly-Name': 'useCAAFBConfirmationFormSubmitMutation',
        'X-CSRFToken': cookieMap['csrftoken'] || '',
        'X-IG-App-ID': client.igAppId || '936619743392459',
        'X-IG-Max-Touch-Points': '0',
        'X-FB-LSD': lsd,
        'X-ASBD-ID': '359341',
        'Origin': 'https://www.instagram.com',
        'Alt-Used': 'www.instagram.com',
        'Connection': 'keep-alive',
        'Referer': 'https://www.instagram.com/accounts/emailsignup/',
        'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'TE': 'trailers'
    } : {
        'User-Agent': client.userAgent,
        'Accept': '*/*',
        'Accept-Language': acceptLang,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.instagram.com',
        'Referer': 'https://www.instagram.com/accounts/emailsignup/',
        'priority': 'u=1, i',
        'sec-ch-prefers-color-scheme': 'dark',
        'x-asbd-id': '359341',
        'x-csrftoken': cookieMap['csrftoken'] || '',
        'x-fb-lsd': lsd,
        'x-fb-friendly-name': 'useCAAFBConfirmationFormSubmitMutation',
        'x-ig-app-id': client.igAppId || '936619743392459',
        'x-ig-max-touch-points': '0',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
        ...client.clientHints
    };

    // debugLog(code, 'conf-req', { confVariables, doc_id: '24050931851170558' });
    const res = await sendRequest('https://www.instagram.com/api/graphql', 'POST', headers, confBody, proxy, timeout);
    // debugLog(code, 'conf-res', res.data);

    if (res.cookies && Array.isArray(res.cookies)) {
        res.cookies.forEach(c => {
            const [k, v] = c.split(';')[0].split('=');
            if (k && v) cookieMap[k.trim()] = v.trim();
        });
    }
    const cookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

    try {
        const parsed = JSON.parse(res.data);
        const submit = parsed?.data?.xfb_caa_registration_confirmation_submit;
        if (submit && (submit.user_id || submit.created_user_id)) {
            return {
                success: true,
                userId: submit.user_id || submit.created_user_id,
                username: submit.username,
                nonce: submit.nonce,
                cookieString
            };
        }
        if (parsed.errors && parsed.errors.length > 0) {
            return { success: false, error: parsed.errors[0].message };
        }
    } catch (_) { }

    if (res.data.includes('user_id') || res.data.includes('created_user_id') || res.data.includes('confirmation_success')) {
        return { success: true, userId: 'confirmed', username: '', cookieString };
    }

    return { success: false, error: 'Confirmation failed (invalid code or session expired)' };
}

// ── 6.5. Two-Factor Authentication (2FA / TOTP) ──────────────────
function base32Decode(secret) {
    const b32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = '';
    for (let i = 0; i < clean.length; i++) {
        const val = b32chars.indexOf(clean[i]);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }
    return Buffer.from(bytes);
}

function generateTOTP(secret, timeStepSec = 30, digits = 6) {
    const key = base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / timeStepSec);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24 |
        (hmac[offset + 1] & 0xff) << 16 |
        (hmac[offset + 2] & 0xff) << 8 |
        (hmac[offset + 3] & 0xff)) % (10 ** digits);
    return code.toString().padStart(digits, '0');
}

async function enableTwoFactorAuth(params) {
    const {
        userId,
        cookieMap,
        client,
        acceptLang,
        sessionId,
        liveHs,
        liveRev,
        liveHsi,
        liveCsr,
        dynLate,
        hsdpLate,
        liveHblp,
        sjspLate,
        proxy,
        timeout = 25000,
        onStatus = () => { }
    } = params;

    try {
        if (!cookieMap['ps_l']) cookieMap['ps_l'] = '1';
        if (!cookieMap['ps_n']) cookieMap['ps_n'] = '1';
        let cookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

        onStatus('🔑 [2FA] Checking 2FA TOTP configuration...');

        // ── Strategy 1: Direct Instagram Web REST API (Fast & Reliable) ──
        try {
            const restHeaders = {
                'User-Agent': client.userAgent,
                'Accept': '*/*',
                'Accept-Language': acceptLang,
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRFToken': cookieMap['csrftoken'] || '',
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': 'https://www.instagram.com',
                'Referer': 'https://www.instagram.com/accounts/two_factor/',
                'Cookie': cookieString,
                ...client.clientHints
            };

            const restBody = new URLSearchParams({
                'device_id': cookieMap['ig_did'] || uuid()
            }).toString();

            const restRes = await sendRequest(
                'https://www.instagram.com/api/v1/accounts/two_factor/get_totp_key/',
                'POST',
                restHeaders,
                restBody,
                proxy,
                15000
            ).catch(() => null);

            let restKey = '';
            if (restRes && restRes.data) {
                try {
                    const parsed = JSON.parse(restRes.data);
                    if (parsed.totp_key || parsed.two_factor_key || parsed.key_text) {
                        restKey = parsed.totp_key || parsed.two_factor_key || parsed.key_text;
                    }
                } catch (_) { }
                if (!restKey) {
                    const km = restRes.data.match(/"(?:totp_key|two_factor_key|key_text)":\s*"([^"]+)"/);
                    if (km) restKey = km[1];
                }
            }

            if (restKey) {
                const cleanRestKey = restKey.replace(/\s+/g, '').toUpperCase();
                const restCode = generateTOTP(cleanRestKey);
                onStatus(`🔑 [2FA] Submitting code ${restCode}...`);

                const confirmBody = new URLSearchParams({
                    'verification_code': String(restCode),
                    'device_id': cookieMap['ig_did'] || uuid()
                }).toString();

                const confirmRes = await sendRequest(
                    'https://www.instagram.com/api/v1/accounts/two_factor/enable_totp/',
                    'POST',
                    restHeaders,
                    confirmBody,
                    proxy,
                    15000
                ).catch(() => null);

                if (confirmRes && (confirmRes.data.includes('"status":"ok"') || confirmRes.data.includes('backup_codes') || confirmRes.data.includes('"success":true'))) {
                    if (confirmRes.cookies && Array.isArray(confirmRes.cookies)) {
                        confirmRes.cookies.forEach(c => {
                            const [k, v] = c.split(';')[0].split('=');
                            if (k && v) cookieMap[k.trim()] = v.trim();
                        });
                    }
                    const finalCookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
                    onStatus('🔒 [2FA] Two-Factor Authentication enabled successfully!');
                    return {
                        success: true,
                        twoFaKey: cleanRestKey,
                        cookieString: finalCookieString
                    };
                }
            }
        } catch (_) { }

        // ── Strategy 2: Meta Accounts Center GraphQL ──
        onStatus('🔑 [2FA] Navigating to Accounts Center...');

        const editRes = await sendRequest(
            'https://www.instagram.com/accounts/edit/',
            'GET',
            {
                'User-Agent': client.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': acceptLang,
                'Accept-Encoding': 'gzip, deflate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Dest': 'document',
                'Cookie': cookieString,
                ...client.clientHints
            },
            null,
            proxy,
            timeout
        ).catch(() => null);

        if (editRes && editRes.cookies && Array.isArray(editRes.cookies)) {
            editRes.cookies.forEach(c => {
                const [k, v] = c.split(';')[0].split('=');
                if (k && v) cookieMap[k.trim()] = v.trim();
            });
            cookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
        }

        const acRes = await sendRequest(
            'https://accountscenter.instagram.com/?theme=dark&entry_point=app_settings',
            'GET',
            {
                'User-Agent': client.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': acceptLang,
                'Accept-Encoding': 'gzip, deflate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Dest': 'document',
                'Cookie': cookieString,
                ...client.clientHints
            },
            null,
            proxy,
            timeout
        ).catch(() => null);

        if (acRes && acRes.cookies && Array.isArray(acRes.cookies)) {
            acRes.cookies.forEach(c => {
                const [k, v] = c.split(';')[0].split('=');
                if (k && v) cookieMap[k.trim()] = v.trim();
            });
            cookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
        }

        const htmlData = (acRes?.data || '') + (editRes?.data || '');
        const dtsgM = htmlData.match(/"DTSGInitialData",\[\],{"token":"([^"]+)"/) ||
            htmlData.match(/"DTSG_ASYNC",\[\],{"token":"([^"]+)"/) ||
            htmlData.match(/"DTSGInitData",\[\],{"token":"([^"]+)"/) ||
            htmlData.match(/"token":"(NA[a-zA-Z0-9_\-:]+|Ad[a-zA-Z0-9_\-:]+)"/) ||
            htmlData.match(/"f":"(NA[a-zA-Z0-9_\-:]+|Ad[a-zA-Z0-9_\-:]+)"/) ||
            htmlData.match(/name="fb_dtsg"\s+value="([^"]+)"/) ||
            htmlData.match(/fb_dtsg_ag=([a-zA-Z0-9_\-:]+)/) ||
            htmlData.match(/fb_dtsg=([a-zA-Z0-9_\-:]+)/) ||
            htmlData.match(/"dtsg":{"token":"([^"]+)"/);
        const fbDtsg = dtsgM ? dtsgM[1] : '';

        const lsdM = htmlData.match(/"LSD",\[\],{"token":"([^"]+)"/) ||
            htmlData.match(/"lsd":"([^"]+)"/) ||
            htmlData.match(/name="lsd"\s+value="([^"]+)"/);
        const lsd = lsdM ? lsdM[1] : (cookieMap['csrftoken'] || '');

        const acHsM = htmlData.match(/"haste_session":"([^"]+)"/) || htmlData.match(/"hs":"([^"]+)"/);
        const acHs = acHsM ? acHsM[1] : (liveHs || '20684.HYP:accounts_center_pkg.2.1...0');

        const acRevM = htmlData.match(/"client_revision":(\d+)/) || htmlData.match(/"rev":(\d+)/) || htmlData.match(/"__spin_r":(\d+)/);
        const acRev = acRevM ? acRevM[1] : (liveRev || '1045542031');

        const acHsiM = htmlData.match(/"hsi":"(\d+)"/) || htmlData.match(/"brsid":"(\d+)"/);
        const acHsi = acHsiM ? acHsiM[1] : (liveHsi || String(Date.now()));

        const acSM = htmlData.match(/"webSessionId":"([^"]+)"/) || htmlData.match(/"s":"([^"]+)"/);
        const acS = acSM ? acSM[1] : sessionId;

        const jazoest = fbDtsg ? ('2' + [...fbDtsg].reduce((a, c) => a + c.charCodeAt(0), 0)) : (cookieMap['csrftoken'] ? String(2 + [...cookieMap['csrftoken']].reduce((a, c) => a + c.charCodeAt(0), 0)) : '26173');

        // Extract Meta FX account ID from rur, fb_dtsg, HTML, or fallback
        let accountId = '';
        if (cookieMap['rur']) {
            const rurDecoded = decodeURIComponent(cookieMap['rur']).replace(/\\054/g, ',');
            const m = rurDecoded.match(/,(\d{15,}),/) || rurDecoded.match(/(\d{15,})/) || rurDecoded.match(/^[A-Z_]+,(\d+),/);
            if (m) accountId = m[1];
        }
        if (!accountId && fbDtsg && fbDtsg.includes(':')) {
            const parts = fbDtsg.split(':');
            if (parts.length >= 2 && parts[1] && parts[1].length >= 10) {
                accountId = parts[1];
            }
        }
        if (!accountId && htmlData) {
            const actM = htmlData.match(/"qeid":"(\d{15,})"/) ||
                htmlData.match(/"user":"(\d{15,})"/) ||
                htmlData.match(/"ACCOUNT_ID":"(\d+)"/) ||
                htmlData.match(/"actorID":"(\d+)"/) ||
                htmlData.match(/"USER_ID":"(\d+)"/) ||
                htmlData.match(/"account_id":"(\d+)"/) ||
                htmlData.match(/"target_account_id":"(\d+)"/) ||
                htmlData.match(/"viewer_id":"(\d+)"/) ||
                htmlData.match(/"id":"(\d{15,})"/);
            if (actM) accountId = actM[1];
        }
        if (!accountId) {
            accountId = userId || cookieMap['ds_user_id'] || '';
        }

        if (!accountId) {
            debugLog(userId, '2fa-error', 'No accountId found for 2FA');
            return { success: false, error: 'No accountId found for 2FA' };
        }

        onStatus('🔑 [2FA] Generating TOTP key via Accounts Center...');

        const genMutationId = uuid();
        const genTotpVariables = {
            "input": {
                "actor_id": accountId,
                "client_mutation_id": genMutationId,
                "account_id": accountId,
                "account_type": "INSTAGRAM",
                "device_id": "device_id_fetch_ig_did",
                "fdid": "device_id_fetch_ig_did"
            }
        };

        const genTotpBody = new URLSearchParams({
            'av': accountId,
            '__user': '0',
            '__a': '1',
            '__req': 'y',
            '__hs': acHs,
            'dpr': '1',
            '__ccg': 'MODERATE',
            '__rev': acRev,
            '__s': acS,
            '__hsi': acHsi,
            '__dyn': dynLate || '',
            '__csr': liveCsr || '',
            '__hsdp': hsdpLate || '',
            '__hblp': liveHblp || '',
            '__sjsp': sjspLate || '',
            '__comet_req': '24',
            'fb_dtsg': fbDtsg,
            'jazoest': jazoest,
            'lsd': lsd,
            '__spin_r': acRev,
            '__spin_b': 'trunk',
            '__spin_t': String(Math.floor(Date.now() / 1000)),
            'qpl_active_flow_ids': '241970459',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useFXSettingsTwoFactorGenerateTOTPKeyMutation',
            'server_timestamps': 'true',
            'variables': JSON.stringify(genTotpVariables),
            'doc_id': '9837172312995248',
            'fb_api_analytics_tags': '["qpl_active_flow_ids=241970459"]'
        }).toString();

        const headers = {
            'User-Agent': client.userAgent,
            'Accept': '*/*',
            'Accept-Language': acceptLang,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://accountscenter.instagram.com',
            'Referer': 'https://accountscenter.instagram.com/password_and_security/two_factor/?theme=dark',
            'priority': 'u=1, i',
            'sec-ch-prefers-color-scheme': 'dark',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            'x-asbd-id': '359341',
            'x-fb-friendly-name': 'useFXSettingsTwoFactorGenerateTOTPKeyMutation',
            'x-fb-lsd': lsd,
            'x-ig-app-id': '936619743392459',
            'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
            ...client.clientHints
        };

        debugLog(accountId, '2fa-gen-req', { genTotpVariables, doc_id: '9837172312995248' });
        let genRes = await sendRequest('https://accountscenter.instagram.com/api/graphql/', 'POST', headers, genTotpBody, proxy, timeout);
        debugLog(accountId, '2fa-gen-res', genRes.data);

        if (!genRes.data || !genRes.data.includes('totp_key')) {
            headers['Origin'] = 'https://www.instagram.com';
            genRes = await sendRequest('https://www.instagram.com/api/graphql', 'POST', headers, genTotpBody, proxy, timeout);
            debugLog(accountId, '2fa-gen-res-fallback', genRes.data);
        }

        if (genRes.cookies && Array.isArray(genRes.cookies)) {
            genRes.cookies.forEach(c => {
                const [k, v] = c.split(';')[0].split('=');
                if (k && v) cookieMap[k.trim()] = v.trim();
            });
        }

        let rawKey = '';
        try {
            const parsedGen = JSON.parse(genRes.data);
            const genData = parsedGen?.data?.xfb_two_factor_generate_totp_key;
            if (genData?.success && genData?.totp_key?.key_text) {
                rawKey = genData.totp_key.key_text;
            }
        } catch (_) { }

        if (!rawKey) {
            const keyM = genRes.data.match(/"key_text":\s*"([^"]+)"/);
            if (keyM) rawKey = keyM[1];
        }

        if (!rawKey) {
            return { success: false, error: 'Failed to generate 2FA key' };
        }

        const cleanKey = rawKey.replace(/\s+/g, '').toUpperCase();
        onStatus(`🔑 [2FA] Key received (${cleanKey.slice(0, 4)}...), generating code...`);

        const verificationCode = generateTOTP(cleanKey);
        onStatus(`🔑 [2FA] Submitting code ${verificationCode}...`);

        const enableMutationId = uuid();
        const enableTotpVariables = {
            "input": {
                "actor_id": accountId,
                "client_mutation_id": enableMutationId,
                "account_id": accountId,
                "account_type": "INSTAGRAM",
                "verification_code": String(verificationCode),
                "device_id": "device_id_fetch_ig_did",
                "fdid": "device_id_fetch_ig_did"
            }
        };

        const enableTotpBody = new URLSearchParams({
            'av': accountId,
            '__user': '0',
            '__a': '1',
            '__req': '16',
            '__hs': acHs,
            'dpr': '1',
            '__ccg': 'MODERATE',
            '__rev': acRev,
            '__s': acS,
            '__hsi': acHsi,
            '__dyn': dynLate || '',
            '__csr': liveCsr || '',
            '__hsdp': hsdpLate || '',
            '__hblp': liveHblp || '',
            '__sjsp': sjspLate || '',
            '__comet_req': '24',
            'fb_dtsg': fbDtsg,
            'jazoest': jazoest,
            'lsd': lsd,
            '__spin_r': acRev,
            '__spin_b': 'trunk',
            '__spin_t': String(Math.floor(Date.now() / 1000)),
            'qpl_active_flow_ids': '241970459',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useFXSettingsTwoFactorEnableTOTPMutation',
            'server_timestamps': 'true',
            'variables': JSON.stringify(enableTotpVariables),
            'doc_id': '29164158613231327',
            'fb_api_analytics_tags': '["qpl_active_flow_ids=241970459"]'
        }).toString();

        headers['x-fb-friendly-name'] = 'useFXSettingsTwoFactorEnableTOTPMutation';
        headers['Cookie'] = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

        debugLog(accountId, '2fa-enable-req', { enableTotpVariables, doc_id: '29164158613231327' });
        let enableRes = await sendRequest('https://accountscenter.instagram.com/api/graphql/', 'POST', headers, enableTotpBody, proxy, timeout);
        debugLog(accountId, '2fa-enable-res', enableRes.data);

        if (!enableRes.data || (!enableRes.data.includes('"success":true') && !enableRes.data.includes('FXCALSettingsMutationReturnDataSuccess'))) {
            headers['Origin'] = 'https://www.instagram.com';
            enableRes = await sendRequest('https://www.instagram.com/api/graphql', 'POST', headers, enableTotpBody, proxy, timeout);
            debugLog(accountId, '2fa-enable-res-fallback', enableRes.data);
        }

        if (enableRes.cookies && Array.isArray(enableRes.cookies)) {
            enableRes.cookies.forEach(c => {
                const [k, v] = c.split(';')[0].split('=');
                if (k && v) cookieMap[k.trim()] = v.trim();
            });
        }
        const finalCookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

        let enabled = false;
        try {
            const parsedEnable = JSON.parse(enableRes.data);
            if (parsedEnable?.data?.xfb_two_factor_enable_totp?.success === true) {
                enabled = true;
            }
        } catch (_) { }

        if (!enabled && (enableRes.data.includes('"success":true') || enableRes.data.includes('FXCALSettingsMutationReturnDataSuccess'))) {
            enabled = true;
        }

        if (enabled) {
            onStatus('🔒 [2FA] Two-Factor Authentication enabled successfully!');
            return {
                success: true,
                twoFaKey: cleanKey,
                accountId,
                cookieString: finalCookieString
            };
        } else {
            return {
                success: false,
                twoFaKey: cleanKey,
                error: 'Failed to confirm 2FA code with server'
            };
        }
    } catch (err) {
        debugLog(userId, '2fa-exception', err.message);
        return { success: false, error: err.message };
    }
}

// ── 7. Core IG API Logic ─────────────────────────────────────────
async function createAccount(contactPoint, options = {}) {
    const { onStatus = () => { }, onOtpSent = () => { }, proxy = null, timeout = 25000, workerId = 0, devicePref = 'web', browserPref = 'random', languagePref = 'en', enable2fa = false, passwordPref = 'default', customPassword = '', pollOtp = null } = options;
    const isEmail = String(contactPoint).includes('@');
    const normalizedContact = isEmail ? String(contactPoint).trim().toLowerCase() : String(contactPoint).trim().replace(/[^0-9+]/g, '');
    const isMobile = isEmail ? false : (devicePref === 'mobile' ? true : (devicePref === 'web' ? false : Math.random() > 0.5));

    onStatus(`[1/2] Fetching initial session tokens from IG...`);

    try {
        const generatedDob = generateRandomDOB();
        const generatedPassword = generateRandomPassword(passwordPref, customPassword);
        const client = getRandomClient(browserPref, isMobile);

        // Generate Accept-Language header
        let acceptLang = 'en-US,en;q=0.9';
        let langName = 'en';
        if (languagePref === 'auto') {
            const locales = [
                'af-ZA', 'sq-AL', 'ar-DZ', 'ar-BH', 'ar-EG', 'ar-IQ', 'ar-JO', 'ar-KW', 'ar-LB', 'ar-LY', 'ar-MA', 'ar-OM', 'ar-QA', 'ar-SA', 'ar-SY', 'ar-TN', 'ar-AE', 'ar-YE', 'hy-AM', 'az-AZ', 'eu-ES', 'be-BY', 'bg-BG', 'ca-ES', 'zh-HK', 'zh-MO', 'zh-CN', 'zh-SG', 'zh-TW', 'hr-HR', 'cs-CZ', 'da-DK', 'nl-BE', 'nl-NL', 'en-AU', 'en-BZ', 'en-CA', 'en-IE', 'en-JM', 'en-NZ', 'en-PH', 'en-ZA', 'en-TT', 'en-GB', 'en-US', 'en-ZW', 'et-EE', 'fo-FO', 'fa-IR', 'fi-FI', 'fr-BE', 'fr-CA', 'fr-FR', 'fr-LU', 'fr-MC', 'fr-CH', 'gl-ES', 'ka-GE', 'de-AT', 'de-DE', 'de-LI', 'de-LU', 'de-CH', 'el-GR', 'gu-IN', 'he-IL', 'hi-IN', 'hu-HU', 'is-IS', 'id-ID', 'it-IT', 'it-CH', 'ja-JP', 'kn-IN', 'kk-KZ', 'kok-IN', 'ko-KR', 'ky-KG', 'lv-LV', 'lt-LT', 'mk-MK', 'ms-BN', 'ms-MY', 'mr-IN', 'mn-MN', 'no-NO', 'pl-PL', 'pt-BR', 'pt-PT', 'pa-IN', 'ro-RO', 'ru-RU', 'sa-IN', 'sr-RS', 'sk-SK', 'sl-SI', 'es-AR', 'es-BO', 'es-CL', 'es-CO', 'es-CR', 'es-DO', 'es-EC', 'es-SV', 'es-GT', 'es-HN', 'es-MX', 'es-NI', 'es-PA', 'es-PY', 'es-PE', 'es-PR', 'es-ES', 'es-UY', 'es-VE', 'sw-KE', 'sv-FI', 'sv-SE', 'sy-SY', 'ta-IN', 'tt-RU', 'te-IN', 'th-TH', 'tr-TR', 'uk-UA', 'ur-PK', 'uz-UZ', 'vi-VN'
            ];

            if (isEmail) {
                langName = locales[Math.floor(Math.random() * locales.length)];
            } else {
                const countryLocales = {
                    '1': 'en-US', '1242': 'en-BS', '1246': 'en-BB', '1264': 'en-AI', '1268': 'en-AG', '1284': 'en-VG',
                    '1340': 'en-VI', '1345': 'en-KY', '1441': 'en-BM', '1473': 'en-GD', '1649': 'en-TC', '1664': 'en-MS',
                    '1671': 'en-GU', '1684': 'en-AS', '1721': 'en-SX', '1758': 'en-LC', '1767': 'en-DM', '1784': 'en-VC',
                    '1868': 'en-TT', '1869': 'en-KN', '1876': 'en-JM', '1939': 'es-PR', '20': 'ar-EG', '211': 'en-SS',
                    '212': 'ar-MA', '213': 'ar-DZ', '216': 'ar-TN', '218': 'ar-LY', '220': 'en-GM', '221': 'fr-SN',
                    '222': 'ar-MR', '223': 'fr-ML', '224': 'fr-GN', '225': 'fr-CI', '226': 'fr-BF', '227': 'fr-NE',
                    '228': 'fr-TG', '229': 'fr-BJ', '230': 'en-MU', '231': 'en-LR', '232': 'en-SL', '233': 'en-GH',
                    '234': 'en-NG', '235': 'fr-TD', '236': 'fr-CF', '237': 'fr-CM', '238': 'pt-CV', '239': 'pt-ST',
                    '240': 'es-GQ', '241': 'fr-GA', '242': 'fr-CG', '243': 'fr-CD', '244': 'pt-AO', '245': 'pt-GW',
                    '246': 'en-IO', '248': 'fr-SC', '249': 'ar-SD', '250': 'rw-RW', '251': 'am-ET', '252': 'so-SO',
                    '253': 'fr-DJ', '254': 'sw-KE', '255': 'sw-TZ', '256': 'en-UG', '257': 'fr-BI', '258': 'pt-MZ',
                    '260': 'en-ZM', '261': 'mg-MG', '262': 'fr-RE', '263': 'en-ZW', '264': 'en-NA', '265': 'en-MW',
                    '266': 'st-LS', '267': 'en-BW', '268': 'en-SZ', '269': 'fr-KM', '27': 'en-ZA', '290': 'en-SH',
                    '291': 'ti-ER', '297': 'nl-AW', '298': 'fo-FO', '299': 'kl-GL', '30': 'el-GR', '31': 'nl-NL',
                    '32': 'nl-BE', '33': 'fr-FR', '34': 'es-ES', '350': 'en-GI', '351': 'pt-PT', '352': 'fr-LU',
                    '353': 'en-IE', '354': 'is-IS', '355': 'sq-AL', '356': 'en-MT', '357': 'el-CY', '358': 'fi-FI',
                    '359': 'bg-BG', '36': 'hu-HU', '370': 'lt-LT', '371': 'lv-LV', '372': 'et-EE', '373': 'ro-MD',
                    '374': 'hy-AM', '375': 'be-BY', '376': 'ca-AD', '377': 'fr-MC', '378': 'it-SM', '380': 'uk-UA',
                    '381': 'sr-RS', '382': 'sr-ME', '385': 'hr-HR', '386': 'sl-SI', '387': 'bs-BA', '389': 'mk-MK',
                    '39': 'it-IT', '40': 'ro-RO', '41': 'de-CH', '420': 'cs-CZ', '421': 'sk-SK', '423': 'de-LI',
                    '43': 'de-AT', '44': 'en-GB', '45': 'da-DK', '46': 'sv-SE', '47': 'no-NO', '48': 'pl-PL',
                    '49': 'de-DE', '500': 'en-FK', '501': 'en-BZ', '502': 'es-GT', '503': 'es-SV', '504': 'es-HN',
                    '505': 'es-NI', '506': 'es-CR', '507': 'es-PA', '508': 'fr-PM', '509': 'fr-HT', '51': 'es-PE',
                    '52': 'es-MX', '53': 'es-CU', '54': 'es-AR', '55': 'pt-BR', '56': 'es-CL', '57': 'es-CO',
                    '58': 'es-VE', '590': 'fr-GP', '591': 'es-BO', '592': 'en-GY', '593': 'es-EC', '594': 'fr-GF',
                    '595': 'es-PY', '596': 'fr-MQ', '597': 'nl-SR', '598': 'es-UY', '599': 'nl-CW', '60': 'ms-MY',
                    '61': 'en-AU', '62': 'id-ID', '63': 'en-PH', '64': 'en-NZ', '65': 'en-SG', '66': 'th-TH',
                    '670': 'pt-TL', '672': 'en-NF', '673': 'ms-BN', '674': 'en-NR', '675': 'en-PG', '676': 'en-TO',
                    '677': 'en-SB', '678': 'bi-VU', '679': 'en-FJ', '680': 'en-PW', '681': 'fr-WF', '682': 'en-CK',
                    '683': 'en-NU', '685': 'en-WS', '686': 'en-KI', '687': 'fr-NC', '688': 'en-TV', '689': 'fr-PF',
                    '690': 'en-TK', '691': 'en-FM', '692': 'en-MH', '7': 'ru-RU', '81': 'ja-JP', '82': 'ko-KR',
                    '84': 'vi-VN', '850': 'ko-KP', '852': 'zh-HK', '853': 'zh-MO', '855': 'km-KH', '856': 'lo-LA',
                    '86': 'zh-CN', '880': 'bn-BD', '886': 'zh-TW', '90': 'tr-TR', '91': 'en-IN', '92': 'ur-PK',
                    '93': 'fa-AF', '94': 'si-LK', '95': 'my-MM', '960': 'dv-MV', '961': 'ar-LB', '962': 'ar-JO',
                    '963': 'ar-SY', '964': 'ar-IQ', '965': 'ar-KW', '966': 'ar-SA', '967': 'ar-YE', '968': 'ar-OM',
                    '970': 'ar-PS', '971': 'ar-AE', '972': 'he-IL', '973': 'ar-BH', '974': 'ar-QA', '975': 'dz-BT',
                    '976': 'mn-MN', '977': 'ne-NP', '98': 'fa-IR', '992': 'tg-TJ', '993': 'tk-TM', '994': 'az-AZ',
                    '995': 'ka-GE', '996': 'ky-KG', '998': 'uz-UZ'
                };
                let cleaned = normalizedContact.replace(/\D/g, '');
                langName = 'en-US'; // Default
                for (let i = 4; i >= 1; i--) {
                    const prefix = cleaned.substring(0, i);
                    if (countryLocales[prefix]) {
                        langName = countryLocales[prefix];
                        break;
                    }
                }
            }

            const langOnly = langName.split('-')[0];
            acceptLang = `${langName},${langOnly};q=0.9,en-US;q=0.8,en;q=0.7`;

        } else if (languagePref !== 'en') {
            // Sanitize lazy user inputs like "fr=FR" or "fr-fr"
            let custom = languagePref.replace('=', '-').trim();
            if (custom.length === 5 && custom.includes('-')) {
                const parts = custom.split('-');
                const langOnly = parts[0].toLowerCase();
                const region = parts[1].toUpperCase();
                const locale = `${langOnly}-${region}`;
                acceptLang = `${locale},${langOnly};q=0.9,en-US;q=0.8,en;q=0.7`;
                langName = locale;
            } else {
                // Fallback if they provided a fully formatted custom string
                acceptLang = custom;
                langName = custom.split(',')[0];
            }
        }

        const generatedName = generateRandomName(langName);
        const username = generatedName.first.toLowerCase() + generatedName.last.toLowerCase() + Math.floor(Math.random() * 99999999);

        const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
        let numberCountryName = 'Unknown';
        try {
            const regionCode = langName.split('-')[1];
            if (regionCode) numberCountryName = regionNames.of(regionCode);
        } catch (e) { }

        const proxyHost = proxy ? proxy.host : 'Direct';

        let proxyCountryName = 'Direct';
        if (proxy && proxy.user) {
            // Match formats like: country-us, cc-us, cr.us, zone-us, region-us
            const match = proxy.user.match(/(?:country|cc|cr|zone|region)[-_.]?([a-zA-Z]{2})(?:[-_.]|$)/i) || proxy.user.match(/[-_]([a-zA-Z]{2})[-_]sess/i);
            if (match) {
                try {
                    proxyCountryName = regionNames.of(match[1].toUpperCase()) || match[1].toUpperCase();
                } catch (e) {
                    proxyCountryName = match[1].toUpperCase();
                }
            } else {
                proxyCountryName = 'Unknown';
            }
        }

        // 1. Fetch Tokens (bandwidth-optimized: gzip compression ~300KB → ~50KB)
        const isWIFI = Math.random() > 0.5;
        const carrierObj = getRandomCarrier(langName.split('-')[1] || 'US');
        const connType = isWIFI ? 'WIFI' : 'CELLULAR';
        const speed = isWIFI ? (Math.floor(Math.random() * 5000) + 2000 + 'kbps') : (Math.floor(Math.random() * 2000) + 500 + 'kbps');

        const isFirefox = client.userAgent.includes('Firefox');
        const initHeaders = {
            'User-Agent': client.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': acceptLang,
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Upgrade-Insecure-Requests': '1',
            ...(isFirefox ? {
                'Alt-Used': 'www.instagram.com',
                'Connection': 'keep-alive'
            } : {}),
            ...(isMobile ? {
                'X-IG-Connection-Type': connType,
                'X-IG-Connection-Speed': speed,
                ...(!isWIFI && { 'X-IG-Carrier': carrierObj.name })
            } : {}),
            ...client.clientHints
        };
        const initUrl = isMobile ? 'https://www.instagram.com/accounts/signup/phone/' : 'https://www.instagram.com/accounts/emailsignup/';
        const initRes = await sendRequest(initUrl, 'GET', initHeaders, null, proxy, timeout);

        let cookieMap = {};
        const updateCookies = (cookiesArr) => {
            if (!cookiesArr) return;
            cookiesArr.forEach(c => {
                const parts = c.split(';')[0].split('=');
                if (parts.length >= 2) cookieMap[parts[0].trim()] = parts.slice(1).join('=').trim();
            });
        };
        updateCookies(initRes.cookies);

        if (!cookieMap['csrftoken']) throw new Error('Failed to get csrftoken (Proxy might be blocked by IG)');

        // Ensure datr device trust cookie is extracted or generated
        if (!cookieMap['datr']) {
            const datrM = initRes.data.match(/"datr":"([^"]+)"/) ||
                initRes.data.match(/datr=([a-zA-Z0-9_\-]+)/) ||
                initRes.data.match(/"machine_id":"([^"]+)"/);
            if (datrM) {
                cookieMap['datr'] = datrM[1];
            } else {
                cookieMap['datr'] = crypto.randomBytes(18).toString('base64url');
            }
        }
        if (!cookieMap['ig_did']) {
            const igDidM = initRes.data.match(/"device_id":"([^"]+)"/) || initRes.data.match(/"ig_did":"([^"]+)"/);
            cookieMap['ig_did'] = igDidM ? igDidM[1] : uuid().toUpperCase();
        }
        if (!cookieMap['wd']) cookieMap['wd'] = isFirefox ? '1420x919' : (isMobile ? '412x915' : '1116x911');
        if (!cookieMap['ps_l']) cookieMap['ps_l'] = '1';
        if (!cookieMap['ps_n']) cookieMap['ps_n'] = '1';

        const lsdM = initRes.data.match(/"LSD",\[\],{"token":"([^"]+)"/);
        const lsd = lsdM ? lsdM[1] : '';

        // Dynamically extract __rev and __hs so stale values don't cause silent OTP drops
        const revM = initRes.data.match(/"client_revision":(\d+)/) ||
            initRes.data.match(/"revision":(\d+)/) ||
            initRes.data.match(/"__spin_r":(\d+)/) ||
            initRes.data.match(/"spin_r":(\d+)/) ||
            initRes.data.match(/"__rev":(\d+)/);
        const liveRev = revM ? revM[1] : '1046913831'; // Today's capture fallback

        const hsM = initRes.data.match(/"haste_session":"([^"]+)"/) ||
            initRes.data.match(/__hs":"([^"]+)"/);
        const liveHs = hsM ? hsM[1] : '20702.HYP:instagram_web_pkg.2.1...0'; // Today's capture fallback

        // doc_id for useCAARegistrationFormSubmitMutation — Meta rotates this regularly!
        // Use multiple regex patterns to catch different script bundle structures
        const docM = initRes.data.match(/"useCAARegistrationFormSubmitMutation"[^}]*?"id":\s*"(\d+)"/) ||
            initRes.data.match(/useCAARegistrationFormSubmitMutation[\s\S]{0,200}?"(\d{17,})"/) ||
            initRes.data.match(/"doc_id":\s*"(27\d{15,})"/) ||
            initRes.data.match(/CAARegistration[\s\S]{0,300}?"id":\s*"(\d{17,})"/);
        const liveDocId = docM ? docM[1] : '27029416779977343'; // Aug 19 2026
        debugLog(normalizedContact, 'doc_id', { extracted: !!docM, value: liveDocId });

        // doc_id for useCAARegistrationFieldValidationQuery (CONTACTPOINT pre-check)
        const validationDocM = initRes.data.match(/"useCAARegistrationFieldValidationQuery"[^}]*?"id":\s*"(\d+)"/) ||
            initRes.data.match(/useCAARegistrationFieldValidationQuery[\s\S]{0,200}?"(\d{17,})"/) ||
            initRes.data.match(/"doc_id":\s*"(26\d{14,})"/);
        const liveValidationDocId = validationDocM ? validationDocM[1] : '26387190147557007'; // Aug 19 2026
        debugLog(normalizedContact, 'validation_doc_id', { extracted: !!validationDocM, value: liveValidationDocId });

        // doc_id for useCAARegistrationUsernameTypeaheadQuery (Username availability check)
        const typeaheadDocM = initRes.data.match(/"useCAARegistrationUsernameTypeaheadQuery"[^}]*?"id":\s*"(\d+)"/) ||
            initRes.data.match(/useCAARegistrationUsernameTypeaheadQuery[\s\S]{0,200}?"(\d{15,})"/) ||
            initRes.data.match(/"doc_id":\s*"(96\d{13,})"/);
        const liveTypeaheadDocId = typeaheadDocM ? typeaheadDocM[1] : '9643835809045186'; // Aug 19 2026

        // Extract public encryption key & key_id for WebCrypto password encryption
        const pkM = initRes.data.match(/"public_key":"([^"]+)"/) || initRes.data.match(/"publicKey":"([^"]+)"/) || initRes.data.match(/publicKey\\":\\"([^"\\]+)\\"/);
        const kidM = initRes.data.match(/"key_id":"(\d+)"/) || initRes.data.match(/"encryption_key_id":"(\d+)"/) || initRes.data.match(/"keyId":"(\d+)"/);
        const publicKey = pkM ? pkM[1].replace(/\\n/g, '\n').replace(/\\/g, '') : null;
        const keyId = kidM ? kidM[1] : '10';

        // Compute jazoest — browser does: 2 + sum of all charCodes in csrftoken
        const csrf = cookieMap['csrftoken'] || '';
        const jazoest = String(2 + [...csrf].reduce((a, c) => a + c.charCodeAt(0), 0));

        // Extract __dyn from page (large client state token)
        const dynM = initRes.data.match(/"__dyn":"([^"]+)"/) ||
            initRes.data.match(/__dyn[":\s]+"([^"]+)"/);
        const dynFallback = '7xeUmwlEnwn8K2Wmh0no6u5U4e0yoW3q32360CEbo1nEhw2nVE4W0qa0FE2awpUO0n24o5-1ywOwv89k2C1FwnE6a0D85m1mzXwae4UaEW2G0AEco5G0zK1swa-0oa2-azo7u1xwIwbS1LwTwKG1pg2Xwr86C1mgO1uQp1yU5Oi2K7E5y0xE2xyUC4o1lUGq1Qw6DwRwto';
        const dynEarly = dynM ? dynM[1] : dynFallback;
        const dynLate = dynM ? dynM[1] : dynFallback;

        // Extract __csr from page (client state record)
        const csrM = initRes.data.match(/"__csr":"([^"]+)"/) ||
            initRes.data.match(/__csr[":\s]+"([^"]+)"/);
        const liveCsr = csrM ? csrM[1] : 'gF1z2n4hcWFjq8DD8oBK-y4AKJ5H-KpAQbFitWEzJ4JbS9peuKiPkrHLyKIOuh4HJBahqRrRQEUyjTiWGnV5GlaiGFanKmXCFikCvQagrDxm9gKaDCGU8GUnAwEGpWlQC8oCJ124Ex25Gu5pod8G2C8z8aXwzCUG2Ocx2jzU88uyrgpceyovxe4omxS00mQS4809n9i00Llw26ox1G6E0ytw3XEx0ok1wx8m0xU2WGSA0cDAwhS03B601vfe07HE';

        // Extract __hsi from page (haste session id)
        const hsiM = initRes.data.match(/"haste_session_id":"([^"]+)"/) ||
            initRes.data.match(/"__hsi":"([^"]+)"/) ||
            initRes.data.match(/"__hsi":(\d+)/);
        const liveHsi = hsiM ? hsiM[1] : String(Date.now());

        const spinT = String(Math.floor(Date.now() / 1000));

        // Updated from live capture
        const hsdpEarly = 'gL686hn16H13ohl6gRzo4-Jk12Dzo2zDwUrUiwpG600wKU0nqw0M5w13e02qS';
        const hsdpLate = 'gL686hn16H13ohl6gRzo4-Jk12Dzo2zDwUrUiwpG600wKU0nqw0M5w13e02qS';
        const sjspEarly = 'gL686hn16H4hIlohl6gRzo4-Jk12Dzo2HwUrU7Cxw';
        const sjspLate = 'gL686hn16H4hIlohl6gRzo4-Jk12Dzo2HwUrU7Cxw';
        // __hblp is uniform across all calls
        const liveHblp = '067Dzo2HxW3d0ro6u0QUbo27Bz9VU1U81RorwtEizo4e05z85ibg4O2W2S0Jo6a07AE0RW1YwPwgo1IE0zW0ME2CwNw1pyU1mu0N8qwUwEwTw';

        // __s is static per session (Aug 5 capture: same value across all calls)
        const sessionId = genSessionId(); // generated once, reused for all calls

        debugLog(normalizedContact, 'live-params', { rev: liveRev, hs: liveHs, docId: liveDocId, lsd, jazoest });

        if (isMobile) {
            // ──────────────── MOBILE WBLOKS FLOW (Mu 8-19-26) ────────────────
            const bkvM = initRes.data.match(/"__bkv":"([^"]+)"/) || initRes.data.match(/__bkv=([a-f0-9]+)/);
            const liveBkv = bkvM ? bkvM[1] : '01bbe56c336ef8c78349dfc669ebb1cb4dc89422fe54560107bdb6b5e1666215';

            const mobileHeaders = {
                'User-Agent': client.userAgent,
                'Accept': '*/*',
                'Accept-Language': acceptLang,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'Origin': 'https://www.instagram.com',
                'Referer': 'https://www.instagram.com/accounts/signup/phone/',
                'x-asbd-id': '359341',
                'x-fb-lsd': lsd,
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
                ...client.clientHints
            };

            const eventRequestId = uuid();
            const latencyQplInstanceId = String(Math.floor(Date.now() * 10000 + Math.random() * 9000));
            const mid = cookieMap['mid'] || '';

            // Step 1: Contactpoint phone validation action
            onStatus(`[2/4] Validating mobile contactpoint (WBloks)...`);
            const phoneValidServerParams = {
                event_request_id: eventRequestId,
                cp_funnel: 0,
                cp_source: 0,
                text_input_id: "3xie7g:32",
                reg_info: JSON.stringify({
                    first_name: null, last_name: null, full_name: null,
                    contactpoint: null, ar_contactpoint: null, attempted_empty_last_name: null,
                    contactpoint_type: "phone", is_using_unified_cp: null, unified_cp_screen_variant: null,
                    is_cp_auto_confirmed: false, is_cp_auto_confirmable: false, is_cp_claimed: false,
                    confirmation_code: null, birthday: null, birthday_derived_from_age: null,
                    age_range: null, did_use_age: null, os_shared_age_range: null, gender: null,
                    use_custom_gender: false, custom_gender: null, encrypted_password: null,
                    username: null, username_prefill: null, accounts_list_client: null, fb_conf_source: null,
                    device_id: mid, ig4a_qe_device_id: null, family_device_id: null,
                    fdid_available_on_start: null, fdid_rid_available_on_start: null, asdid_available_on_start: null,
                    user_id: null, safetynet_token: null, skip_slow_rel_check: false, safetynet_response: null,
                    machine_id: null, profile_photo: null, profile_photo_id: null, profile_photo_upload_id: null,
                    avatar: null, email_oauth_token_no_contact_perm: null, email_oauth_token: null, email_oauth_tokens: null,
                    sign_in_with_google_email: null, should_skip_two_step_conf: null, openid_tokens_for_testing: null,
                    opt_out_source_account_reg_info_logging_only: null, encrypted_msisdn: null, encrypted_msisdn_for_safetynet: null,
                    cached_headers_safetynet_info: null, should_skip_headers_safetynet: null, headers_last_infra_flow_id: null,
                    headers_last_infra_flow_id_safetynet: null, headers_flow_id: null, was_headers_prefill_available: null,
                    sso_enabled: null, existing_accounts: null, used_ig_birthday: null, create_new_to_app_account: null,
                    skip_session_info: null, ck_error: null, ck_id: null, ck_nonce: null, should_save_password: null,
                    fb_access_token: null, is_msplit_reg: null, is_spectra_reg: null, dema_account_consent_given: null,
                    spectra_entry_source: null, spectra_reg_token: null, spectra_reg_guardian_id: null,
                    spectra_reg_guardian_logged_in_context: null, spectra_requester_user_id: null, user_id_of_msplit_creator: null,
                    msplit_creator_nonce: null, dma_data_combination_consent_given: null, xapp_accounts: null, fb_device_id: null,
                    fb_machine_id: null, ig_device_id: null, ig_machine_id: null, should_skip_nta_upsell: null, big_blue_token: null,
                    caa_reg_flow_source: null, ig_authorization_token: null, full_sheet_flow: false, crypted_user_id: null,
                    is_ca_late_teen: null, is_early_teen: null, is_caa_perf_enabled: false, is_preform: true, should_show_rel_error: false,
                    ignore_suma_check: false, dismissed_login_upsell_with_cna: false, ignore_existing_login: false,
                    ignore_existing_login_from_suma: false, ignore_existing_login_after_errors: false, suggested_first_name: null,
                    suggested_last_name: null, suggested_full_name: null, frl_authorization_token: null, post_form_errors: null,
                    skip_step_without_errors: false, existing_account_exact_match_checked: false, existing_account_fuzzy_match_checked: false,
                    email_oauth_exists: false, confirmation_code_send_error: null, consent_jurisdiction_at_gate: null,
                    consent_jurisdiction_at_inflow: null, pc_enforcement_outcome: null, pc_inflow_decision: null, is_too_young: false,
                    source_account_type: null, whatsapp_installed_on_client: false, confirmation_medium: null,
                    source_credentials_type: null, source_cuid: null, source_account_reg_info: null, soap_creation_source: null,
                    source_account_type_to_reg_info: null, registration_flow_id: "", should_skip_youth_tos: false,
                    is_youth_regulation_flow_complete: false, is_on_cold_start: false, email_prefilled: false, cp_confirmed_by_auto_conf: false,
                    in_sowa_experiment: false, youth_regulation_config: null, conf_allow_back_nav_after_change_cp: null,
                    conf_bouncing_cliff_screen_type: null, conf_show_bouncing_cliff: null, eligible_to_flash_call_in_ig4a: false,
                    eligible_to_mo_sms_in_ig4a: false, mo_sms_ent_id: null, flash_call_permissions_status: null,
                    gms_incoming_call_retriever_eligibility: null, attestation_result: null, request_data_and_challenge_nonce_string: null,
                    confirmed_cp_and_code: null, notification_callback_id: null, reg_suma_state: 0, is_msplit_neutral_choice: false,
                    msg_previous_cp: null, ntp_import_source_info: null, youth_consent_decision_time: null, sk_pipa_consent_given: null,
                    should_show_spi_before_conf: true, google_oauth_account: null, is_reg_request_from_ig_suma: false, is_toa_reg: false,
                    is_threads_public: false, spc_import_flow: false, caa_play_integrity_attestation_result: null, client_known_key_hash: null,
                    flash_call_provider: null, is_in_gms_experience: null, flash_call_nonce_prefix_details: null, spc_birthday_input: false,
                    failed_birthday_year_count: null, user_presented_medium_source: null, user_opted_out_of_ntp: null,
                    is_from_registration_reminder: false, show_youth_reg_in_ig_spc: false, fb_suma_is_high_confidence: null,
                    screen_visited: ["CAA_REG_CONTACT_POINT_PHONE"], fb_email_login_upsell_skip_suma_post_tos: false,
                    fb_suma_is_from_email_login_upsell: false, fb_suma_is_from_phone_login_upsell: false, should_prefill_cp_in_ar: null,
                    ig_partially_created_account_user_id: null, ig_partially_created_account_nonce: null,
                    ig_partially_created_account_nonce_expiry: null, force_sessionless_nux_experience: false,
                    has_seen_suma_landing_page_pre_conf: false, has_seen_suma_candidate_page_pre_conf: false,
                    has_seen_confirmation_screen: false, suma_on_conf_threshold: -1, should_show_error_msg: true,
                    th_profile_photo_token: null, attempted_silent_auth_in_fb: false, attempted_silent_auth_in_ig: false,
                    sa_prefetch_callback_id: null, cp_suma_results_map: null, source_username: null, next_uri: null,
                    should_use_next_uri: null, linking_entry_point: null, fb_encrypted_partial_new_account_properties: null,
                    starter_pack_name: null, starter_pack_creator_user_ids: null, wa_data_bundle: null, bloks_controller_source: null,
                    airwave_registration_code: null, is_sessionless_nux: null, login_contactpoint: null, login_contactpoint_type: null,
                    should_show_bday_after_name_suggestions: null, should_override_back_nav: false, ig_footer_variant: "control",
                    ig_gender: null, device_network_info: null, is_from_web_lite_reg_controller: null, login_form_siwg_email: null,
                    account_setup_waterfall_id: null, is_wanted_suma_user: null, device_zero_balance_state: null,
                    wa_to_ig_merged_tos_variant: null, is_in_nta_single_form: false, source_account_image_asset_id: null,
                    passkey_eligible_device: null, nta_ac_opted_out: null, nta_control_reason: null, nta_risk_type: null,
                    nta_single_form_variant: null, enable_survey: null, phone_prefetch_outcome: null, tos_accepted_on_profile_info: null
                }),
                flow_info: JSON.stringify({ flow_name: "new_to_meta_mweb_ig_default", flow_type: "ntf" }),
                current_step: 0,
                INTERNAL__latency_qpl_marker_id: 36707139,
                INTERNAL__latency_qpl_instance_id: latencyQplInstanceId,
                device_id: mid,
                family_device_id: null, waterfall_id: null, offline_experiment_group: null,
                layered_homepage_experiment_group: null, is_platform_login: 0, is_from_logged_in_switcher: 0,
                is_from_logged_out: 0, access_flow_version: "pre_mt_behavior", login_surface: "unknown"
            };
            const phoneValidClientParams = {
                device_id: mid, family_device_id: "", cloud_trust_token: null, block_store_machine_id: "",
                zero_balance_state: "", phone: normalizedContact, accounts_list: [], build_type: "",
                encrypted_msisdn: "", headers_infra_flow_id: "", was_headers_prefill_available: 0,
                was_headers_prefill_used: 0, fb_ig_device_id: [], whatsapp_installed_on_client: 0,
                confirmed_cp_and_code: {}, msg_previous_cp: "", switch_cp_first_time_loading: 1,
                switch_cp_have_seen_suma: 0, has_rejected_rel: 0, login_upsell_phone_list: [], country_code: "",
                prefill_attempted_silent_auth: 0, device_network_info: null, seen_login_upsell: 0,
                network_bssid: null, lois_settings: { lois_token: "" }, aac: ""
            };

            const phoneValidBody = new URLSearchParams({
                '__d': 'www', '__user': '0', '__a': '1', '__req': 'd',
                '__hs': liveHs, 'dpr': '3', '__ccg': 'GOOD', '__rev': liveRev,
                '__s': sessionId, '__hsi': liveHsi, '__dyn': dynLate, '__csr': liveCsr,
                '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
                '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
                '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
                '__crn': 'comet.igweb.PolarisWebBloksRegRoute',
                'params': JSON.stringify({ server_params: phoneValidServerParams, client_input_params: phoneValidClientParams })
            }).toString();

            const phoneValidUrl = `https://www.instagram.com/async/wbloks/fetch/?appid=com.bloks.www.bloks.caa.reg.async.contactpoint_phone.async&type=action&__bkv=${liveBkv}`;
            const phoneValidRes = await sendRequest(phoneValidUrl, 'POST', mobileHeaders, phoneValidBody, proxy, timeout);
            updateCookies(phoneValidRes.cookies);

            // Step 2: Confirm SMS dispatch dialog UI request
            onStatus(`[3/4] Fetching SMS dispatch UI (WBloks)...`);
            const dispatchBody = new URLSearchParams({
                '__d': 'www', '__user': '0', '__a': '1', '__req': 'f',
                '__hs': liveHs, 'dpr': '3', '__ccg': 'GOOD', '__rev': liveRev,
                '__s': sessionId, '__hsi': liveHsi, '__dyn': dynLate, '__csr': liveCsr,
                '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
                '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
                '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
                '__crn': 'comet.igweb.PolarisWebBloksRegRoute',
                'params': JSON.stringify({
                    server_params: {
                        device_id: mid, is_platform_login: 0, is_from_logged_out: 0,
                        access_flow_version: "pre_mt_behavior", is_bottomsheet: 1, use_content_variant: 1,
                        reg_info: JSON.stringify({ contactpoint: `+${normalizedContact}`, contactpoint_type: "phone", device_id: mid }),
                        flow_info: JSON.stringify({ flow_name: "new_to_meta_mweb_ig_default", flow_type: "ntf" }),
                        current_step: 0, INTERNAL_INFRA_screen_id: "3y1cua:25"
                    },
                    client_input_params: { lois_settings: { lois_token: "" }, aac: "" }
                })
            }).toString();

            const dispatchUrl = `https://www.instagram.com/async/wbloks/fetch/?appid=com.bloks.www.bloks.caa.reg.confirm_sms_dispatch&type=app&__bkv=${liveBkv}`;
            const dispatchRes = await sendRequest(dispatchUrl, 'POST', mobileHeaders, dispatchBody, proxy, timeout).catch(() => ({ data: '' }));

            // Step 3: Trigger confirmation OTP code send
            onStatus(`[4/4] Sending OTP trigger (Mobile WBloks)...`);
            const sendConfServerParams = {
                event_request_id: eventRequestId,
                phone: normalizedContact,
                accounts_list: [],
                reg_info: JSON.stringify({
                    first_name: null, last_name: null, full_name: null,
                    contactpoint: `+${normalizedContact}`, ar_contactpoint: null,
                    attempted_empty_last_name: null, contactpoint_type: "phone",
                    is_using_unified_cp: false, unified_cp_screen_variant: null,
                    is_cp_auto_confirmed: false, is_cp_auto_confirmable: false, is_cp_claimed: false,
                    confirmation_code: null, birthday: null, birthday_derived_from_age: null,
                    age_range: null, did_use_age: null, os_shared_age_range: null,
                    gender: null, use_custom_gender: false, custom_gender: null,
                    encrypted_password: null, username: null, username_prefill: null,
                    accounts_list_client: null, fb_conf_source: null, device_id: mid,
                    ig4a_qe_device_id: null, family_device_id: null, fdid_available_on_start: null,
                    fdid_rid_available_on_start: null, asdid_available_on_start: null, user_id: null,
                    safetynet_token: null, skip_slow_rel_check: false, safetynet_response: null,
                    machine_id: null, profile_photo: null, profile_photo_id: null, profile_photo_upload_id: null,
                    avatar: null, email_oauth_token_no_contact_perm: null, email_oauth_token: null,
                    email_oauth_tokens: null, sign_in_with_google_email: null, should_skip_two_step_conf: null,
                    openid_tokens_for_testing: null, opt_out_source_account_reg_info_logging_only: null,
                    encrypted_msisdn: null, encrypted_msisdn_for_safetynet: null, cached_headers_safetynet_info: null,
                    should_skip_headers_safetynet: null, headers_last_infra_flow_id: null,
                    headers_last_infra_flow_id_safetynet: null, headers_flow_id: uuid(),
                    was_headers_prefill_available: false, sso_enabled: null, existing_accounts: null,
                    used_ig_birthday: null, create_new_to_app_account: null, skip_session_info: null,
                    ck_error: null, ck_id: null, ck_nonce: null, should_save_password: null,
                    fb_access_token: null, is_msplit_reg: null, is_spectra_reg: null,
                    dema_account_consent_given: null, spectra_entry_source: null, spectra_reg_token: null,
                    spectra_reg_guardian_id: null, spectra_reg_guardian_logged_in_context: null,
                    spectra_requester_user_id: null, user_id_of_msplit_creator: null, msplit_creator_nonce: null,
                    dma_data_combination_consent_given: null, xapp_accounts: null, fb_device_id: null,
                    fb_machine_id: null, ig_device_id: null, ig_machine_id: null, should_skip_nta_upsell: null,
                    big_blue_token: null, caa_reg_flow_source: null, ig_authorization_token: null,
                    full_sheet_flow: false, crypted_user_id: null, is_ca_late_teen: null, is_early_teen: null,
                    is_caa_perf_enabled: false, is_preform: true, should_show_rel_error: false,
                    ignore_suma_check: false, dismissed_login_upsell_with_cna: false, ignore_existing_login: false,
                    ignore_existing_login_from_suma: false, ignore_existing_login_after_errors: false,
                    suggested_first_name: null, suggested_last_name: null, suggested_full_name: null,
                    frl_authorization_token: null, post_form_errors: null, skip_step_without_errors: false,
                    existing_account_exact_match_checked: false, existing_account_fuzzy_match_checked: false,
                    email_oauth_exists: false, confirmation_code_send_error: null, consent_jurisdiction_at_gate: null,
                    consent_jurisdiction_at_inflow: null, pc_enforcement_outcome: null, pc_inflow_decision: null,
                    is_too_young: false, source_account_type: null, whatsapp_installed_on_client: false,
                    confirmation_medium: "sms", source_credentials_type: null, source_cuid: null,
                    source_account_reg_info: null, soap_creation_source: null, source_account_type_to_reg_info: null,
                    registration_flow_id: "", should_skip_youth_tos: false, is_youth_regulation_flow_complete: false,
                    is_on_cold_start: false, email_prefilled: false, cp_confirmed_by_auto_conf: false,
                    in_sowa_experiment: false, youth_regulation_config: null, conf_allow_back_nav_after_change_cp: null,
                    conf_bouncing_cliff_screen_type: null, conf_show_bouncing_cliff: null,
                    eligible_to_flash_call_in_ig4a: false, eligible_to_mo_sms_in_ig4a: false, mo_sms_ent_id: null,
                    flash_call_permissions_status: null, gms_incoming_call_retriever_eligibility: null,
                    attestation_result: null, request_data_and_challenge_nonce_string: null,
                    confirmed_cp_and_code: null, notification_callback_id: null, reg_suma_state: 0,
                    is_msplit_neutral_choice: false, msg_previous_cp: null, ntp_import_source_info: null,
                    youth_consent_decision_time: null, sk_pipa_consent_given: null, should_show_spi_before_conf: true,
                    google_oauth_account: null, is_reg_request_from_ig_suma: false, is_toa_reg: false,
                    is_threads_public: false, spc_import_flow: false, caa_play_integrity_attestation_result: null,
                    client_known_key_hash: null, flash_call_provider: null, is_in_gms_experience: null,
                    flash_call_nonce_prefix_details: null, spc_birthday_input: false, failed_birthday_year_count: null,
                    user_presented_medium_source: null, user_opted_out_of_ntp: null,
                    is_from_registration_reminder: false, show_youth_reg_in_ig_spc: false,
                    fb_suma_is_high_confidence: null, screen_visited: ["CAA_REG_CONTACT_POINT_PHONE"],
                    fb_email_login_upsell_skip_suma_post_tos: false, fb_suma_is_from_email_login_upsell: false,
                    fb_suma_is_from_phone_login_upsell: false, should_prefill_cp_in_ar: false,
                    ig_partially_created_account_user_id: null, ig_partially_created_account_nonce: null,
                    ig_partially_created_account_nonce_expiry: null, force_sessionless_nux_experience: false,
                    has_seen_suma_landing_page_pre_conf: false, has_seen_suma_candidate_page_pre_conf: false,
                    has_seen_confirmation_screen: false, suma_on_conf_threshold: -1, should_show_error_msg: true,
                    th_profile_photo_token: null, attempted_silent_auth_in_fb: false, attempted_silent_auth_in_ig: false,
                    sa_prefetch_callback_id: null, cp_suma_results_map: null, source_username: null, next_uri: null,
                    should_use_next_uri: null, linking_entry_point: null, fb_encrypted_partial_new_account_properties: null,
                    starter_pack_name: null, starter_pack_creator_user_ids: null, wa_data_bundle: null,
                    bloks_controller_source: null, airwave_registration_code: null, is_sessionless_nux: null,
                    login_contactpoint: null, login_contactpoint_type: null, should_show_bday_after_name_suggestions: null,
                    should_override_back_nav: false, ig_footer_variant: "control", ig_gender: null,
                    device_network_info: null, is_from_web_lite_reg_controller: null, login_form_siwg_email: null,
                    account_setup_waterfall_id: null, is_wanted_suma_user: null, device_zero_balance_state: null,
                    wa_to_ig_merged_tos_variant: null, is_in_nta_single_form: false, source_account_image_asset_id: null,
                    passkey_eligible_device: null, nta_ac_opted_out: null, nta_control_reason: null, nta_risk_type: null,
                    nta_single_form_variant: null, enable_survey: null, phone_prefetch_outcome: null,
                    tos_accepted_on_profile_info: null
                }),
                flow_info: JSON.stringify({ flow_name: "new_to_meta_mweb_ig_default", flow_type: "ntf" }),
                current_step: 0,
                INTERNAL__latency_qpl_marker_id: 36707139,
                INTERNAL__latency_qpl_instance_id: latencyQplInstanceId,
                device_id: mid,
                family_device_id: null, waterfall_id: null, offline_experiment_group: null,
                layered_homepage_experiment_group: null, is_platform_login: 0, is_from_logged_in_switcher: 0,
                is_from_logged_out: 0, access_flow_version: "pre_mt_behavior", login_surface: "unknown"
            };

            const sendConfBody = new URLSearchParams({
                '__d': 'www', '__user': '0', '__a': '1', '__req': 'h',
                '__hs': liveHs, 'dpr': '3', '__ccg': 'GOOD', '__rev': liveRev,
                '__s': sessionId, '__hsi': liveHsi, '__dyn': dynLate, '__csr': liveCsr,
                '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
                '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
                '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
                '__crn': 'comet.igweb.PolarisWebBloksRegRoute',
                'params': JSON.stringify({
                    server_params: sendConfServerParams,
                    client_input_params: { device_id: mid, qe_device_id: "", family_device_id: "", build_type: "", cloud_trust_token: null, network_bssid: null, lois_settings: { lois_token: "" }, aac: "" }
                })
            }).toString();

            const sendConfUrl = `https://www.instagram.com/async/wbloks/fetch/?appid=com.bloks.www.bloks.caa.reg.send_confirmation.async&type=action&__bkv=${liveBkv}`;
            const sendConfRes = await sendRequest(sendConfUrl, 'POST', mobileHeaders, sendConfBody, proxy, timeout);
            updateCookies(sendConfRes.cookies);

            if (sendConfRes.data.includes('confirmation_send_to_sms_success') ||
                sendConfRes.data.includes('com.bloks.www.bloks.caa.reg.confirmation') ||
                sendConfRes.data.includes('CAA_REG_CONFIRMATION_SCREEN') ||
                sendConfRes.data.includes('push_screen_BloksCAARegConfirmationController')) {
                onStatus(`[3/3] ✅ OTP Dispatched (Mobile)`);
                return { success: true, message: 'OTP Triggered successfully (Mobile WBloks)', phone: normalizedContact, browser: client.name, langName, proxyHost, proxyCountryName, numberCountryName };
            } else if (sendConfRes.data.includes('NOT_ALLOWED') || sendConfRes.data.includes('challenge_required')) {
                throw new Error('NOT_ALLOWED (Blocked by IG Anti-Bot / Bad Proxy / IP Flagged)');
            } else {
                return { success: true, message: 'OTP Triggered (Mobile)', phone: normalizedContact, browser: client.name, langName, proxyHost, proxyCountryName, numberCountryName };
            }
        }

        // ──────────────── DESKTOP GRAPHQL FLOW ────────────────
        // 2. CONTACTPOINT Field Validation + 3. Form Submit Mutation
        const client_mutation_id = uuid();
        const waterfall_id = uuid();

        const encTimestamp = Math.floor(Date.now() / 1000);
        const encPass = encryptPasswordWeb(generatedPassword, encTimestamp, publicKey, keyId);

        const variables = {
            "input": {
                "actor_id": "0",
                "client_mutation_id": client_mutation_id,
                "machine_id": cookieMap['mid'] || '',
                "reg_data": {
                    "birthday_day": generatedDob.day,
                    "birthday_month": generatedDob.month,
                    "birthday_year": generatedDob.year,
                    "contactpoint": { "sensitive_string_value": normalizedContact },
                    "contactpoint_type": isEmail ? "EMAIL" : "PHONE",
                    "custom_gender": "",
                    "did_use_age": false,
                    "firstname": { "sensitive_string_value": "" },
                    "fullname": { "sensitive_string_value": generatedName.full },
                    "ig_age_block_data": null,
                    "lastname": { "sensitive_string_value": "" },
                    "preferred_pronoun": null,
                    "reg_passwd__": { "sensitive_string_value": encPass },
                    "sex": null,
                    "use_custom_gender": false,
                    "username": { "sensitive_string_value": username }
                },
                "sk_pipa_consent_given": null,
                "waterfall_id": waterfall_id
            }
        };

        const clientDpr = isMobile ? '3' : '1';
        const clientScale = isMobile ? 3 : 1;

        const postBody = new URLSearchParams({
            'av': '0',
            '__d': 'www',
            '__user': '0',
            '__a': '1',
            '__req': 'z', // Aug 19 2026
            '__hs': liveHs,
            'dpr': clientDpr,
            '__ccg': 'GOOD',
            '__rev': liveRev,
            '__s': sessionId,
            '__hsi': liveHsi,
            '__dyn': dynLate,
            '__csr': liveCsr,
            '__hsdp': hsdpLate,
            '__hblp': liveHblp,
            '__sjsp': sjspLate,
            '__comet_req': '7',
            'lsd': lsd,
            'jazoest': jazoest,
            '__spin_r': liveRev,
            '__spin_b': 'trunk',
            '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '250359044,516759801', // Aug 19 2026
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFormSubmitMutation',
            'server_timestamps': 'true',
            'variables': JSON.stringify(variables),
            'doc_id': liveDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=250359044,516759801"]' // Aug 19 2026
        }).toString();

        // ── getHeaders: parameterized friendly name for both validation + submit ──
        const getHeaders = (friendlyName = 'useCAARegistrationFormSubmitMutation') => {
            if (isFirefox) {
                return {
                    'User-Agent': client.userAgent,
                    'Accept': '*/*',
                    'Accept-Language': acceptLang,
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-FB-Friendly-Name': friendlyName,
                    'X-CSRFToken': cookieMap['csrftoken'] || '',
                    'X-IG-App-ID': client.igAppId || '936619743392459',
                    'X-IG-Max-Touch-Points': isMobile ? '1' : '0',
                    'X-FB-LSD': lsd,
                    'X-ASBD-ID': '359341',
                    'Origin': 'https://www.instagram.com',
                    'Alt-Used': 'www.instagram.com',
                    'Connection': 'keep-alive',
                    'Referer': 'https://www.instagram.com/accounts/emailsignup/',
                    'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    ...(friendlyName !== 'useCAARegistrationFormSubmitMutation' ? { 'Priority': 'u=0' } : {}),
                    'TE': 'trailers'
                };
            }
            return {
                'User-Agent': client.userAgent,
                'Accept': '*/*',
                'Accept-Language': acceptLang,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://www.instagram.com',
                'Referer': 'https://www.instagram.com/accounts/emailsignup/',
                'x-ig-app-id': client.igAppId || '936619743392459',
                'x-ig-max-touch-points': isMobile ? '1' : '0',
                'x-fb-lsd': lsd,
                'x-csrftoken': cookieMap['csrftoken'] || '',
                'x-asbd-id': '359341',
                'x-fb-friendly-name': friendlyName,
                'priority': 'u=1, i',
                'sec-ch-prefers-color-scheme': 'dark',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'Cookie': Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
                ...client.clientHints
            };
        };

        // ── Step 2a/4: CONTACTPOINT field validation (real browser always sends this first!) ──
        onStatus(`[2/4] Validating contact point...`);
        const validationVariables = {
            "input": {
                "contactpoint": { "sensitive_string_value": normalizedContact },
                "contactpoint_type": isEmail ? "EMAIL" : "PHONE",
                "fetch_username_suggestions": true,
                "field_name": "CONTACTPOINT",
                "firstname": { "sensitive_string_value": "" },
                "fullname": { "sensitive_string_value": "" },
                "lastname": { "sensitive_string_value": "" },
                "machine_id": cookieMap['mid'] || ''
            },
            "scale": clientScale
        };
        const validationBody = new URLSearchParams({
            'av': '0',
            '__d': 'www',
            '__user': '0',
            '__a': '1',
            '__req': 'j', // Aug 19 2026
            '__hs': liveHs,
            'dpr': clientDpr,
            '__ccg': 'GOOD',
            '__rev': liveRev,
            '__s': sessionId,
            '__hsi': liveHsi,
            '__dyn': dynEarly,
            '__csr': liveCsr,
            '__hsdp': hsdpEarly,
            '__hblp': liveHblp,
            '__sjsp': sjspEarly,
            '__comet_req': '7',
            'lsd': lsd,
            'jazoest': jazoest,
            '__spin_r': liveRev,
            '__spin_b': 'trunk',
            '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFieldValidationQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(validationVariables),
            'doc_id': liveValidationDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();

        debugLog(normalizedContact, 'req-validate', validationBody);
        const validationRes = await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationFieldValidationQuery'), validationBody, proxy, timeout);
        updateCookies(validationRes.cookies);
        debugLog(normalizedContact, 'res-validate', validationRes.data);

        // Early exit if phone is already registered or blocked — no point sending submit
        try {
            const validData = JSON.parse(validationRes.data);
            const validRoot = validData?.data?.xfb_caa_registration_field_validation;
            if (validRoot?.error?.code) {
                const errMsg = validRoot.error.message || `CONTACTPOINT rejected (code ${validRoot.error.code})`;
                return { success: false, message: errMsg, phone: normalizedContact, langName, proxyHost, proxyCountryName, numberCountryName };
            }
        } catch (e) { /* non-critical — proceed to submit */ }

        // ── Step NEW: PASSWORD field validation (__req=m, Aug 19 capture) ──
        // Sent BEFORE fullname validation — simulates user typing password first
        const passwordValidVariables = {
            "input": {
                "contactpoint": { "sensitive_string_value": normalizedContact },
                "contactpoint_type": isEmail ? "EMAIL" : "PHONE",
                "fetch_username_suggestions": true,
                "field_name": "PASSWORD",
                "firstname": { "sensitive_string_value": "" },
                "fullname": { "sensitive_string_value": "" },
                "lastname": { "sensitive_string_value": "" },
                "machine_id": cookieMap['mid'] || '',
                "reg_passwd__": { "sensitive_string_value": encPass },
                "username": { "sensitive_string_value": "" }
            },
            "scale": clientScale
        };
        const passwordValidBody = new URLSearchParams({
            'av': '0', '__d': 'www', '__user': '0', '__a': '1',
            '__req': 'm', // Aug 19 2026
            '__hs': liveHs, 'dpr': clientDpr, '__ccg': 'GOOD', '__rev': liveRev,
            '__s': sessionId, '__hsi': liveHsi,
            '__dyn': dynLate,
            '__csr': liveCsr,
            '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
            '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
            '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFieldValidationQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(passwordValidVariables),
            'doc_id': liveValidationDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();
        await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationFieldValidationQuery'), passwordValidBody, proxy, timeout).catch(() => { });

        // ── Step 2b/4: FULLNAME field validation (simulates typing name) ──
        onStatus(`[3/4] Validating fullname & typeahead...`);
        const fullnameVariables = {
            "input": {
                "contactpoint": { "sensitive_string_value": normalizedContact },
                "contactpoint_type": isEmail ? "EMAIL" : "PHONE",
                "fetch_username_suggestions": true,
                "field_name": "FULLNAME",
                "firstname": { "sensitive_string_value": "" },
                "fullname": { "sensitive_string_value": generatedName.full },
                "lastname": { "sensitive_string_value": "" },
                "machine_id": cookieMap['mid'] || ''
            },
            "scale": clientScale
        };
        const fullnameBody = new URLSearchParams({
            'av': '0',
            '__d': 'www',
            '__user': '0',
            '__a': '1',
            '__req': 'n', // Aug 19 2026
            '__hs': liveHs,
            'dpr': clientDpr,
            '__ccg': 'GOOD',
            '__rev': liveRev,
            '__s': sessionId,
            '__hsi': liveHsi,
            '__dyn': dynLate,
            '__csr': liveCsr,
            '__hsdp': hsdpLate,
            '__hblp': liveHblp,
            '__sjsp': sjspLate,
            '__comet_req': '7',
            'lsd': lsd,
            'jazoest': jazoest,
            '__spin_r': liveRev,
            '__spin_b': 'trunk',
            '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFieldValidationQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(fullnameVariables),
            'doc_id': liveValidationDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();

        const fullnameRes = await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationFieldValidationQuery'), fullnameBody, proxy, timeout).catch(() => { return { data: '', cookies: [] }; });
        updateCookies(fullnameRes?.cookies || []);

        // ── Step NEW: PASSWORD+DOB combined validation (__req=o, Aug 19 capture) ──
        // Sent AFTER fullname — includes birthday + fullname + password + partial username
        const passwordDobVariables = {
            "input": {
                "birthday_day": generatedDob.day,
                "birthday_month": generatedDob.month,
                "birthday_year": generatedDob.year,
                "contactpoint": { "sensitive_string_value": normalizedContact },
                "contactpoint_type": isEmail ? "EMAIL" : "PHONE",
                "fetch_username_suggestions": false,
                "field_name": "PASSWORD",
                "firstname": { "sensitive_string_value": "" },
                "fullname": { "sensitive_string_value": generatedName.full },
                "lastname": { "sensitive_string_value": "" },
                "reg_passwd__": { "sensitive_string_value": generatedPassword },
                "username": { "sensitive_string_value": username }
            },
            "scale": clientScale
        };
        const passwordDobBody = new URLSearchParams({
            'av': '0', '__d': 'www', '__user': '0', '__a': '1',
            '__req': 'o', // Aug 19 2026
            '__hs': liveHs, 'dpr': clientDpr, '__ccg': 'GOOD', '__rev': liveRev,
            '__s': sessionId, '__hsi': liveHsi,
            '__dyn': dynLate, '__csr': liveCsr,
            '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
            '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
            '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFieldValidationQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(passwordDobVariables),
            'doc_id': liveValidationDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();
        await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationFieldValidationQuery'), passwordDobBody, proxy, timeout).catch(() => { });

        // ── Step 2c/4: USERNAME Typeahead Query (simulates username availability check) ──
        const typeaheadVariables = {
            "input": { "sensitive_string_value": username }
        };
        const typeaheadBody = new URLSearchParams({
            'av': '0',
            '__d': 'www',
            '__user': '0',
            '__a': '1',
            '__req': 'p', // Aug 19 2026
            '__hs': liveHs,
            'dpr': clientDpr,
            '__ccg': 'GOOD',
            '__rev': liveRev,
            '__s': sessionId,
            '__hsi': liveHsi,
            '__dyn': dynLate,
            '__csr': liveCsr,
            '__hsdp': hsdpLate,
            '__hblp': liveHblp,
            '__sjsp': sjspLate,
            '__comet_req': '7',
            'lsd': lsd,
            'jazoest': jazoest,
            '__spin_r': liveRev,
            '__spin_b': 'trunk',
            '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationUsernameTypeaheadQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(typeaheadVariables),
            'doc_id': liveTypeaheadDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();

        await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationUsernameTypeaheadQuery'), typeaheadBody, proxy, timeout).catch(() => { });

        // ── Step NEW (Aug 19 2026): USERNAME field validation for chosen username (__req=w) ──
        const chosenUsernameVariables = {
            "input": {
                "fetch_username_suggestions": false,
                "field_name": "USERNAME",
                "username": { "sensitive_string_value": username }
            },
            "scale": clientScale
        };
        const chosenUsernameBody = new URLSearchParams({
            'av': '0', '__d': 'www', '__user': '0', '__a': '1',
            '__req': 'w', // Aug 19 2026
            '__hs': liveHs, 'dpr': clientDpr, '__ccg': 'GOOD', '__rev': liveRev,
            '__s': sessionId, '__hsi': liveHsi,
            '__dyn': dynLate, '__csr': liveCsr,
            '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
            '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
            '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFieldValidationQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(chosenUsernameVariables),
            'doc_id': liveValidationDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();
        await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationFieldValidationQuery'), chosenUsernameBody, proxy, timeout).catch(() => { });

        // ── Step NEW (Aug 19 2026): Final PASSWORD+DOB validation with chosen username (__req=x) ──
        const finalPasswordDobVariables = {
            "input": {
                "birthday_day": generatedDob.day,
                "birthday_month": generatedDob.month,
                "birthday_year": generatedDob.year,
                "contactpoint": { "sensitive_string_value": normalizedContact },
                "contactpoint_type": isEmail ? "EMAIL" : "PHONE",
                "fetch_username_suggestions": true,
                "field_name": "PASSWORD",
                "firstname": { "sensitive_string_value": "" },
                "fullname": { "sensitive_string_value": generatedName.full },
                "lastname": { "sensitive_string_value": "" },
                "machine_id": cookieMap['mid'] || '',
                "reg_passwd__": { "sensitive_string_value": encPass },
                "username": { "sensitive_string_value": username }
            },
            "scale": clientScale
        };
        const finalPasswordDobBody = new URLSearchParams({
            'av': '0', '__d': 'www', '__user': '0', '__a': '1',
            '__req': 'x', // Aug 19 2026
            '__hs': liveHs, 'dpr': clientDpr, '__ccg': 'GOOD', '__rev': liveRev,
            '__s': sessionId, '__hsi': liveHsi,
            '__dyn': dynLate, '__csr': liveCsr,
            '__hsdp': hsdpLate, '__hblp': liveHblp, '__sjsp': sjspLate,
            '__comet_req': '7', 'lsd': lsd, 'jazoest': jazoest,
            '__spin_r': liveRev, '__spin_b': 'trunk', '__spin_t': spinT,
            '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
            'qpl_active_flow_ids': '516759801',
            'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': 'useCAARegistrationFieldValidationQuery',
            'server_timestamps': 'true',
            'variables': JSON.stringify(finalPasswordDobVariables),
            'doc_id': liveValidationDocId,
            'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
        }).toString();
        await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('useCAARegistrationFieldValidationQuery'), finalPasswordDobBody, proxy, timeout).catch(() => { });

        // Realistic pause: user reads username suggestions before clicking submit (~250-500ms)
        await new Promise(r => setTimeout(r, 250 + Math.floor(Math.random() * 250)));

        // ── Step 4/4: Form Submit Mutation (Trigger OTP) ──────────────────────────
        onStatus(`[4/4] Sending OTP trigger...`);

        debugLog(normalizedContact, 'req-submit', postBody);
        const submitRes = await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders(), postBody, proxy, timeout);
        updateCookies(submitRes.cookies);
        debugLog(normalizedContact, 'res-submit', submitRes.data);

        // Parse the GraphQL response properly — don't use fragile string matching
        let igStatus = null;
        let creationErrors = [];
        let ntfContext = null;
        try {
            const parsed = JSON.parse(submitRes.data);
            const root = parsed?.data?.caa_registration_homepage_submit;
            if (root) {
                igStatus = root.status;
                creationErrors = root.errors?.creation_errors || [];
                ntfContext = root.context?.ntf_context || null;
            }
        } catch (e) { /* non-JSON fallback below */ }

        if (!ntfContext) {
            const ntfM = submitRes.data.match(/"ntf_context":\s*"([^"]+)"/);
            if (ntfM) ntfContext = ntfM[1];
        }

        // ── Decision tree based on IG's actual status field ──────────────────────
        if (igStatus === 'SUCCESS' || submitRes.data.includes('"status":"SUCCESS"') || submitRes.data.includes('checkpoint_url') || submitRes.data.includes('is_eligible_to_register":true')) {
            onStatus(`[4/5] ✅ OTP Dispatched`);

            // Emulate browser loading the confirmation form screen
            if (ntfContext) {
                const confQueryBody = new URLSearchParams({
                    'av': '0',
                    '__d': 'www',
                    '__user': '0',
                    '__a': '1',
                    '__req': 't',
                    '__hs': liveHs,
                    'dpr': '1',
                    '__ccg': 'GOOD',
                    '__rev': liveRev,
                    '__s': sessionId,
                    '__hsi': liveHsi,
                    '__dyn': dynLate,
                    '__csr': liveCsr,
                    '__hsdp': hsdpLate,
                    '__hblp': liveHblp,
                    '__sjsp': sjspLate,
                    '__comet_req': '7',
                    'lsd': lsd,
                    'jazoest': jazoest,
                    '__spin_r': liveRev,
                    '__spin_b': 'trunk',
                    '__spin_t': spinT,
                    '__crn': 'comet.igweb.PolarisCAAIGRegistrationHomepageRoute',
                    'qpl_active_flow_ids': '516759801',
                    'fb_api_caller_class': 'RelayModern',
                    'fb_api_req_friendly_name': 'CAAConfirmationFormDesktopQuery',
                    'server_timestamps': 'true',
                    'variables': JSON.stringify({ "args": { "context": ntfContext }, "scale": 1 }),
                    'doc_id': '26495728670063238',
                    'fb_api_analytics_tags': '["qpl_active_flow_ids=516759801"]'
                }).toString();
                await sendRequest('https://www.instagram.com/api/graphql', 'POST', getHeaders('CAAConfirmationFormDesktopQuery'), confQueryBody, proxy, 5000).catch(() => { });
            }

            if (pollOtp) {
                if (typeof onOtpSent === 'function') {
                    onOtpSent(normalizedContact, `- ${langName} - Proxy (${proxyCountryName})`);
                }
                onStatus(`[4/5] ⏳ Waiting for OTP code...`);
                const otpCode = await pollOtp();
                if (!otpCode) {
                    return { success: false, confirmed: false, message: 'OTP timeout (no code received)', phone: normalizedContact, langName, proxyHost, proxyCountryName, numberCountryName };
                }
                onStatus(`[5/5] 🔐 Submitting OTP (${otpCode})...`);
                const confRes = await confirmAccountGraphQL({
                    code: otpCode,
                    ntfContext,
                    lsd, jazoest, sessionId, liveHs, liveRev, liveHsi, liveCsr,
                    dynLate, hsdpLate, liveHblp, sjspLate, spinT, client,
                    acceptLang, cookieMap, proxy, timeout
                });

                if (confRes.success) {
                    onStatus(`[5/5] 🔄 Refreshing session & checking account status...`);

                    // Emulate browser loading / navigating to home page after confirmation
                    const checkCookieStr = confRes.cookieString || Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
                    const refreshRes = await sendRequest(
                        'https://www.instagram.com/',
                        'GET',
                        isFirefox ? {
                            'User-Agent': client.userAgent,
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': acceptLang,
                            'Accept-Encoding': 'gzip, deflate, br, zstd',
                            'Alt-Used': 'www.instagram.com',
                            'Connection': 'keep-alive',
                            'Upgrade-Insecure-Requests': '1',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'same-origin',
                            'Sec-Fetch-User': '?1',
                            'Priority': 'u=0, i',
                            'TE': 'trailers',
                            'Cookie': checkCookieStr
                        } : {
                            'User-Agent': client.userAgent,
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                            'Accept-Language': acceptLang,
                            'Sec-Fetch-Site': 'same-origin',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-User': '?1',
                            'Sec-Fetch-Dest': 'document',
                            'Upgrade-Insecure-Requests': '1',
                            'priority': 'u=0, i',
                            'Cookie': checkCookieStr,
                            ...client.clientHints
                        },
                        null,
                        proxy,
                        15000,
                        { maxBytes: 35000 }
                    ).catch(() => null);

                    if (refreshRes && refreshRes.cookies && Array.isArray(refreshRes.cookies)) {
                        updateCookies(refreshRes.cookies);
                    }

                    const refreshData = refreshRes?.data || '';
                    const redirectLoc = refreshRes?.headers?.location || '';

                    let isCheckpoint = false;
                    let checkpointReason = '';

                    if (redirectLoc && /challenge|checkpoint|suspended|action_blocked/i.test(redirectLoc)) {
                        isCheckpoint = true;
                        checkpointReason = `Redirected to ${redirectLoc}`;
                    } else if (
                        /Confirm you're human/i.test(refreshData) ||
                        /challenge_context/i.test(refreshData) ||
                        /"is_checkpoint":\s*true/i.test(refreshData) ||
                        /checkpoint_required/i.test(refreshData) ||
                        /account_disabled|user_suspended/i.test(refreshData) ||
                        (refreshData.includes('/challenge/') && !refreshData.includes('PolarisFeedRoute') && !refreshData.includes('PolarisNavigationRoot'))
                    ) {
                        isCheckpoint = true;
                        checkpointReason = "Confirm you're human / Checkpoint Challenge";
                    }

                    if (isCheckpoint) {
                        debugLog(normalizedContact, 'dead-checkpoint', { checkpointReason, redirectLoc, dataSnippet: refreshData.substring(0, 500) });
                        return {
                            success: false,
                            confirmed: false,
                            checkpoint: true,
                            username: confRes.username || username,
                            password: generatedPassword,
                            cookies: confRes.cookieString || Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; '),
                            message: `Checkpoint: ${checkpointReason}`,
                            phone: normalizedContact,
                            langName,
                            proxyHost,
                            proxyCountryName,
                            numberCountryName
                        };
                    }

                    onStatus(`[5/5] 🎉 Account Confirmed & Live!`);

                    let twoFaKey = '';
                    let finalCookies = confRes.cookieString;

                    if (enable2fa) {
                        onStatus(`[5/5] 🛡️ Enabling 2FA Authentication...`);
                        const twoFaRes = await enableTwoFactorAuth({
                            userId: confRes.userId,
                            cookieMap,
                            client,
                            acceptLang,
                            sessionId,
                            liveHs,
                            liveRev,
                            liveHsi,
                            liveCsr,
                            dynLate,
                            hsdpLate,
                            liveHblp,
                            sjspLate,
                            proxy,
                            timeout,
                            onStatus
                        });

                        if (twoFaRes.success && twoFaRes.twoFaKey) {
                            twoFaKey = twoFaRes.twoFaKey;
                            if (twoFaRes.cookieString) {
                                finalCookies = twoFaRes.cookieString;
                            }
                        }
                    }

                    return {
                        success: true,
                        confirmed: true,
                        message: 'Account Confirmed',
                        phone: normalizedContact,
                        password: generatedPassword,
                        userId: confRes.userId || cookieMap['ds_user_id'] || '',
                        username: confRes.username || username,
                        cookies: finalCookies,
                        twoFaKey: twoFaKey,
                        browser: client.name,
                        langName,
                        proxyHost,
                        proxyCountryName,
                        numberCountryName
                    };
                } else {
                    return {
                        success: false,
                        confirmed: false,
                        message: confRes.error || 'Confirmation failed',
                        phone: normalizedContact,
                        langName,
                        proxyHost,
                        proxyCountryName,
                        numberCountryName
                    };
                }
            }
            if (typeof onOtpSent === 'function') {
                onOtpSent(normalizedContact, `- ${langName} - Proxy (${proxyCountryName})`);
            }
            return { success: true, message: 'OTP Triggered successfully', phone: normalizedContact, browser: client.name, langName, proxyHost, proxyCountryName, numberCountryName };
        } else if (igStatus === 'NOT_ALLOWED' || submitRes.data.includes('"status":"NOT_ALLOWED"')) {
            throw new Error('NOT_ALLOWED (Blocked by IG Anti-Bot / Bad Proxy / IP Flagged)');
        } else if (igStatus === 'UNKNOWN_ERROR' || (creationErrors.length > 0)) {
            // Per-number failure: number already registered, age-blocked, or spam-flagged by IG
            // This is NOT a proxy/tool failure — report it cleanly as a failed number
            const reason = creationErrors[0]?.message || 'IG rejected this number (registered/flagged)';
            return { success: false, message: reason, phone: normalizedContact, langName, proxyHost, proxyCountryName, numberCountryName };
        } else if (submitRes.data.includes('"errors"') && !igStatus) {
            // Top-level GraphQL error (e.g. auth error, malformed request)
            let errMsg = 'GraphQL error';
            try {
                const parsed = JSON.parse(submitRes.data);
                if (parsed.errors && parsed.errors.length > 0) errMsg = parsed.errors[0].message;
            } catch (e) { }
            throw new Error(errMsg);
        } else {
            onStatus(`[3/3] ⚠️ OTP Unverified (Check debug log)`);
            return { success: true, message: 'Request sent (verify debug log)', phone: normalizedContact, langName, proxyHost, proxyCountryName, numberCountryName };
        }
    } catch (error) {
        return { success: false, message: `${error.message}`, phone: normalizedContact, langName: error.langName || 'en', proxyHost: error.proxyHost || 'Unknown', proxyCountryName: 'Unknown', numberCountryName: 'Unknown' };
    }
}

// ── 8. Main Orchestrator ─────────────────────────────────────────
if (isMainThread) {
    class Dashboard {
        constructor(totalNumbers, isAutoConfirm = true) {
            this.totalNumbers = totalNumbers;
            this.isAutoConfirm = isAutoConfirm;
            this.processed = 0;
            this.otpSent = 0;
            this.confirmed = 0;
            this.twoFa = 0;
            this.dead = 0;
            this.failed = 0;
            this.startTime = Date.now();
        }

        addLog(msg, type, extInfo = '') {
            const formatSimpleReason = (raw) => {
                if (!raw) return 'Failed';
                const str = String(raw).trim();
                if (/checkpoint|challenge|suspended|Confirm you're human/i.test(str)) return 'Checkpoint';
                if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT|proxy connect timeout/i.test(str)) return 'Timeout';
                if (/proxy|socket|disconnected|hang up|ECONN/i.test(str)) return 'Proxy Drop';
                if (/field_exception|GraphQL error|500|502|503/i.test(str)) return 'Server Error';
                if (/NOT_ALLOWED|anti-bot|flagged|rejected/i.test(str)) return 'Rejected';
                if (/invalid code|session expired|Confirmation failed/i.test(str)) return 'Invalid OTP';
                if (/no code received|OTP timeout/i.test(str)) return 'OTP Timeout';
                if (/valid email/i.test(str)) return 'Invalid Email';
                if (/error occurred|حدث خطأ|Hiba történt|Se ha producido|Fehler/i.test(str)) return 'Reg Error';
                return str.length > 28 ? str.substring(0, 25) + '...' : str;
            };

            let line = '';
            const emailMatch = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            const phoneMatch = msg.match(/\+?\d{8,}/);
            const target = emailMatch ? emailMatch[0] : (phoneMatch ? phoneMatch[0] : '');

            if (type === 'confirmed' || (type === 'success' && msg.includes('Confirmed'))) {
                const cleanMsg = msg.replace(/^🎉\s*Confirmed\s*(\(2FA:\s*\w+\))?:\s*/i, '');
                const twoFaTag = msg.match(/\(2FA:\s*\w+\)/i);
                const tagStr = twoFaTag ? chalk.hex('#B388FF')(` ${twoFaTag[0]}`) : '';
                line = chalk.hex('#00FF88').bold('SK — Insta │ Confirmed → ') +
                    chalk.hex('#FCAF45').bold(cleanMsg || target) +
                    tagStr +
                    (extInfo ? chalk.hex('#888888')(` ${extInfo}`) : '');
            } else if (type === 'otp' || (type === 'success' && (msg.includes('Triggered OTP') || msg.includes('OTP Sent')))) {
                const cleanTarget = target || msg.replace(/^Triggered OTP for\s*/i, '').replace(/^OTP Sent:\s*/i, '');
                line = chalk.hex('#00D2FF').bold('SK — Insta │ OTP Sent → ') +
                    chalk.hex('#FCAF45').bold(cleanTarget) +
                    (extInfo ? chalk.hex('#888888')(` ${extInfo}`) : '');
            } else if (type === 'dead') {
                const cleanReason = formatSimpleReason(msg.replace(/^Dead on [^:]+:\s*/i, ''));
                line = chalk.hex('#FFA500').bold('SK — Insta │ Dead → ') +
                    chalk.hex('#FCAF45').bold(target || 'Target') +
                    chalk.hex('#888888')(` (${cleanReason})`) +
                    (extInfo ? chalk.hex('#888888')(` ${extInfo}`) : '');
            } else if (type === 'failed' || type === 'error') {
                const cleanReason = formatSimpleReason(msg.replace(/^Failed on [^:]+:\s*/i, ''));
                line = chalk.hex('#FF4466').bold('SK — Insta │ Failed → ') +
                    chalk.hex('#FCAF45').bold(target || 'Target') +
                    chalk.hex('#888888')(` (${cleanReason})`) +
                    (extInfo ? chalk.hex('#888888')(` ${extInfo}`) : '');
            } else {
                return; // Do not print other types (like retry)
            }
            process.stdout.write(`\r\x1b[K${line}\n`);
            this.render();
        }

        setStatus(msg) { }
        update() { }

        render() {
            const pct = (this.processed / Math.max(this.totalNumbers, 1));
            const pctStr = (pct * 100).toFixed(1);
            const BAR_WIDTH = 18;
            const filled = Math.round(pct * BAR_WIDTH);
            const empty = Math.max(0, BAR_WIDTH - filled);
            const bar = chalk.hex('#00FF88')('█'.repeat(filled)) + chalk.hex('#333333')('░'.repeat(empty));
            
            let statsSection = '';
            if (this.isAutoConfirm) {
                statsSection = chalk.hex('#00D2FF').bold(`OTP: ${this.otpSent}`) +
                    chalk.hex('#555555')(' │ ') +
                    chalk.hex('#00FF88').bold(`Confirm: ${this.confirmed}`) +
                    chalk.hex('#555555')(' │ ') +
                    chalk.hex('#B388FF').bold(`2FA: ${this.twoFa}`) +
                    chalk.hex('#555555')(' │ ') +
                    chalk.hex('#FFA500').bold(`Dead: ${this.dead}`) +
                    chalk.hex('#555555')(' │ ') +
                    chalk.hex('#FF4466').bold(`Failed: ${this.failed}`);
            } else {
                statsSection = chalk.hex('#00D2FF').bold(`OTP Sent: ${this.otpSent}`) +
                    chalk.hex('#555555')(' │ ') +
                    chalk.hex('#FF4466').bold(`Failed: ${this.failed}`);
            }

            const line = '  ' + chalk.hex('#FF0066').bold('Scraper King') +
                chalk.hex('#555555')(' ⮞ ') +
                bar +
                chalk.hex('#888888')(` ${pctStr}%`) +
                chalk.hex('#555555')(' │ ') +
                statsSection +
                chalk.hex('#555555')(`  [${this.processed}/${this.totalNumbers}]`);
            process.stdout.write(`\r\x1b[K${line}`);
        }

        stop() {
            process.stdout.write('\x1b[2K\r\n');
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            const timeStr = `${m}m ${s}s`;

            console.log(C(`  ╔══════════════════════════════════════════════════════════╗`));
            console.log(C(`  ║`) + W.bold(`  IG ACCOUNT CREATOR — COMPLETE                           `) + C(`║`));
            console.log(C(`  ╠══════════════════════════════════════════════════════════╣`));
            console.log(C(`  ║`) + `  ${chalk.hex('#00D2FF')('OTP Sent')}       ${chalk.hex('#00D2FF')(String(this.otpSent).padStart(6))}                                     ` + C(`║`));
            if (this.isAutoConfirm) {
                console.log(C(`  ║`) + `  ${chalk.hex('#00FF88')('Confirmed')}      ${chalk.hex('#00FF88')(String(this.confirmed).padStart(6))}                                     ` + C(`║`));
                console.log(C(`  ║`) + `  ${chalk.hex('#B388FF')('2FA Enabled')}    ${chalk.hex('#B388FF')(String(this.twoFa).padStart(6))}                                     ` + C(`║`));
                console.log(C(`  ║`) + `  ${chalk.hex('#FFA500')('Dead')}           ${chalk.hex('#FFA500')(String(this.dead).padStart(6))}                                     ` + C(`║`));
            }
            console.log(C(`  ║`) + `  ${chalk.hex('#FF4466')('Failed')}         ${chalk.hex('#FF4466')(String(this.failed).padStart(6))}                                     ` + C(`║`));
            console.log(C(`  ║`) + `  ${chalk.cyan('Total Time')}     ${chalk.cyan(timeStr.padEnd(6))}                                     ` + C(`║`));
            console.log(C(`  ╚══════════════════════════════════════════════════════════╝\n`));
        }
    }

    async function selectOption(title, options) {
        return new Promise((resolve) => {
            let cursor = 0;
            process.stdin.resume();
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);

            const draw = () => {
                process.stdout.write('\x1b[2J\x1b[H');
                printHeader();
                console.log(`   \x1b[33m${title}\x1b[0m\n`);
                options.forEach((opt, idx) => {
                    if (idx === cursor) {
                        console.log(`   \x1b[36m➔\x1b[35m ${opt.name}\x1b[0m`);
                    } else {
                        console.log(`     \x1b[90m${opt.name}\x1b[0m`);
                    }
                });
            };

            draw();

            const onKeyPress = (_, key) => {
                if (key.ctrl && key.name === 'c') process.exit(0);
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
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.resume();

            const onData = (chunk) => {
                const str = chunk.toString();
                if (str.includes('\n') || str.includes('\r')) {
                    process.stdin.removeListener('data', onData);
                    input += str.split(/[\r\n]/)[0];
                    let cleanAnswer = input.trim();
                    if (cleanAnswer.startsWith('"') && cleanAnswer.endsWith('"')) cleanAnswer = cleanAnswer.slice(1, -1);
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
        let outlookConfig = null;
        let mailsinkConfig = null;
        let temptfConfig = null;
        let mailtmConfig = null;
        let mailcxConfig = null;
        let secmailConfig = null;
        let guerrillaConfig = null;
        let tempmaillolConfig = null;
        let randomTempmailConfig = null;
        let proxiesFile = 'none';
        let threads = 20;
        let deviceOpt = 'web';
        let browser = 'random';
        let languageOpt = 'en';
        let enable2fa = false;
        let passwordOpt = 'default';
        let customPasswordVal = '';

        // Nexa temporary state
        let apiKey = '';
        let ranges = [];
        let totalCount = 50;
        let serverEndpoint = '/api/v1/numbers/get';

        while (true) {
            process.stdout.write('\x1b[2J\x1b[H');
            printHeader();

            if (step === 1) {
                // Step 1: Select Target Source
                const choice = await selectOption("SELECT TARGET / INPUT SOURCE", [
                    { name: "📁 Load from file (numbers.txt)", value: "file" },
                    { name: "📧 Outlook / Hotmail (outlook.txt — Auto OTP Confirm)", value: "outlook" },
                    { name: "📬 Temp Mail Generator (Mail.cx, Mail.tm, Temp.tf, 1SecMail...)", value: "tempmail_menu" },
                    { name: "🌐 Auto fetch from NexaOTP Panel", value: "nexa" },
                    { name: "⚡ Auto fetch from Voltx (2oo9)", value: "voltx" },
                    { name: "🔥 Auto fetch from Stex (2oo9)", value: "stex" },
                    { name: "📱 Auto fetch from SMS Bower", value: "smsbower" },
                    { name: "⚡ Auto fetch from Zenex", value: "zenex" },
                    { name: "❌ Exit Program", value: "exit" }
                ]);

                if (choice === 'exit') process.exit(0);

                if (choice === 'tempmail_menu') {
                    const mailChoice = await selectOption("SELECT TEMP MAIL PROVIDER", [
                        { name: "🎲 Random Tempmail Mix (Auto OTP Confirm)", value: "random_tempmail" },
                        { name: "⚡ Mail.cx (api.mail.cx — Token, Auto OTP Confirm)", value: "mailcx" },
                        { name: "📮 Mailsink (api.mailsink.dev — Auto OTP Confirm)", value: "mailsink" },
                        { name: "🌐 Temp.tf (Multi-Domain — Auto OTP Confirm)", value: "temptf" },
                        { name: "📬 Mail.tm (api.mail.tm — Free, Auto OTP Confirm)", value: "mailtm" },
                        { name: "⏱️ 1SecMail (1secmail.com — Free, Auto OTP Confirm)", value: "secmail" },
                        { name: "🛡️ Guerrilla Mail (Free, Auto OTP Confirm)", value: "guerrilla" },
                        { name: "🚀 TempMail.lol (Free, Auto OTP Confirm)", value: "tempmaillol" },
                        { name: "⬅️ Go Back to Main Menu", value: "back" }
                    ]);
                    if (mailChoice === 'back') {
                        continue;
                    }
                    numSource = mailChoice;
                } else {
                    numSource = choice;
                }
                step = 2;
            } else if (step === 2) {
                // Step 2: Configure Selected Target Source
                if (numSource === 'file') {
                    const fileChoice = await selectOption("SELECT TARGET NUMBERS FILE", [
                        { name: "✏️ Custom File Path", value: "custom" },
                        { name: "⬅️ Go Back to Source Selection", value: "back" }
                    ]);

                    if (fileChoice === 'back') { step = 1; continue; }
                    if (fileChoice === 'custom') {
                        const input = await promptText("Enter Numbers File Path:", "numbers.txt");
                        if (input.toLowerCase() === 'back') continue;
                        numbersFile = input;
                    } else {
                        numbersFile = fileChoice;
                    }

                    if (!fs.existsSync(numbersFile)) fs.writeFileSync(numbersFile, '');
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailtmConfig = null;
                    mailcxConfig = null; secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'outlook') {
                    const otFileChoice = await selectOption("SELECT OUTLOOK / HOTMAIL FILE", [
                        { name: "✏️ Custom File Path", value: "custom" },
                        { name: "⬅️ Go Back to Source Selection", value: "back" }
                    ]);
                    if (otFileChoice === 'back') { step = 1; continue; }
                    let otPath = 'outlook.txt';
                    if (otFileChoice === 'custom') {
                        otPath = await promptText("Enter Outlook File Path:", "outlook.txt");
                        if (otPath.toLowerCase() === 'back') continue;
                    }
                    if (!fs.existsSync(otPath)) fs.writeFileSync(otPath, '');
                    const parsedAccounts = parseOutlookFile(otPath);
                    if (parsedAccounts.length === 0) {
                        console.log(chalk.red(`\n  ✗ No valid accounts found in ${otPath}`));
                        console.log(chalk.gray(`  Expected format: email:pass:refresh_token OR email|pass|refresh_token\n`));
                        const cont = await selectOption("Create sample entry or go back?", [
                            { name: "⬅️ Go Back", value: "back" },
                            { name: "Proceed anyway (empty)", value: "proceed" }
                        ]);
                        if (cont === 'back') continue;
                    }
                    outlookConfig = { filePath: otPath, accounts: parsedAccounts, totalCount: parsedAccounts.length || 1, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    mailsinkConfig = null; temptfConfig = null; mailtmConfig = null; mailcxConfig = null;
                    secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'mailcx') {
                    let cxKey = '';
                    if (fs.existsSync(MAILCX_KEY_FILE)) {
                        cxKey = fs.readFileSync(MAILCX_KEY_FILE, 'utf8').trim();
                        const ka = await selectOption(`Saved Mail.cx Key found (${cxKey.substring(0, 10)}...)`, [
                            { name: "Use saved key", value: "use" },
                            { name: "Enter new key", value: "new" },
                            { name: "Remove saved key", value: "remove" },
                            { name: "⬅️ Go Back", value: "back" }
                        ]);
                        if (ka === 'back') { step = 1; continue; }
                        if (ka === 'remove') { if (fs.existsSync(MAILCX_KEY_FILE)) fs.unlinkSync(MAILCX_KEY_FILE); cxKey = ''; }
                        else if (ka === 'new') cxKey = '';
                    }
                    if (!cxKey) {
                        cxKey = await promptText("Enter Mail.cx API Token (api.mail.cx):", "");
                        if (cxKey.toLowerCase() === 'back') { step = 1; continue; }
                        const sv = await selectOption("Save this API key?", [{ name: "Yes", value: "yes" }, { name: "No", value: "no" }]);
                        if (sv === 'yes' && cxKey) fs.writeFileSync(MAILCX_KEY_FILE, cxKey, 'utf8');
                    }
                    const totalStr = await promptText("How many accounts to create?", "50");
                    const cxTotal = parseInt(totalStr) || 50;
                    mailcxConfig = { apiKey: cxKey, domain: '9k3r.com', totalCount: cxTotal, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailtmConfig = null;
                    secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'mailsink') {
                    let sinkKey = '';
                    if (fs.existsSync(MAILSINK_KEY_FILE)) {
                        sinkKey = fs.readFileSync(MAILSINK_KEY_FILE, 'utf8').trim();
                        const ka = await selectOption(`Saved Mailsink Key found (${sinkKey.substring(0, 10)}...)`, [
                            { name: "Use saved key", value: "use" },
                            { name: "Enter new key", value: "new" },
                            { name: "Remove saved key", value: "remove" },
                            { name: "⬅️ Go Back", value: "back" }
                        ]);
                        if (ka === 'back') { step = 1; continue; }
                        if (ka === 'remove') { if (fs.existsSync(MAILSINK_KEY_FILE)) fs.unlinkSync(MAILSINK_KEY_FILE); sinkKey = ''; }
                        else if (ka === 'new') sinkKey = '';
                    }
                    if (!sinkKey) {
                        sinkKey = await promptText("Enter Mailsink API Key (api.mailsink.dev):", "");
                        if (sinkKey.toLowerCase() === 'back') { step = 1; continue; }
                        const sv = await selectOption("Save this API key?", [{ name: "Yes", value: "yes" }, { name: "No", value: "no" }]);
                        if (sv === 'yes' && sinkKey) fs.writeFileSync(MAILSINK_KEY_FILE, sinkKey, 'utf8');
                    }
                    const totalStr = await promptText("How many accounts to create?", "50");
                    mailsinkConfig = { apiKey: sinkKey, totalCount: parseInt(totalStr) || 50, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; temptfConfig = null; mailtmConfig = null; mailcxConfig = null;
                    secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'temptf') {
                    const totalStr = await promptText("How many accounts to create with Temp.tf?", "50");
                    temptfConfig = { totalCount: parseInt(totalStr) || 50, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; mailtmConfig = null; mailcxConfig = null;
                    secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'mailtm') {
                    const totalStr = await promptText("How many accounts to create with Mail.tm?", "50");
                    mailtmConfig = { totalCount: parseInt(totalStr) || 50, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailcxConfig = null;
                    secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'secmail') {
                    const totalStr = await promptText("How many accounts to create with 1SecMail?", "50");
                    secmailConfig = { totalCount: parseInt(totalStr) || 50, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailtmConfig = null;
                    mailcxConfig = null; guerrillaConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'guerrilla') {
                    const totalStr = await promptText("How many accounts to create with GuerrillaMail?", "50");
                    guerrillaConfig = { totalCount: parseInt(totalStr) || 50, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailtmConfig = null;
                    mailcxConfig = null; secmailConfig = null; tempmaillolConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'tempmaillol') {
                    const totalStr = await promptText("How many accounts to create with TempMail.lol?", "50");
                    tempmaillolConfig = { totalCount: parseInt(totalStr) || 50, autoConfirm: true };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailtmConfig = null;
                    mailcxConfig = null; secmailConfig = null; guerrillaConfig = null; randomTempmailConfig = null;
                    step = 3;
                } else if (numSource === 'random_tempmail') {
                    // 1. Mail.cx API Token (Optional)
                    let randMailcxKey = '';
                    if (fs.existsSync(MAILCX_KEY_FILE)) {
                        randMailcxKey = fs.readFileSync(MAILCX_KEY_FILE, 'utf8').trim();
                    }
                    const cxOpt = await selectOption(`Mail.cx API Token (Optional — expands Random pool):`, [
                        ...(randMailcxKey ? [{ name: `Use saved Mail.cx key (${randMailcxKey.substring(0, 10)}...)`, value: 'use_saved' }] : []),
                        { name: "✏️ Enter Mail.cx API Token", value: "enter" },
                        { name: "⚡ Skip Mail.cx (Use Free Engines Only)", value: "skip" },
                        { name: "⬅️ Go Back", value: "back" }
                    ]);
                    if (cxOpt === 'back') { step = 1; continue; }
                    if (cxOpt === 'enter') {
                        const entered = await promptText("Enter Mail.cx API Token (api.mail.cx):", "");
                        if (entered.toLowerCase() === 'back') { step = 1; continue; }
                        if (entered.trim()) {
                            randMailcxKey = entered.trim();
                            const sv = await selectOption("Save this Mail.cx key for future runs?", [{ name: "Yes", value: "yes" }, { name: "No", value: "no" }]);
                            if (sv === 'yes') fs.writeFileSync(MAILCX_KEY_FILE, randMailcxKey, 'utf8');
                        }
                    } else if (cxOpt === 'skip') {
                        randMailcxKey = '';
                    }

                    // 2. Mailsink API Key (Optional)
                    let randSinkKey = '';
                    if (fs.existsSync(MAILSINK_KEY_FILE)) {
                        randSinkKey = fs.readFileSync(MAILSINK_KEY_FILE, 'utf8').trim();
                    }
                    const sinkOpt = await selectOption(`Mailsink API Key (Optional — api.mailsink.dev):`, [
                        ...(randSinkKey ? [{ name: `Use saved Mailsink key (${randSinkKey.substring(0, 10)}...)`, value: 'use_saved' }] : []),
                        { name: "✏️ Enter Mailsink API Key", value: "enter" },
                        { name: "⚡ Skip Mailsink", value: "skip" },
                        { name: "⬅️ Go Back", value: "back" }
                    ]);
                    if (sinkOpt === 'back') { step = 1; continue; }
                    if (sinkOpt === 'enter') {
                        const enteredSink = await promptText("Enter Mailsink API Key:", "");
                        if (enteredSink.toLowerCase() === 'back') { step = 1; continue; }
                        if (enteredSink.trim()) {
                            randSinkKey = enteredSink.trim();
                            const sv = await selectOption("Save this Mailsink key for future runs?", [{ name: "Yes", value: "yes" }, { name: "No", value: "no" }]);
                            if (sv === 'yes') fs.writeFileSync(MAILSINK_KEY_FILE, randSinkKey, 'utf8');
                        }
                    } else if (sinkOpt === 'skip') {
                        randSinkKey = '';
                    }

                    const totalStr = await promptText("How many accounts to create with Random Tempmail Mix?", "50");
                    if (totalStr.toLowerCase() === 'back') { step = 1; continue; }
                    const rTotal = parseInt(totalStr) || 50;

                    randomTempmailConfig = {
                        totalCount: rTotal,
                        mailcxApiKey: randMailcxKey,
                        mailsinkApiKey: randSinkKey,
                        autoConfirm: true
                    };
                    nexaConfig = null; twoOoConfig = null; smsBowerConfig = null; zenexConfig = null;
                    outlookConfig = null; mailsinkConfig = null; temptfConfig = null; mailtmConfig = null;
                    mailcxConfig = null; secmailConfig = null; guerrillaConfig = null; tempmaillolConfig = null;
                    step = 3;
                } else if (numSource === 'voltx' || numSource === 'stex') {
                    // ── 2oo9 Sub-Wizard (Voltx / Stex) ─────────────────
                    const providerLabel = numSource === 'voltx' ? 'Voltx ⚡' : 'Stex 🔥';
                    const keyFile = numSource === 'voltx' ? VOLTX_KEY_FILE : STEX_KEY_FILE;
                    const getPath = numSource === 'voltx' ? TWOOO_VOLTX_GET : TWOOO_STEX_GET;
                    const consolePath = numSource === 'voltx' ? TWOOO_VOLTX_CONSOLE : TWOOO_STEX_CONSOLE;
                    let ooApiKey = '';
                    let ooRanges = [];
                    let ooTotal = 50;
                    let cancelOo = false;
                    let ooStep = 1;

                    while (ooStep <= 3 && !cancelOo) {
                        process.stdout.write('\x1b[2J\x1b[H');
                        printHeader();

                        if (ooStep === 1) {
                            if (fs.existsSync(keyFile)) {
                                ooApiKey = fs.readFileSync(keyFile, 'utf8').trim();
                                const keyAct = await selectOption(`Saved ${providerLabel} Key found (${ooApiKey.substring(0, 10)}...)`, [
                                    { name: "Use saved key", value: "use" },
                                    { name: "Enter new key", value: "new" },
                                    { name: "Remove saved key", value: "remove" },
                                    { name: "⬅️ Go Back to Number Source", value: "back" }
                                ]);
                                if (keyAct === 'back') { cancelOo = true; break; }
                                if (keyAct === 'remove') {
                                    if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile);
                                    ooApiKey = '';
                                } else if (keyAct === 'new') {
                                    ooApiKey = '';
                                }
                            }

                            if (!ooApiKey) {
                                ooApiKey = await promptText(`Enter ${providerLabel} API Key (mauthapi):`, '');
                                if (ooApiKey.toLowerCase() === 'back') { cancelOo = true; break; }
                                const saveKey = await selectOption("Save this API key?", [
                                    { name: "Yes, save it", value: "yes" },
                                    { name: "No", value: "no" }
                                ]);
                                if (saveKey === 'yes' && ooApiKey) {
                                    fs.writeFileSync(keyFile, ooApiKey, 'utf8');
                                }
                            }
                            if (ooApiKey) ooStep = 2;
                        } else if (ooStep === 2) {
                            const rangeMode = await selectOption("SELECT RANGE MODE", [
                                { name: "🔍 Auto Range Finder (scan console)", value: "auto" },
                                { name: "✏️  Enter range manually", value: "manual" },
                                { name: "⬅️ Go Back to API Key", value: "back" }
                            ]);
                            if (rangeMode === 'back') { ooStep = 1; continue; }
                            if (rangeMode === 'auto') {
                                const found = await autoRangeFinderFor2Oo(ooApiKey, consolePath, selectOption, promptText);
                                if (!found || found.length === 0) {
                                    console.log(chalk.red('\n  Auto Range Finder returned no ranges. Switching to manual input.\n'));
                                    await promptText('Press Enter to continue...', '');
                                    continue;
                                }
                                ooRanges = found;
                                ooStep = 3;
                            } else {
                                ooRanges = [];
                                let addMore = true;
                                while (addMore) {
                                    const r = await promptText(`Enter Range ${ooRanges.length + 1} (e.g. 26134XXX, 99890XXX — type 'done' to finish):`, '');
                                    if (r.toLowerCase() === 'back') { ooRanges = []; break; }
                                    if (r.toLowerCase() === 'done') { if (ooRanges.length > 0) addMore = false; continue; }
                                    if (r.trim()) {
                                        ooRanges.push(r.trim());
                                        const more = await selectOption(`Added "${r.trim()}". Add another range?`, [
                                            { name: "Add another", value: "yes" },
                                            { name: "Done (continue)", value: "no" }
                                        ]);
                                        if (more === 'no') addMore = false;
                                    }
                                }
                                if (ooRanges.length > 0) ooStep = 3;
                            }
                        } else if (ooStep === 3) {
                            const totalStr = await promptText(`Total numbers to process for ${providerLabel}:`, '50');
                            if (totalStr.toLowerCase() === 'back') { ooStep = 2; continue; }
                            ooTotal = parseInt(totalStr) || 50;
                            twoOoConfig = {
                                provider: numSource,
                                apiKey: ooApiKey,
                                ranges: ooRanges,
                                totalCount: ooTotal,
                                getPath,
                                consolePath
                            };
                            nexaConfig = null;
                            smsBowerConfig = null;
                            zenexConfig = null;
                            step = 3;
                            break;
                        }
                    }
                    if (cancelOo) { step = 1; continue; }
                } else if (numSource === 'smsbower') {
                    // ── SMS Bower Sub-Wizard ──────────────────────────────
                    let sbKey = '';
                    let sbService = 'ig';
                    let sbCountry = '0';
                    let sbMaxPrice = '0';
                    let sbTotal = 50;
                    let sbStep = 1;
                    let cancelSb = false;

                    while (sbStep <= 4 && !cancelSb) {
                        process.stdout.write('\x1b[2J\x1b[H');
                        printHeader();

                        if (sbStep === 1) {
                            if (fs.existsSync(SMSBOWER_KEY_FILE)) {
                                sbKey = fs.readFileSync(SMSBOWER_KEY_FILE, 'utf8').trim();
                                const ka = await selectOption(`Saved SMS Bower Key found (${sbKey.substring(0, 10)}...)`, [
                                    { name: "Use saved key", value: "use" },
                                    { name: "Enter new key", value: "new" },
                                    { name: "Remove saved key", value: "remove" },
                                    { name: "⬅️ Go Back to Number Source", value: "back" }
                                ]);
                                if (ka === 'back') { cancelSb = true; break; }
                                if (ka === 'remove') { if (fs.existsSync(SMSBOWER_KEY_FILE)) fs.unlinkSync(SMSBOWER_KEY_FILE); sbKey = ''; }
                                else if (ka === 'new') sbKey = '';
                            }
                            if (!sbKey) {
                                sbKey = await promptText("Enter SMS Bower API Key:", "");
                                if (sbKey.toLowerCase() === 'back') { cancelSb = true; break; }
                                const sv = await selectOption("Save this API key?", [{ name: "Yes", value: "yes" }, { name: "No", value: "no" }]);
                                if (sv === 'yes' && sbKey) fs.writeFileSync(SMSBOWER_KEY_FILE, sbKey, 'utf8');
                            }
                            if (sbKey) sbStep = 2;
                        } else if (sbStep === 2) {
                            const svc = await promptText("Enter Service Code (default 'ig' for Instagram, 'fb' for Facebook):", "ig");
                            if (svc.toLowerCase() === 'back') { sbStep = 1; continue; }
                            sbService = svc.trim() || 'ig';
                            sbStep = 3;
                        } else if (sbStep === 3) {
                            const ctry = await promptText("Enter Country Code (0 = Any Country, or ISO code/number):", "0");
                            if (ctry.toLowerCase() === 'back') { sbStep = 2; continue; }
                            sbCountry = ctry.trim() || '0';
                            sbStep = 4;
                        } else if (sbStep === 4) {
                            const tot = await promptText("Total numbers to process:", "50");
                            if (tot.toLowerCase() === 'back') { sbStep = 3; continue; }
                            sbTotal = parseInt(tot) || 50;
                            smsBowerConfig = { apiKey: sbKey, service: sbService, country: sbCountry, maxPrice: sbMaxPrice, totalCount: sbTotal };
                            nexaConfig = null; twoOoConfig = null; zenexConfig = null;
                            step = 3;
                            break;
                        }
                    }
                    if (cancelSb) { step = 1; continue; }
                } else if (numSource === 'zenex') {
                    // ── Zenex Sub-Wizard ──────────────────────────────────
                    let zKey = '';
                    let zRanges = [];
                    let zTotal = 50;
                    let zStep = 1;
                    let cancelZ = false;

                    while (zStep <= 3 && !cancelZ) {
                        process.stdout.write('\x1b[2J\x1b[H');
                        printHeader();

                        if (zStep === 1) {
                            if (fs.existsSync(ZENEX_KEY_FILE)) {
                                zKey = fs.readFileSync(ZENEX_KEY_FILE, 'utf8').trim();
                                const ka = await selectOption(`Saved Zenex Key found (${zKey.substring(0, 10)}...)`, [
                                    { name: "Use saved key", value: "use" },
                                    { name: "Enter new key", value: "new" },
                                    { name: "Remove saved key", value: "remove" },
                                    { name: "⬅️ Go Back to Number Source", value: "back" }
                                ]);
                                if (ka === 'back') { cancelZ = true; break; }
                                if (ka === 'remove') { if (fs.existsSync(ZENEX_KEY_FILE)) fs.unlinkSync(ZENEX_KEY_FILE); zKey = ''; }
                                else if (ka === 'new') zKey = '';
                            }
                            if (!zKey) {
                                zKey = await promptText("Enter Zenex API Key (mapikey):", "");
                                if (zKey.toLowerCase() === 'back') { cancelZ = true; break; }
                                const sv = await selectOption("Save this API key?", [{ name: "Yes", value: "yes" }, { name: "No", value: "no" }]);
                                if (sv === 'yes' && zKey) fs.writeFileSync(ZENEX_KEY_FILE, zKey, 'utf8');
                            }
                            if (zKey) zStep = 2;
                        } else if (zStep === 2) {
                            zRanges = [];
                            let addMore = true;
                            while (addMore) {
                                const r = await promptText(`Enter Range ${zRanges.length + 1} (e.g. 26134XXX — type 'done' to finish):`, '');
                                if (r.toLowerCase() === 'back') { zRanges = []; break; }
                                if (r.toLowerCase() === 'done') { if (zRanges.length > 0) addMore = false; continue; }
                                if (r.trim()) {
                                    zRanges.push(r.trim());
                                    const more = await selectOption(`Added "${r.trim()}". Add another range?`, [
                                        { name: "Add another", value: "yes" },
                                        { name: "Done (continue)", value: "no" }
                                    ]);
                                    if (more === 'no') addMore = false;
                                }
                            }
                            if (zRanges.length > 0) zStep = 3;
                        } else if (zStep === 3) {
                            const tot = await promptText("Total numbers to process for Zenex:", "50");
                            if (tot.toLowerCase() === 'back') { zStep = 2; continue; }
                            zTotal = parseInt(tot) || 50;
                            zenexConfig = { apiKey: zKey, ranges: zRanges, totalCount: zTotal };
                            nexaConfig = null; twoOoConfig = null; smsBowerConfig = null;
                            step = 3;
                            break;
                        }
                    }
                    if (cancelZ) { step = 1; continue; }
                } else if (numSource === 'nexa') {
                    // ── NexaOTP Sub-Wizard ─────────────────────────────
                    let nexaStep = 1;
                    let cancelNexa = false;

                    while (nexaStep <= 3 && !cancelNexa) {
                        process.stdout.write('\x1b[2J\x1b[H');
                        printHeader();

                        if (nexaStep === 1) {
                            if (fs.existsSync(NEXA_KEY_FILE)) {
                                apiKey = fs.readFileSync(NEXA_KEY_FILE, 'utf8').trim();
                                const keyAction = await selectOption(`Saved NexaOTP Key found (${apiKey.substring(0, 10)}...)`, [
                                    { name: "Use saved key", value: "use" },
                                    { name: "Enter new key", value: "new" },
                                    { name: "Remove saved key", value: "remove" },
                                    { name: "⬅️ Go Back to Number Source", value: "back" }
                                ]);
                                if (keyAction === 'back') { cancelNexa = true; break; }
                                if (keyAction === 'remove') {
                                    if (fs.existsSync(NEXA_KEY_FILE)) fs.unlinkSync(NEXA_KEY_FILE);
                                    apiKey = '';
                                } else if (keyAction === 'new') {
                                    apiKey = '';
                                }
                            }

                            if (!apiKey) {
                                apiKey = await promptText("Enter NexaOTP API Key (X-API-Key):", "");
                                if (apiKey.toLowerCase() === 'back') { cancelNexa = true; break; }
                                const saveKey = await selectOption("Save this API key for future runs?", [
                                    { name: "Yes, save it", value: "yes" },
                                    { name: "No, ask every time", value: "no" }
                                ]);
                                if (saveKey === 'yes' && apiKey) {
                                    fs.writeFileSync(NEXA_KEY_FILE, apiKey, 'utf8');
                                }
                            }
                            if (apiKey) nexaStep = 2;
                        } else if (nexaStep === 2) {
                            ranges = [];
                            let addMore = true;
                            while (addMore) {
                                const r = await promptText(`Enter Range ${ranges.length + 1} (e.g. 26134XXX, 99890XXX — type 'done' to finish):`, "");
                                if (r.toLowerCase() === 'back') { ranges = []; break; }
                                if (r.toLowerCase() === 'done') { if (ranges.length > 0) addMore = false; continue; }
                                if (r.trim()) {
                                    ranges.push(r.trim());
                                    const more = await selectOption(`Added "${r.trim()}". Add another range?`, [
                                        { name: "Add another range", value: "yes" },
                                        { name: "Done (continue)", value: "no" }
                                    ]);
                                    if (more === 'no') addMore = false;
                                }
                            }
                            if (ranges.length > 0) nexaStep = 3;
                        } else if (nexaStep === 3) {
                            const totalStr = await promptText("Total numbers to process:", "50");
                            if (totalStr.toLowerCase() === 'back') { nexaStep = 2; continue; }
                            totalCount = parseInt(totalStr) || 50;

                            const endpointChoice = await selectOption("Select Server / Service Endpoint:", [
                                { name: "Default (/api/v1/numbers/get)", value: "/api/v1/numbers/get" },
                                { name: "Server 1 (/api/v1/numbers/server1)", value: "/api/v1/numbers/server1" },
                                { name: "Server 2 (/api/v1/numbers/server2)", value: "/api/v1/numbers/server2" },
                                { name: "Server 3 (/api/v1/numbers/server3)", value: "/api/v1/numbers/server3" },
                                { name: "✏️ Custom Endpoint", value: "custom" }
                            ]);
                            if (endpointChoice === 'custom') {
                                serverEndpoint = await promptText("Enter Endpoint Path:", "/api/v1/numbers/get");
                            } else {
                                serverEndpoint = endpointChoice;
                            }

                            nexaConfig = { apiKey, ranges, totalCount, serverEndpoint };
                            twoOoConfig = null;
                            smsBowerConfig = null;
                            zenexConfig = null;
                            step = 3;
                            break;
                        }
                    }
                    if (cancelNexa) { step = 1; continue; }
                }
            } else if (step === 3) {
                // Step 3: Proxies File
                const proxyChoice = await selectOption("SELECT PROXIES FILE", [
                    { name: "✏️ Custom File Path", value: "custom" },
                    { name: "🚫 None (Direct Connection)", value: "none" },
                    { name: "⬅️ Go Back to Target Selection", value: "back" }
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
                const choice = await selectOption("SELECT THREADS", [
                    { name: "10 Threads", value: 10 },
                    { name: "20 Threads (Default)", value: 20 },
                    { name: "50 Threads (Fast)", value: 50 },
                    { name: "100 Threads (Extreme)", value: 100 },
                    { name: "✏️ Custom Thread Count", value: "custom" },
                    { name: "⬅️ Go Back to Proxies Selection", value: "back" }
                ]);
                if (choice === 'back') {
                    step = 3;
                    continue;
                }
                if (choice === 'custom') {
                    const customThreads = await promptText("Enter Number of Threads (1-500):", "20");
                    if (customThreads.toLowerCase() === 'back') continue;
                    threads = Math.max(1, Math.min(500, parseInt(customThreads) || 20));
                } else {
                    threads = choice;
                }
                step = 5;
            } else if (step === 5) {
                // Step 5: Device / Platform Selection
                const choice = await selectOption("SELECT DEVICE / PLATFORM", [
                    { name: "🎲 Random Mix (Both Web & Mobile)", value: "random" },
                    { name: "🌐 Web Desktop (GraphQL Flow)", value: "web" },
                    { name: "📱 Mobile Web (WBloks Flow)", value: "mobile" },
                    { name: "⬅️ Go Back to Threads Selection", value: "back" }
                ]);
                if (choice === 'back') {
                    step = 4;
                    continue;
                }
                deviceOpt = choice;
                step = 6;
            } else if (step === 6) {
                // Step 6: Browser Profile
                const choice = await selectOption("SELECT BROWSER PROFILE", [
                    { name: "🎲 Random Mix", value: "random" },
                    { name: "🌐 Google Chrome", value: "chrome" },
                    { name: "📱 Samsung Internet", value: "samsung" },
                    { name: "🦊 Mozilla Firefox", value: "firefox" },
                    { name: "🌊 Microsoft Edge", value: "edge" },
                    { name: "⬅️ Go Back to Device Selection", value: "back" }
                ]);
                if (choice === 'back') {
                    step = 5;
                    continue;
                }
                browser = choice;
                step = 7;
            } else if (step === 7) {
                // Step 7: Accept-Language
                const choice = await selectOption("SELECT ACCEPT-LANGUAGE", [
                    { name: "🌍 Auto Language (Randomly choose from 194 countries)", value: "auto" },
                    { name: "🇬🇧 Default (en-US,en;q=0.9)", value: "en" },
                    { name: "✏️ Custom Input", value: "custom" },
                    { name: "⬅️ Go Back to Browser Selection", value: "back" }
                ]);
                if (choice === 'back') {
                    step = 6;
                    continue;
                }
                languageOpt = choice;
                if (languageOpt === 'custom') {
                    const customLang = await promptText("Enter custom Accept-Language (type 'back' to go back):", "en-US,en;q=0.9");
                    if (customLang.toLowerCase() === 'back') {
                        step = 7;
                        continue;
                    }
                    languageOpt = customLang;
                }

                // If running phone numbers / SMS sending mode (non auto-confirming), complete wizard here
                const isAutoConfirmSource = ['outlook', 'mailcx', 'mailsink', 'temptf', 'mailtm', 'secmail', 'guerrilla', 'tempmaillol', 'random_tempmail'].includes(numSource);
                if (!isAutoConfirmSource) {
                    enable2fa = false;
                    passwordOpt = 'default';
                    customPasswordVal = '';
                    step = 10; // Wizard complete
                } else {
                    step = 8;
                }
            } else if (step === 8) {
                // Step 8: 2FA Authentication
                const choice = await selectOption("ENABLE 2FA AUTHENTICATION?", [
                    { name: "🛡️ Yes (Enable 2FA on Confirmed Accounts)", value: true },
                    { name: "⚡ No (Skip 2FA, Fast Confirm Only)", value: false },
                    { name: "⬅️ Go Back to Language Selection", value: "back" }
                ]);
                if (choice === 'back') {
                    step = 7;
                    continue;
                }
                enable2fa = choice;
                step = 9;
            } else if (step === 9) {
                // Step 9: Password Configuration
                const choice = await selectOption("SELECT PASSWORD FORMAT", [
                    { name: "🛡️ Default (ScraperKing###Date — e.g. ScraperKing@7#19082026)", value: "default" },
                    { name: "🎲 Strong Random (12-char mixed letters, digits, symbols)", value: "random" },
                    { name: "✏️ Custom Fixed Password / Custom Pattern", value: "custom" },
                    { name: "⬅️ Go Back to 2FA Selection", value: "back" }
                ]);
                if (choice === 'back') {
                    step = 8;
                    continue;
                }
                passwordOpt = choice;
                if (passwordOpt === 'custom') {
                    const customPass = await promptText("Enter Custom Password or Pattern (type 'back' to go back):", "ScraperKing@2026#");
                    if (customPass.toLowerCase() === 'back') {
                        step = 9;
                        continue;
                    }
                    customPasswordVal = customPass;
                }
                step = 10; // Wizard Complete!
            } else if (step === 10) {
                break;
            }
        }

        process.stdin.pause();
        return {
            numbersFile,
            threads: String(threads),
            proxiesFile,
            deviceOpt,
            browser,
            nexaConfig,
            twoOoConfig,
            smsBowerConfig,
            zenexConfig,
            outlookConfig,
            mailsinkConfig,
            temptfConfig,
            mailtmConfig,
            mailcxConfig,
            secmailConfig,
            guerrillaConfig,
            tempmaillolConfig,
            randomTempmailConfig,
            languageOpt,
            enable2fa,
            passwordOpt,
            customPasswordVal
        };
    }

    // ── HWID: Multi-source hardware fingerprint ───────────────────
    // Sources: MachineGuid + CPU ID + C: disk serial + Motherboard serial
    // All are hardware-burned — unaffected by VPN, MAC spoofing, network changes
    function generateHWID() {
        const os = require('os');
        const osType = os.platform();

        try {
            if (osType === 'win32') {
                // Single PowerShell call — collects all 4 hardware sources at once
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

                // SHA-256 of all 4 sources combined → format as SKING-XXXXXXXX-XXXX-XXXX
                const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
                return 'SKING-' + hash.substring(0, 8) + '-' + hash.substring(8, 12) + '-' + hash.substring(12, 16);

            } else {
                // ── Android (Termux) / Linux / Mac ─────────────────────
                let sources = [];

                // Source 1: Android ID (Termux)
                try {
                    const androidId = execSync('settings get secure android_id 2>/dev/null || echo ""', { stdio: 'pipe', timeout: 5000 }).toString().trim();
                    if (androidId && androidId !== 'null') sources.push('A:' + androidId);
                } catch (_) { }

                // Source 2: CPU info
                try {
                    if (fs.existsSync('/proc/cpuinfo')) {
                        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                        const serialMatch = cpuinfo.match(/Serial\s*:\s*(\S+)/i);
                        const hardwareMatch = cpuinfo.match(/Hardware\s*:\s*(.+)/i);
                        if (serialMatch && serialMatch[1] !== '0000000000000000') sources.push('S:' + serialMatch[1].trim());
                        if (hardwareMatch) sources.push('H:' + hardwareMatch[1].trim());
                    }
                } catch (_) { }

                // Source 3: Machine ID (Linux)
                try {
                    if (fs.existsSync('/etc/machine-id')) {
                        const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
                        if (machineId) sources.push('M:' + machineId);
                    }
                } catch (_) { }

                // Source 4: OS Fingerprint (Stable across reboots, unforgeable by user)
                try {
                    const cpus = os.cpus();
                    const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : 'UnknownCPU';
                    const totalMem = os.totalmem();
                    const release = os.release();
                    const hostname = os.hostname();
                    sources.push(`F:${cpuModel}|${totalMem}|${release}|${hostname}`);
                } catch (_) { }

                // Hash whatever stable sources we gathered
                const combined = sources.join('||');
                const hash = crypto.createHash('sha256').update(combined).digest('hex').toUpperCase();

                // Return deterministic ANKING- ID (No cache files used anymore)
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
        // ── HWID: Generated from hardware (no CLI bypass) ─────────
        const hwid = generateHWID();

        if (!hwid) {
            console.error(R(`\n  ✗ Could not generate Hardware ID. Run on Windows.\n`));
            process.exit(1);
        }

        // ── Anti-tamper: regenerate HWID and compare ──────────────
        const hwidVerify = generateHWID();
        if (hwidVerify !== hwid) {
            console.error(R(`\n  ✗ HWID integrity check failed. Tampering detected.\n`));
            process.exit(1);
        }

        // ── SHOW HWID BEFORE LICENSE CHECK ───────────────────────
        printHeader();
        console.log(W('┌──────────────────────────────────────────────┐'));
        console.log(W('│ [•] Tool      : ') + B('IG Account Creator           ') + W('│'));
        console.log(W('│ [•] Your HWID : ') + C(hwid.padEnd(29)) + W('│'));
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
                    app_id: 'ig',
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
                    console.error(R(`  ║    ✗ UNAUTHORIZED HARDWARE — IG TOOL        ║`));
                    console.error(R(`  ╠══════════════════════════════════════════════╣`));
                    console.error(R(`  ║  HWID   : `) + Y(hwid.padEnd(33)) + R(`║`));
                    console.error(R(`  ║  Status : ${reason.padEnd(26)}║`));
                    console.error(R(`  ║  Contact: t.me/scraper_king to register     ║`));
                    console.error(R(`  ╚══════════════════════════════════════════════╝\n`));
                    process.exit(1);
                }

                // Verify the cryptographic signature (Ed25519)
                const payloadToVerify = `${hwid}|ig|2.0.2|${reqTimestamp}`;

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

                const globalPingInterval = setInterval(() => {
                    if (!sessionToken) {
                        console.error(R(`\n  ✗ Session Token lost. Aborting...\n`));
                        process.exit(1);
                    }

                    const pingData = JSON.stringify({
                        hwid: hwid,
                        app_id: 'ig',
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
                        timeout: 15000 // 15 seconds timeout
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

                // Allow process to exit normally without waiting for this interval
                if (globalPingInterval && globalPingInterval.unref) globalPingInterval.unref();

            }
        } catch (e) {
            console.error(R(`\n  ✗ License server is currently undergoing maintenance or is unreachable.`));
            console.error(R(`    Error: ${e.message}`));
            console.error(R(`    Please check your internet connection or try again later.\n`));
            process.exit(1);
        }

        // ── Explicit license gate ─────────────────────────────────
        if (!licenseValid) {
            console.error(R(`\n  ✗ License verification failed. Exiting.\n`));
            process.exit(1);
        }

        let cliArgs = process.argv.slice(2);
        let wizardResult = null;
        let nexaConfig = null;
        let twoOoConfig = null;
        let smsBowerConfig = null;
        let zenexConfig = null;
        let outlookConfig = null;
        let mailsinkConfig = null;
        let temptfConfig = null;
        let mailtmConfig = null;
        let mailcxConfig = null;
        let secmailConfig = null;
        let guerrillaConfig = null;
        let tempmaillolConfig = null;
        let randomTempmailConfig = null;

        if (cliArgs.length === 0) {
            wizardResult = await interactiveWizard();
        }

        let numbersFile, workersCount, proxiesFile, deviceOpt, browserOpt, languageOpt, enable2faOpt, passwordOpt, customPasswordVal;

        if (wizardResult && typeof wizardResult === 'object' && !Array.isArray(wizardResult)) {
            numbersFile = path.resolve(wizardResult.numbersFile || 'numbers.txt');
            workersCount = parseInt(wizardResult.threads) || 20;
            proxiesFile = wizardResult.proxiesFile || '';
            if (proxiesFile.toLowerCase() === 'none') proxiesFile = '';
            deviceOpt = wizardResult.deviceOpt || 'web';
            browserOpt = wizardResult.browser || 'random';
            nexaConfig = wizardResult.nexaConfig || null;
            twoOoConfig = wizardResult.twoOoConfig || null;
            smsBowerConfig = wizardResult.smsBowerConfig || null;
            zenexConfig = wizardResult.zenexConfig || null;
            outlookConfig = wizardResult.outlookConfig || null;
            mailsinkConfig = wizardResult.mailsinkConfig || null;
            temptfConfig = wizardResult.temptfConfig || null;
            mailtmConfig = wizardResult.mailtmConfig || null;
            mailcxConfig = wizardResult.mailcxConfig || null;
            secmailConfig = wizardResult.secmailConfig || null;
            guerrillaConfig = wizardResult.guerrillaConfig || null;
            tempmaillolConfig = wizardResult.tempmaillolConfig || null;
            randomTempmailConfig = wizardResult.randomTempmailConfig || null;
            languageOpt = wizardResult.languageOpt || 'en';
            enable2faOpt = !!wizardResult.enable2fa;
            passwordOpt = wizardResult.passwordOpt || 'default';
            customPasswordVal = wizardResult.customPasswordVal || '';
        } else {
            // Legacy CLI args
            const args = wizardResult || cliArgs;
            numbersFile = path.resolve(args[0] || 'numbers.txt');
            workersCount = parseInt(args[1]) || 20;
            proxiesFile = args[2] !== undefined ? args[2] : 'proxies.txt';
            if (proxiesFile.toLowerCase() === 'none') proxiesFile = '';
            deviceOpt = 'web';
            browserOpt = args[3] || 'random';
            languageOpt = args[4] || 'en';
            enable2faOpt = false;
            passwordOpt = 'default';
            customPasswordVal = '';
        }

        printHeader();
        console.log(B(`  ✓ License: ${licenseUser}`) + G(` | HWID: ${hwid}`));

        let runningTool = true;

        while (runningTool) {
            let numbers = [];
            let nexaBuffer = [];
            let nexaFeederDone = false;
            let nexaFetched = 0;
            let nexaFailed = 0;
            let nexaWaiters = [];

            const activeEmailConfig = outlookConfig || mailcxConfig || mailsinkConfig || temptfConfig || mailtmConfig || secmailConfig || guerrillaConfig || tempmaillolConfig || randomTempmailConfig;
            const activeConfig = nexaConfig || twoOoConfig || smsBowerConfig || zenexConfig || activeEmailConfig;

            if (nexaConfig || twoOoConfig) {
                const providerTag = nexaConfig ? 'NexaOTP' : (twoOoConfig.provider === 'voltx' ? 'Voltx ⚡' : 'Stex 🔥');
                console.log(Y(`\n  [${providerTag}] Streaming ${activeConfig.totalCount} numbers (${activeConfig.ranges.length} range(s))...`));

                (async () => {
                    let consecutiveFails = 0;
                    let lastError = '';
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
                                    const waiter = nexaWaiters.shift();
                                    waiter(num);
                                } else {
                                    nexaBuffer.push(num);
                                }
                            }
                        } catch (e) {
                            nexaFailed++;
                            lastError = e.message;
                            consecutiveFails++;
                            if (e.message.includes('Insufficient balance')) {
                                console.error(R(`\n  [${providerTag}] ✗ Insufficient balance — aborting.\n`));
                                break;
                            }
                            if (e.message.includes('No numbers available')) { continue; }
                            if (consecutiveFails >= 5 && nexaFetched === 0) {
                                console.error(R(`\n  [${providerTag}] ✗ Aborting — 5 consecutive fetch failures.`));
                                break;
                            }
                        }
                    }
                    nexaFeederDone = true;
                    for (const waiter of nexaWaiters) waiter(null);
                    nexaWaiters = [];
                })();
            } else if (smsBowerConfig) {
                const sbCfg = smsBowerConfig;
                console.log(Y(`\n  [📱 SMS Bower] Streaming ${sbCfg.totalCount} numbers...`));
                (async () => {
                    let consecutiveFails = 0;
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
                    nexaFeederDone = true; for (const waiter of nexaWaiters) waiter(null); nexaWaiters = [];
                })();
            } else if (zenexConfig) {
                const zCfg = zenexConfig;
                console.log(Y(`\n  [⚡ Zenex] Streaming ${zCfg.totalCount} numbers (${zCfg.ranges.length} range(s))...`));
                (async () => {
                    let consecutiveFails = 0;
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
                    nexaFeederDone = true; for (const waiter of nexaWaiters) waiter(null); nexaWaiters = [];
                })();
            } else if (outlookConfig) {
                console.log(Y(`\n  [📧 Outlook] Loaded ${outlookConfig.accounts.length} accounts from ${outlookConfig.filePath}...`));
            } else if (activeEmailConfig) {
                const tag = mailcxConfig ? 'Mail.cx ⚡' : (mailsinkConfig ? 'Mailsink 📮' : (temptfConfig ? 'Temp.tf 🌐' : (mailtmConfig ? 'Mail.tm 📬' : (secmailConfig ? '1SecMail ⏱️' : (guerrillaConfig ? 'Guerrilla 🛡️' : (tempmaillolConfig ? 'TempMail.lol 🚀' : 'Random Tempmail 🎲'))))));
                console.log(Y(`\n  [${tag}] Auto Generating & Confirming ${activeEmailConfig.totalCount} accounts...`));
            } else {
                // File Mode — numbers.txt
                if (!fs.existsSync(numbersFile)) {
                    console.error(R(`✗ Error: Numbers file not found: ${numbersFile}`));
                    process.exit(1);
                }
                numbers = fs.readFileSync(numbersFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 5);
            }

            let rawProxies = [];
            if (proxiesFile && fs.existsSync(proxiesFile)) {
                rawProxies = fs.readFileSync(proxiesFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
            }

            let proxies = [];
            for (const line of rawProxies) {
                const parsed = parseProxy(line);
                if (parsed) proxies.push(parsed);
            }

            if (activeConfig) {
                const pt = nexaConfig ? 'NexaOTP' : (twoOoConfig ? (twoOoConfig.provider === 'voltx' ? 'Voltx ⚡' : 'Stex 🔥') : (smsBowerConfig ? '📱 SMS Bower' : (zenexConfig ? '⚡ Zenex' : (outlookConfig ? '📧 Outlook / Hotmail' : '📬 Tempmail Auto-Confirmation'))));
                console.log(Y(`  ✓ Mode: ${pt} (${activeConfig.totalCount} items)`));
            } else {
                console.log(Y(`✓ Loaded ${numbers.length} targets`));
            }
            if (proxies.length === 0) console.log(G(`  No proxies configured (running direct)`));
            else console.log(G(`  Proxies loaded: ${proxies.length}`));
            console.log(C(`✓ Threads: ${workersCount}`));
            console.log(C(`✓ Device : ${deviceOpt === 'web' ? '🌐 Web Desktop (GraphQL)' : (deviceOpt === 'mobile' ? '📱 Mobile Web (WBloks)' : '🎲 Random Mix (Web + Mobile)')}`));
            console.log(C(`✓ Browser: ${browserOpt}`));

            let displayLang = languageOpt === 'auto' ? 'Auto (194 Countries)' : (languageOpt === 'en' ? 'Default (en)' : `Custom (${languageOpt})`);
            console.log(C(`✓ Language: ${displayLang}\n`));

            // ── Output Directory Resolution ──
            // Android: /storage/emulated/0/Scraper-King/
            // PC: Same directory as user's input proxy / outlook / numbers file
            let outputDir = __dirname;
            const isAndroid = process.platform === 'android' ||
                fs.existsSync('/storage/emulated/0') ||
                (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) ||
                (process.env.ANDROID_ROOT && fs.existsSync('/storage/emulated/0'));

            if (isAndroid && fs.existsSync('/storage/emulated/0')) {
                const androidFolder = '/storage/emulated/0/Scraper-King';
                try {
                    if (!fs.existsSync(androidFolder)) fs.mkdirSync(androidFolder, { recursive: true });
                    outputDir = androidFolder;
                } catch (_) { }
            } else {
                const candidateFiles = [
                    outlookConfig?.filePath,
                    proxiesFile,
                    numbersFile
                ];
                for (const cand of candidateFiles) {
                    if (cand && typeof cand === 'string' && cand.trim() && cand.toLowerCase() !== 'none') {
                        try {
                            const dir = path.dirname(path.resolve(cand));
                            if (fs.existsSync(dir)) {
                                outputDir = dir;
                                break;
                            }
                        } catch (_) { }
                    }
                }
            }

            const CONFIRMED_FILE = path.join(outputDir, 'confirmed.txt');
            const CONFIRMED_CSV_FILE = path.join(outputDir, 'confirmed.csv');
            const CONFIRMED_XLS_FILE = path.join(outputDir, 'confirmed.xls');
            const TWO_FA_FILE = path.join(outputDir, '2fa.txt');
            const CHECKPOINT_FILE = path.join(outputDir, 'checkpoint.txt');
            const SUCCESSFUL_FILE = path.join(outputDir, 'successful.txt');
            const FAILED_FILE = path.join(outputDir, 'failed.txt');
            const DEBUG_FILE = path.join(outputDir, 'debug.txt');

            if (outputDir !== __dirname) {
                console.log(G(`  📁 Output Directory: ${outputDir}\n`));
            }

            fs.writeFileSync(SUCCESSFUL_FILE, '');
            fs.writeFileSync(FAILED_FILE, '');
            if (!fs.existsSync(CONFIRMED_FILE)) fs.writeFileSync(CONFIRMED_FILE, '');
            if (!fs.existsSync(TWO_FA_FILE)) fs.writeFileSync(TWO_FA_FILE, '');
            if (!fs.existsSync(CHECKPOINT_FILE)) fs.writeFileSync(CHECKPOINT_FILE, '');
            if (ENABLE_DEBUG_LOG) fs.writeFileSync(DEBUG_FILE, `=== DEBUG SESSION ${new Date().toISOString()} ===\n`);

            const totalForDashboard = activeConfig ? activeConfig.totalCount : numbers.length;
            const isAutoConfirmMode = !!activeEmailConfig;
            const dashboard = new Dashboard(totalForDashboard, isAutoConfirmMode);

            const getRandomProxy = () => {
                if (proxies.length === 0) return null;
                const p = proxies[Math.floor(Math.random() * proxies.length)];
                return rotateSessionId(p);
            };

            let emailGeneratedCount = 0;
            const emailTotalTarget = activeEmailConfig ? activeEmailConfig.totalCount : 0;

            const pickNextTarget = async () => {
                if (nexaConfig || twoOoConfig || smsBowerConfig || zenexConfig) {
                    if (nexaBuffer.length > 0) return { contact: nexaBuffer.shift(), pollOtp: null };
                    if (nexaFeederDone) return null;
                    const num = await new Promise(resolve => { nexaWaiters.push(resolve); });
                    return num ? { contact: num, pollOtp: null } : null;
                }

                if (outlookConfig) {
                    if (outlookConfig.accounts.length === 0) return null;
                    const acc = outlookConfig.accounts.shift();
                    return {
                        contact: acc.email,
                        pass: acc.pass,
                        pollOtp: (proxy) => fetchOutlookOtp({ email: acc.email, pass: acc.pass, refreshToken: acc.refreshToken, clientId: acc.clientId, proxy })
                    };
                }

                if (mailcxConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const domains = await mailcxGetDomains(mailcxConfig.apiKey);
                    const chosenDomain = domains && domains.length > 0 ? domains[Math.floor(Math.random() * domains.length)] : (mailcxConfig.domain || '9k3r.com');
                    const acc = mailcxCreateAccount(chosenDomain);
                    return {
                        contact: acc.email,
                        pollOtp: () => mailcxPollOtp(mailcxConfig.apiKey, acc.email)
                    };
                }

                if (mailsinkConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const acc = await mailsinkCreateInbox(mailsinkConfig.apiKey);
                    return {
                        contact: acc.address || acc.email,
                        pollOtp: () => mailsinkPollOtp(mailsinkConfig.apiKey, acc.id)
                    };
                }

                if (temptfConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const acc = await temptfGetAccount();
                    return {
                        contact: acc.email,
                        pollOtp: () => temptfPollOtp(acc.email)
                    };
                }

                if (mailtmConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const acc = await mailtmCreateAccount();
                    return {
                        contact: acc.email || acc.address,
                        pollOtp: () => mailtmPollOtp(acc.token)
                    };
                }

                if (secmailConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const acc = secmailCreateAccount();
                    return {
                        contact: acc.email,
                        pollOtp: () => secmailPollOtp(acc.login, acc.domain)
                    };
                }

                if (guerrillaConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const acc = await guerrillaCreateAccount();
                    return {
                        contact: acc.email,
                        pollOtp: () => guerrillaPollOtp(acc.sidToken)
                    };
                }

                if (tempmaillolConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const acc = await tempmaillolGetAccount();
                    return {
                        contact: acc.email,
                        pollOtp: () => tempmaillolPollOtp(acc.token)
                    };
                }

                if (randomTempmailConfig) {
                    if (emailGeneratedCount >= emailTotalTarget) return null;
                    emailGeneratedCount++;
                    const currProxy = getRandomProxy();
                    const engines = ['mailtm', 'temptf', 'secmail', 'guerrilla', 'tempmaillol'];
                    if (randomTempmailConfig.mailcxApiKey) engines.push('mailcx');
                    if (randomTempmailConfig.mailsinkApiKey) engines.push('mailsink');
                    const picked = engines[Math.floor(Math.random() * engines.length)];
                    try {
                        if (picked === 'mailcx' && randomTempmailConfig.mailcxApiKey) {
                            const domains = await mailcxGetDomains(randomTempmailConfig.mailcxApiKey);
                            const chosenDomain = domains && domains.length > 0 ? domains[Math.floor(Math.random() * domains.length)] : '9k3r.com';
                            const acc = mailcxCreateAccount(chosenDomain);
                            return { contact: acc.email, pollOtp: () => mailcxPollOtp(randomTempmailConfig.mailcxApiKey, acc.email) };
                        } else if (picked === 'mailsink' && randomTempmailConfig.mailsinkApiKey) {
                            const acc = await mailsinkCreateInbox(randomTempmailConfig.mailsinkApiKey);
                            return { contact: acc.address || acc.email, pollOtp: () => mailsinkPollOtp(randomTempmailConfig.mailsinkApiKey, acc.id) };
                        } else if (picked === 'mailtm') {
                            const acc = await mailtmCreateAccount();
                            return { contact: acc.email || acc.address, pollOtp: () => mailtmPollOtp(acc.token) };
                        } else if (picked === 'temptf') {
                            const acc = await temptfGetAccount();
                            return { contact: acc.email, pollOtp: () => temptfPollOtp(acc.email) };
                        } else if (picked === 'secmail') {
                            const acc = secmailCreateAccount();
                            return { contact: acc.email, pollOtp: () => secmailPollOtp(acc.login, acc.domain) };
                        } else if (picked === 'guerrilla') {
                            const acc = await guerrillaCreateAccount();
                            return { contact: acc.email, pollOtp: () => guerrillaPollOtp(acc.sidToken) };
                        } else {
                            const acc = await tempmaillolGetAccount();
                            return { contact: acc.email, pollOtp: () => tempmaillolPollOtp(acc.token) };
                        }
                    } catch (_) {
                        const acc = secmailCreateAccount();
                        return { contact: acc.email, pollOtp: () => secmailPollOtp(acc.login, acc.domain) };
                    }
                }

                // File mode (numbers.txt)
                if (numbers.length === 0) return null;
                const idx = Math.floor(Math.random() * numbers.length);
                const contact = numbers.splice(idx, 1)[0];
                return { contact, pollOtp: null };
            };

            const initialWorkers = Math.min(workersCount, totalForDashboard || 1);
            const workerPromises = [];
            const dashboardInterval = setInterval(() => dashboard.render(), 500);

            async function processWorker(workerId) {
                while (true) {
                    let targetItem;
                    try {
                        targetItem = await pickNextTarget();
                    } catch (e) {
                        dashboard.failed++;
                        dashboard.processed++;
                        dashboard.addLog(`Target fetch error: ${e.message}`, 'error', '');
                        continue;
                    }
                    if (!targetItem || !targetItem.contact) break;

                    const contactPoint = targetItem.contact;
                    const pollOtpFn = targetItem.pollOtp;

                    try {
                        const currentProxy = getRandomProxy();
                        const WORKER_TIMEOUT = pollOtpFn ? 120000 : 45000;
                        let workerTimer;
                        const timeoutRace = new Promise((_, reject) => {
                            workerTimer = setTimeout(() => reject(new Error('worker timeout (OTP wait)')), WORKER_TIMEOUT);
                        });

                        let otpSentReported = false;
                        let result = await Promise.race([
                            createAccount(contactPoint, {
                                onStatus: (msg) => dashboard.setStatus(`Worker ${workerId}: ${msg}`),
                                onOtpSent: (target, info) => {
                                    otpSentReported = true;
                                    dashboard.otpSent++;
                                    dashboard.addLog(`Triggered OTP for ${target}`, 'otp', info);
                                },
                                proxy: currentProxy,
                                workerId: workerId,
                                devicePref: deviceOpt,
                                browserPref: browserOpt,
                                languagePref: languageOpt,
                                enable2fa: enable2faOpt,
                                passwordPref: passwordOpt,
                                customPassword: customPasswordVal,
                                pollOtp: pollOtpFn ? (() => pollOtpFn(currentProxy)) : null
                            }),
                            timeoutRace
                        ]).finally(() => clearTimeout(workerTimer));

                        const finalLang = result.langName || languageOpt;
                        const finalProxyCountry = result.proxyCountryName || 'Direct';
                        const finalNumCountry = result.numberCountryName || 'Unknown';
                        const extInfo = `- ${finalLang} - Proxy (${finalProxyCountry})`;

                        if (result.success) {
                            dashboard.processed++;

                            if (result.confirmed) {
                                dashboard.confirmed++;
                                const uidVal = result.username || result.userId || result.phone || contactPoint;
                                const passVal = result.password || '';
                                const cookieVal = result.cookies || '';
                                const twoFaKeyVal = result.twoFaKey || '';
                                if (twoFaKeyVal) {
                                    dashboard.twoFa++;
                                }
                                const outLine = `${uidVal}|${passVal}|${cookieVal}\n`;
                                fs.appendFileSync(CONFIRMED_FILE, outLine);
                                fs.appendFileSync(SUCCESSFUL_FILE, outLine);

                                const twoFaLine = `${uidVal}|${passVal}|${cookieVal}|${twoFaKeyVal}\n`;
                                fs.appendFileSync(TWO_FA_FILE, twoFaLine);

                                appendConfirmedSpreadsheet(CONFIRMED_CSV_FILE, CONFIRMED_XLS_FILE, uidVal, passVal, cookieVal, twoFaKeyVal);

                                dashboard.addLog(`🎉 Confirmed (2FA: ${twoFaKeyVal ? 'ON' : 'OFF'}): ${uidVal} | ${passVal}`, 'confirmed', extInfo);
                            } else if (!pollOtpFn) {
                                if (!otpSentReported) {
                                    dashboard.otpSent++;
                                    dashboard.addLog(`Triggered OTP for ${result.phone || contactPoint}`, 'otp', extInfo);
                                }
                                fs.appendFileSync(SUCCESSFUL_FILE, `${result.phone || contactPoint}|OTP_SENT\n`);
                            }
                        } else {
                            dashboard.processed++;
                            const errMsg = result.message || '';
                            const isCheckpoint = result.checkpoint || /checkpoint|challenge|Confirm you're human/i.test(errMsg);
                            const isDead = isCheckpoint || /suspended|disabled|banned|deactivated|account_disabled|integrity_checkpoint|user_suspended|action_blocked/i.test(errMsg);

                            if (isCheckpoint) {
                                dashboard.dead++;
                                const cpUid = result.username || result.userId || result.phone || contactPoint;
                                const cpPass = result.password || '';
                                const cpCookies = result.cookies || '';
                                const cpLine = cpPass && cpCookies ? `${cpUid}|${cpPass}|${cpCookies}\n` : `${cpUid}|${errMsg}\n`;
                                fs.appendFileSync(CHECKPOINT_FILE, cpLine);
                                fs.appendFileSync(FAILED_FILE, `${result.phone || contactPoint}|CHECKPOINT: ${errMsg}\n`);
                                dashboard.addLog(`Dead on ${result.phone || contactPoint}: Checkpoint`, 'dead', extInfo);
                            } else if (isDead) {
                                dashboard.dead++;
                                fs.appendFileSync(FAILED_FILE, `${result.phone || contactPoint}|DEAD: ${errMsg}\n`);
                                dashboard.addLog(`Dead on ${result.phone || contactPoint}: ${errMsg}`, 'dead', extInfo);
                            } else {
                                dashboard.failed++;
                                fs.appendFileSync(FAILED_FILE, `${result.phone || contactPoint}|${errMsg}\n`);
                                dashboard.addLog(`Failed on ${result.phone || contactPoint}: ${errMsg}`, 'failed', extInfo);
                            }
                        }
                    } catch (err) {
                        dashboard.processed++;
                        const errMsg = err.message || '';
                        const isCheckpoint = /checkpoint|challenge|Confirm you're human/i.test(errMsg);
                        const isDead = isCheckpoint || /suspended|disabled|banned|deactivated|account_disabled|integrity_checkpoint|user_suspended|action_blocked/i.test(errMsg);
                        if (isCheckpoint) {
                            dashboard.dead++;
                            fs.appendFileSync(CHECKPOINT_FILE, `${contactPoint}|CHECKPOINT: ${errMsg}\n`);
                            dashboard.addLog(`Dead on ${contactPoint}: Checkpoint`, 'dead', '');
                        } else if (isDead) {
                            dashboard.dead++;
                            dashboard.addLog(`Dead on ${contactPoint}: ${errMsg}`, 'dead', '');
                        } else {
                            dashboard.failed++;
                            dashboard.addLog(`Failed on ${contactPoint}: ${errMsg}`, 'failed', '');
                        }
                    }
                }
            }

            for (let i = 0; i < initialWorkers; i++) workerPromises.push(processWorker(i));
            await Promise.all(workerPromises);
            clearInterval(dashboardInterval);

            dashboard.render();
            dashboard.stop();

            // Post-run menu
            const choice = await selectOption('Processing Complete. What next?', [
                { name: `Reuse successful targets (${SUCCESSFUL_FILE})`, value: 'reuse' },
                { name: 'Go Home (Restart)', value: 'home' },
                { name: 'Exit', value: 'exit' }
            ]);

            if (choice === 'reuse') {
                if (fs.existsSync(SUCCESSFUL_FILE)) {
                    let successData = fs.readFileSync(SUCCESSFUL_FILE, 'utf8').split('\n').map(l => l.split('|')[0].trim()).filter(l => l.length > 5);
                    fs.writeFileSync(numbersFile, successData.join('\n'));
                    fs.writeFileSync(SUCCESSFUL_FILE, '');
                    console.log(`\n  \x1b[32m✓ Copied ${successData.length} successful entries to ${numbersFile}.\x1b[0m\n`);
                } else {
                    console.log(`\n  \x1b[31m✗ No successful entries found.\x1b[0m\n`);
                    runningTool = false;
                }
            } else if (choice === 'home') {
                wizardResult = await interactiveWizard();
                if (wizardResult && typeof wizardResult === 'object' && !Array.isArray(wizardResult)) {
                    numbersFile = path.resolve(wizardResult.numbersFile || 'numbers.txt');
                    workersCount = parseInt(wizardResult.threads) || 20;
                    proxiesFile = wizardResult.proxiesFile || '';
                    if (proxiesFile.toLowerCase() === 'none') proxiesFile = '';
                    deviceOpt = wizardResult.deviceOpt || 'web';
                    browserOpt = wizardResult.browser || 'random';
                    nexaConfig = wizardResult.nexaConfig || null;
                    twoOoConfig = wizardResult.twoOoConfig || null;
                    smsBowerConfig = wizardResult.smsBowerConfig || null;
                    zenexConfig = wizardResult.zenexConfig || null;
                    outlookConfig = wizardResult.outlookConfig || null;
                    mailsinkConfig = wizardResult.mailsinkConfig || null;
                    temptfConfig = wizardResult.temptfConfig || null;
                    mailtmConfig = wizardResult.mailtmConfig || null;
                    mailcxConfig = wizardResult.mailcxConfig || null;
                    secmailConfig = wizardResult.secmailConfig || null;
                    guerrillaConfig = wizardResult.guerrillaConfig || null;
                    tempmaillolConfig = wizardResult.tempmaillolConfig || null;
                    randomTempmailConfig = wizardResult.randomTempmailConfig || null;
                    languageOpt = wizardResult.languageOpt || 'en';
                    enable2faOpt = !!wizardResult.enable2fa;
                    passwordOpt = wizardResult.passwordOpt || 'default';
                    customPasswordVal = wizardResult.customPasswordVal || '';
                }
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

