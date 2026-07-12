// ── IG Lite Account Creator (Thrift Binary Edition) ─────────────
// Features: Auto-dependency installation, Interactive CLI, Proxy Support
// Targeting: IG Lite Android App native binary Thrift protocol
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
            const npmCmd = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
            execSync(`"${npmCmd}" install https-proxy-agent socks-proxy-agent chalk@4`, { stdio: 'inherit', shell: true });
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

// ── NexaOTP Panel Integration ─────────────────────────────────
const NEXA_KEY_FILE = path.join(__dirname, 'nexa_key.txt');
const NEXA_BASE = 'http://nexaotpservice.com/api/v1';

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

// ── 3.5 Phone Dial Code to Country/Locale Map ──────────────────
const DIAL_MAP = [
    // 4-digit codes
    ['1868', 'TT', 'en_TT', '-14400'], ['1876', 'JM', 'en_JM', '-18000'], ['1809', 'DO', 'es_DO', '-14400'], ['1829', 'DO', 'es_DO', '-14400'], ['1849', 'DO', 'es_DO', '-14400'],
    // 3-digit codes
    ['375', 'BY', 'ru_BY', '10800'], ['880', 'BD', 'bn_BD', '21600'], ['855', 'KH', 'km_KH', '25200'], ['856', 'LA', 'lo_LA', '25200'],
    ['228', 'TG', 'fr_TG', '0'], ['229', 'BJ', 'fr_BJ', '3600'], ['233', 'GH', 'en_GH', '0'],
    ['234', 'NG', 'en_NG', '3600'], ['237', 'CM', 'fr_CM', '3600'], ['243', 'CD', 'fr_CD', '3600'],
    ['254', 'KE', 'sw_KE', '10800'], ['255', 'TZ', 'sw_TZ', '10800'], ['256', 'UG', 'en_UG', '10800'],
    ['260', 'ZM', 'en_ZM', '7200'], ['263', 'ZW', 'en_ZW', '7200'],
    ['212', 'MA', 'ar_MA', '0'], ['213', 'DZ', 'ar_DZ', '3600'], ['216', 'TN', 'ar_TN', '3600'],
    ['218', 'LY', 'ar_LY', '7200'], ['220', 'GM', 'en_GM', '0'],
    ['221', 'SN', 'fr_SN', '0'], ['222', 'MR', 'ar_MR', '0'], ['223', 'ML', 'fr_ML', '0'],
    ['224', 'GN', 'fr_GN', '0'], ['225', 'CI', 'fr_CI', '0'], ['226', 'BF', 'fr_BF', '0'],
    ['227', 'NE', 'fr_NE', '3600'], ['230', 'MU', 'en_MU', '14400'],
    ['231', 'LR', 'en_LR', '0'], ['232', 'SL', 'en_SL', '0'],
    ['235', 'TD', 'fr_TD', '3600'], ['236', 'CF', 'fr_CF', '3600'],
    ['238', 'CV', 'pt_CV', '-3600'], ['239', 'ST', 'pt_ST', '0'],
    ['240', 'GQ', 'es_GQ', '3600'], ['241', 'GA', 'fr_GA', '3600'], ['242', 'CG', 'fr_CG', '3600'],
    ['244', 'AO', 'pt_AO', '3600'], ['245', 'GW', 'pt_GW', '0'], ['246', 'IO', 'en_IO', '21600'],
    ['247', 'AC', 'en_AC', '0'], ['248', 'SC', 'en_SC', '14400'], ['249', 'SD', 'ar_SD', '7200'],
    ['250', 'RW', 'rw_RW', '7200'], ['251', 'ET', 'am_ET', '10800'],
    ['252', 'SO', 'so_SO', '10800'], ['253', 'DJ', 'fr_DJ', '10800'],
    ['257', 'BI', 'fr_BI', '7200'], ['258', 'MZ', 'pt_MZ', '7200'],
    ['261', 'MG', 'mg_MG', '10800'], ['262', 'RE', 'fr_RE', '14400'],
    ['264', 'NA', 'en_NA', '7200'], ['265', 'MW', 'en_MW', '7200'], ['266', 'LS', 'en_LS', '7200'],
    ['267', 'BW', 'en_BW', '7200'], ['268', 'SZ', 'en_SZ', '7200'], ['269', 'KM', 'fr_KM', '10800'],
    ['966', 'SA', 'ar_SA', '10800'], ['971', 'AE', 'ar_AE', '14400'],
    ['973', 'BH', 'ar_BH', '10800'], ['974', 'QA', 'ar_QA', '10800'],
    ['968', 'OM', 'ar_OM', '14400'], ['965', 'KW', 'ar_KW', '10800'],
    ['964', 'IQ', 'ar_IQ', '10800'], ['963', 'SY', 'ar_SY', '10800'],
    ['962', 'JO', 'ar_JO', '10800'], ['961', 'LB', 'ar_LB', '7200'],
    ['967', 'YE', 'ar_YE', '10800'],
    ['970', 'PS', 'ar_PS', '10800'], ['972', 'IL', 'he_IL', '7200'],
    ['992', 'TJ', 'tg_TJ', '18000'], ['993', 'TM', 'tk_TM', '18000'],
    ['994', 'AZ', 'az_AZ', '14400'], ['995', 'GE', 'ka_GE', '14400'],
    ['996', 'KG', 'ky_KG', '21600'], ['998', 'UZ', 'uz_UZ', '18000'],
    ['977', 'NP', 'ne_NP', '20700'], ['975', 'BT', 'dz_BT', '21600'],
    ['959', 'MM', 'my_MM', '23400'],
    ['670', 'TL', 'pt_TL', '32400'],
    ['673', 'BN', 'ms_BN', '28800'],
    ['676', 'TO', 'en_TO', '46800'], ['677', 'SB', 'en_SB', '39600'], ['678', 'VU', 'en_VU', '39600'],
    ['679', 'FJ', 'en_FJ', '43200'], ['680', 'PW', 'en_PW', '32400'],
    ['591', 'BO', 'es_BO', '-14400'], ['592', 'GY', 'en_GY', '-14400'],
    ['593', 'EC', 'es_EC', '-18000'], ['594', 'GF', 'fr_GF', '-10800'],
    ['595', 'PY', 'es_PY', '-14400'], ['596', 'MQ', 'fr_MQ', '-14400'],
    ['597', 'SR', 'nl_SR', '-10800'], ['598', 'UY', 'es_UY', '-10800'],
    // 2-digit codes
    ['20', 'EG', 'ar_EG', '7200'], ['27', 'ZA', 'en_ZA', '7200'],
    ['30', 'GR', 'el_GR', '7200'], ['31', 'NL', 'nl_NL', '3600'],
    ['32', 'BE', 'nl_BE', '3600'], ['33', 'FR', 'fr_FR', '3600'],
    ['34', 'ES', 'es_ES', '3600'], ['36', 'HU', 'hu_HU', '3600'],
    ['39', 'IT', 'it_IT', '3600'], ['40', 'RO', 'ro_RO', '7200'],
    ['41', 'CH', 'de_CH', '3600'], ['43', 'AT', 'de_AT', '3600'],
    ['44', 'GB', 'en_GB', '0'], ['45', 'DK', 'da_DK', '3600'],
    ['46', 'SE', 'sv_SE', '3600'], ['47', 'NO', 'nb_NO', '3600'],
    ['48', 'PL', 'pl_PL', '3600'], ['49', 'DE', 'de_DE', '3600'],
    ['51', 'PE', 'es_PE', '-18000'], ['52', 'MX', 'es_MX', '-21600'],
    ['53', 'CU', 'es_CU', '-18000'], ['54', 'AR', 'es_AR', '-10800'],
    ['55', 'BR', 'pt_BR', '-10800'], ['56', 'CL', 'es_CL', '-14400'],
    ['57', 'CO', 'es_CO', '-18000'], ['58', 'VE', 'es_VE', '-14400'],
    ['60', 'MY', 'ms_MY', '28800'], ['61', 'AU', 'en_AU', '36000'],
    ['62', 'ID', 'id_ID', '25200'], ['63', 'PH', 'en_PH', '28800'],
    ['64', 'NZ', 'en_NZ', '43200'], ['65', 'SG', 'en_SG', '28800'],
    ['66', 'TH', 'th_TH', '25200'], ['81', 'JP', 'ja_JP', '32400'],
    ['82', 'KR', 'ko_KR', '32400'], ['84', 'VN', 'vi_VN', '25200'],
    ['86', 'CN', 'zh_CN', '28800'], ['90', 'TR', 'tr_TR', '10800'],
    ['91', 'IN', 'hi_IN', '19800'], ['92', 'PK', 'ur_PK', '18000'],
    ['93', 'AF', 'ps_AF', '16200'], ['94', 'LK', 'si_LK', '19800'],
    ['95', 'MM', 'my_MM', '23400'], ['98', 'IR', 'fa_IR', '12600'],
    // 1-digit
    ['1', 'US', 'en_US', '-18000'],
    ['7', 'RU', 'ru_RU', '10800'],
];

function getPhoneDetails(barePhone) {
    for (const [prefix, iso, locale, offset] of DIAL_MAP) {
        if (barePhone.startsWith(prefix)) {
            return { iso, locale, offset, prefix };
        }
    }
    return { iso: 'US', locale: 'en_US', offset: '-18000', prefix: '1' };
}

// ── 4. UI Rendering ────────────────────────────────────────────
let SUCCESSFUL_FILE = 'successful.txt';
let FAILED_FILE = 'failed.txt';
const DEBUG_FILE = require('path').join(__dirname, 'debug.txt');

// ── Compact debug logger (always on) ──────────────────────────
function dbg(phone, label, body, extraFields = {}) {
    try {
        const line = [
            `[${new Date().toISOString()}]`,
            `[${phone}]`,
            label,
            Object.entries(extraFields).map(([k,v]) => `${k}=${v}`).join(' '),
            body ? `| ${String(body).substring(0, 400)}` : ''
        ].filter(Boolean).join(' ');
        require('fs').appendFileSync(DEBUG_FILE, line + '\n');
    } catch (_) {}
}

// Write session header to debug file
try {
    require('fs').appendFileSync(DEBUG_FILE, `\n=== SESSION ${new Date().toISOString()} ===\n`);
} catch(_) {}

let WHATSAPP_FILE = 'whatsapp.txt';

const B = chalk.hex('#00FF88');
const C = chalk.hex('#00BFFF');
const Y = chalk.hex('#FFD700');
const W = chalk.white;
const G = chalk.gray;
const R = chalk.hex('#FF6B6B');

let globalHwid = 'Unregistered';
let globalPingInterval;

function printHeader() {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    console.log(C('   ___ ____   _     _ _       '));
    console.log(C('  |_ _/ ___| | |   (_) |_ ___ '));
    console.log(C('   | | |  _  | |   | | __/ _ \\'));
    console.log(C('   | | |_| | | |___| | ||  __/'));
    console.log(C('  |___\\____| |_____|_|\\__\\___|'));
    console.log(C('                              \n'));
    console.log(W('┌──────────────────────────────────────────────┐'));
    console.log(W('│ [•] Tool      : ') + C('IG Lite Thrift Creator       ') + W('│'));
    console.log(W('│ [•] Developer : ') + C('Scraper King                 ') + W('│'));
    console.log(W('│ [•] Status    : ') + G('Premium Build                ') + W('│'));
    console.log(W('│ [•] Version   : ') + C('IGLITE-V2.0.2                ') + W('│'));
    if (globalHwid !== 'Unregistered') {
        console.log(W('│ [•] HWID      : ') + Y(globalHwid.padEnd(27)) + W('│'));
    }
    console.log(W('└──────────────────────────────────────────────┘\n'));
}

// ── 4. Common Helpers ──────────────────────────────────────────
const uuid = () => crypto.randomUUID();

function normalizePhoneNumber(phone) {
    let normalized = phone.replace(/\D/g, '');
    if (!normalized.startsWith('+')) {
        normalized = '+' + normalized;
    }
    return normalized;
}

// ── 5. Proxy Management ────────────────────────────────────────
function parseProxy(str) {
    if (!str) return null;
    if (typeof str === 'object') return str;
    str = str.trim();
    if (!str) return null;
    let host, port, user, pass;
    let type = 'http';
    if (str.startsWith('socks5://')) { type = 'socks5'; str = str.slice(9); }
    else if (str.startsWith('socks4://')) { type = 'socks4'; str = str.slice(9); }
    else if (str.startsWith('http://')) { type = 'http'; str = str.slice(7); }
    else if (str.startsWith('https://')) { type = 'http'; str = str.slice(8); }

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
            if (!isNaN(parseInt(parts[3])) && isNaN(parseInt(parts[1]))) {
                user = parts[0]; pass = parts[1]; host = parts[2]; port = parseInt(parts[3]);
            } else {
                host = parts[0]; port = parseInt(parts[1]); user = parts[2]; pass = parts[3];
            }
        } else if (parts.length === 3) {
            host = parts[0]; port = parseInt(parts[1]);
            user = parts[2];
        }
    }
    if (!host || !port) return null;
    return { type, host, port, user, pass, original: str };
}

function rotateSessionId(proxy) {
    if (!proxy || !proxy.user) return proxy;
    const rotated = { ...proxy };

    // Support common residential proxy session rotation flags
    const sessionRegexes = [
        /-ssid-[A-Za-z0-9_]+/,
        /-session-[A-Za-z0-9_]+/,
        /_session_[A-Za-z0-9_]+/,
        /-sess-[A-Za-z0-9_]+/
    ];

    let rotatedFlag = false;

    for (const regex of sessionRegexes) {
        if (rotated.user && regex.test(rotated.user)) {
            const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
            rotated.user = rotated.user.replace(regex, `${regex.source.split('[')[0].replace(/\\/g, '')}${newId}`);
            rotatedFlag = true;
            break;
        }
        if (rotated.pass && regex.test(rotated.pass)) {
            const newId = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').substring(0, 10);
            rotated.pass = rotated.pass.replace(regex, `${regex.source.split('[')[0].replace(/\\/g, '')}${newId}`);
            rotatedFlag = true;
            break;
        }
    }

    return rotated;
}

function createProxyAgent(proxy) {
    if (!proxy) return null;
    let proxyUrl = '';
    if (proxy.type === 'socks5' || proxy.type === 'socks4') {
        proxyUrl = `socks5://${proxy.user ? encodeURIComponent(proxy.user) + ':' + encodeURIComponent(proxy.pass || '') + '@' : ''}${proxy.host}:${proxy.port}`;
        return new SocksProxyAgent(proxyUrl);
    } else {
        proxyUrl = `http://${proxy.user ? encodeURIComponent(proxy.user) + ':' + encodeURIComponent(proxy.pass || '') + '@' : ''}${proxy.host}:${proxy.port}`;
        return new HttpsProxyAgent(proxyUrl);
    }
}

// ── 6. HTTP Wrapper ────────────────────────────────────────────
function sendRequest(urlStr, method, headers, postData, proxyStr = null, timeout = 15000) {
    return new Promise((resolve, reject) => {
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
            ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305",
            ecdhCurve: "X25519:P-256:P-384",
            honorCipherOrder: false,
            secureOptions: require('crypto').constants.SSL_OP_NO_SSLv3 | require('crypto').constants.SSL_OP_NO_TLSv1 | require('crypto').constants.SSL_OP_NO_TLSv1_1,
            minVersion: 'TLSv1.2'
        };

        let proxy = proxyStr ? parseProxy(proxyStr) : null;
        if (proxyStr) {
            if (!proxy || isNaN(proxy.port) || proxy.port <= 0) return reject(new Error('Invalid proxy'));
            reqOpts.agent = createProxyAgent(proxy);
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

                // For binary thrift responses, converting to utf8 might mess up bytes,
                // but we will mainly check for success strings or error messages
                resolve({ status: res.statusCode, data: body.toString('utf8'), raw: body, headers: res.headers });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (postData) req.write(postData);
        req.end();
    });
}

// ── 7. Payload Generator ────────────────────────
function buildPayload(phone, deviceId, phoneDetails, stablePhoneId, stableFamilyDevId) {
    // country_codes required by IG Lite v440+ to route OTP correctly
    const countryCodes = JSON.stringify([{
        country_code: phoneDetails ? phoneDetails.prefix : '1',
        source: ['default']
    }]);

    const _uuid = crypto.randomUUID();
    // phone_id & family_device_id must stay consistent per device install
    // (real IG Lite never changes these after first install)
    const phoneId = stablePhoneId || crypto.randomUUID();
    const familyDevId = stableFamilyDevId || crypto.randomUUID();

    const data = new URLSearchParams({
        phone_number: phone,
        device_id: deviceId,
        phone_id: phoneId,
        guid: _uuid,
        _uuid: _uuid,
        waterfall_id: crypto.randomUUID(),  // waterfall_id is OK to randomize (per-flow)
        family_device_id: familyDevId,
        country_codes: countryCodes,
        android_build_type: 'release',
        qe_id: crypto.randomUUID(),         // qe_id is per-session analytics, OK to randomize
        is_secondary_account_creation: 'false'
    });
    return data.toString();
}


// ── 7.5 App ID & Bloks Version Pools (rotate to avoid per-AppID rate limiting) ──
// Multiple known IG Lite App IDs — rotate so IG sees traffic from different "installs"
const IG_APP_ID_POOL = [
    '567067343352427',   // IG Lite v1 (original)
    '1217981644879628',  // IG Lite v2
    '2028087190960484',  // IG Android (fallback)
    '936619743392459',   // IG Lite alternate
    '1419724921674105',  // IG Business variant
];

// Bloks version hashes paired to specific IG Lite APK version ranges
// Each hash corresponds to a specific compiled UI bundle — must match the UA version
const BLOKS_VERSIONS = [
    { minVer: 430, maxVer: 435, hash: 'a8b6c3f921b4be8c739c13ef7c2e9d0f12a4567cdabb8b40a71dfa64b5a7f4be4a' },
    { minVer: 436, maxVer: 441, hash: 'ce555e5500576acd8e84a66e8f9d0f35b35564cebb7b40a71dfa64b5a7f4be4a' },
    { minVer: 442, maxVer: 447, hash: 'b9d2e1f045786acd9f95b77e8f9d0f35c46675dfcc8c51b82egb75c6b8g5cf5b' },
    { minVer: 448, maxVer: 453, hash: 'f12a4567cdabb8b40a71dfa64b5a7f4be4ace555e5500576acd8e84a66e8f9d0f' },
    { minVer: 454, maxVer: 460, hash: '3d9c2f1b567aef84c92b6d1e0f45867abd9834ceeff7740b82fgc85d7c9f6de6c' },
];

function getBloksVersionForAppVer(verMajor) {
    for (const entry of BLOKS_VERSIONS) {
        if (verMajor >= entry.minVer && verMajor <= entry.maxVer) return entry.hash;
    }
    return BLOKS_VERSIONS[1].hash; // fallback
}

// ── 7.5 User-Agent & Network Rotation ────────────
function getRandomDevice() {
    // Dynamic IG Lite Version Numbers (e.g. 445.0.0.12.110 - Production builds)
    const main = Math.floor(Math.random() * (460 - 430 + 1)) + 430;
    const mid = Math.floor(Math.random() * 20);
    const build = Math.floor(Math.random() * 200) + 100;
    const v = `${main}.0.0.${mid}.${build}`;

    const devices = [
        { manu: 'samsung', model: 'SM-G998B', name: 'p3s', cpu: 'exynos2100', dpi: '480dpi', res: '1080x2340' },
        { manu: 'samsung', model: 'SM-S901B', name: 'r0q', cpu: 'exynos2200', dpi: '480dpi', res: '1080x2340' },
        { manu: 'samsung', model: 'SM-S908B', name: 'b0q', cpu: 'exynos2200', dpi: '480dpi', res: '1080x2340' },
        { manu: 'samsung', model: 'SM-A525F', name: 'a52q', cpu: 'sm7125', dpi: '450dpi', res: '1080x2400' },
        { manu: 'samsung', model: 'SM-A536B', name: 'a53x', cpu: 'exynos1280', dpi: '450dpi', res: '1080x2400' },
        { manu: 'samsung', model: 'SM-A156E', name: 'a15x', cpu: 'mt6835', dpi: '400dpi', res: '1080x2340' },
        { manu: 'Xiaomi', model: 'M2101K6G', name: 'sweet', cpu: 'sm7150', dpi: '440dpi', res: '1080x2400' },
        { manu: 'Xiaomi', model: '2201117TG', name: 'spes', cpu: 'sm6225', dpi: '440dpi', res: '1080x2400' },
        { manu: 'Xiaomi', model: '2109119DG', name: 'lisa', cpu: 'sm7325', dpi: '400dpi', res: '1080x2400' },
        { manu: 'OnePlus', model: 'ONEPLUS A6013', name: 'OnePlus6T', cpu: 'sdm845', dpi: '420dpi', res: '1080x2340' },
        { manu: 'OnePlus', model: 'KB2003', name: 'OnePlus8T', cpu: 'sm8250', dpi: '450dpi', res: '1080x2400' },
        { manu: 'Google', model: 'Pixel 6', name: 'oriole', cpu: 'tensor', dpi: '420dpi', res: '1080x2400' },
        { manu: 'Google', model: 'Pixel 7', name: 'panther', cpu: 'tensor', dpi: '420dpi', res: '1080x2400' },
        { manu: 'Google', model: 'Pixel 8 Pro', name: 'husky', cpu: 'tensor', dpi: '450dpi', res: '1344x2992' },
        { manu: 'Oppo', model: 'CPH2173', name: 'FindX3', cpu: 'sm8350', dpi: '480dpi', res: '1080x2400' },
        { manu: 'Oppo', model: 'CPH2207', name: 'Reno5', cpu: 'sm7250', dpi: '480dpi', res: '1080x2400' },
        { manu: 'Motorola', model: 'motorola edge 30', name: 'dubai', cpu: 'sm7325', dpi: '400dpi', res: '1080x2400' },
        { manu: 'vivo', model: 'V2109', name: 'Y33s', cpu: 'mt6769', dpi: '400dpi', res: '1080x2400' },
        { manu: 'realme', model: 'RMX3363', name: 'GT_Master_Edition', cpu: 'sm7325', dpi: '480dpi', res: '1080x2400' }
    ];

    const d = devices[Math.floor(Math.random() * devices.length)];

    const androidVer = ['10', '11', '12', '13', '14', '15'][Math.floor(Math.random() * 6)];
    const androidApi = { '10': '29', '11': '30', '12': '31', '13': '33', '14': '34', '15': '35' }[androidVer];

    // Locale should match the target country, pass it in from the payload logic if possible, 
    // but default to US if not provided
    const targetLocale = arguments.length > 0 ? arguments[0] : 'en_US';

    // IG Lite version code - update to match 450M+ range
    const versionCode = Math.floor(Math.random() * 90000000) + 450000000;

    return `InstagramCarbon/${v} (Android ${androidApi}/${androidVer}; ${d.dpi}; ${d.res}; ${d.manu}; ${d.model}; ${d.name}; ${d.cpu}; ${targetLocale}; ${versionCode})`;
}

function getRandomConnectionQuality() {
    // Simulate high-speed WIFI connection to match proxy speed and prevent mismatch detection
    const rtt = Math.floor(Math.random() * 30) + 10; // 10-40ms ping
    const tbw = Math.floor(Math.random() * 8000) + 5000; // 5-13 Mbps bandwidth
    const uplat = Math.floor(Math.random() * 50) + 10; // fast upload
    return `EXCELLENT; q=0.9, rtt=${rtt}, rtx=0, c=10, mss=1400, tbw=${tbw}, tp=-1, tpl=-1, uplat=${uplat}, ullat=0`;
}

// ── 8. Core API Logic (IG Lite Binary SMS Trigger) ───────────
async function triggerSms(phone, options = {}) {
    const { onStatus = () => { }, timeout = 15000, languagePref = 'en' } = options;
    let proxy = options.proxy || null;
    const normalizedPhone = normalizePhoneNumber(phone);
    const barePhone = normalizedPhone.replace('+', '');

    // ── Stable per-number device profile (seeded from phone) ──────────────────
    // A real device keeps phone_id, family_device_id consistent across sessions.
    // We seed from phone number so the same number always gets the same device IDs
    // within a single tool run, but differs across numbers = looks like different devices.
    const phoneSeed = crypto.createHash('md5').update(barePhone + 'iglite_dev').digest('hex');
    const mkUUIDFromSeed = (extra) => {
        const h = crypto.createHash('md5').update(phoneSeed + extra).digest('hex');
        return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
    };
    const stablePhoneId      = mkUUIDFromSeed('phoneid');
    const stableFamilyDevId  = mkUUIDFromSeed('familydev');
    const deviceId = "android-" + phoneSeed.slice(0, 16);

    // Rotate App ID per number (cycle through pool based on phone number)
    const appIdIdx = parseInt(phoneSeed.slice(0, 4), 16) % IG_APP_ID_POOL.length;
    const selectedAppId = IG_APP_ID_POOL[appIdIdx];

    // Fetch proper locale and timezone from the phone number
    const phoneDetails = getPhoneDetails(barePhone);
    let langName = 'en_US';
    
    if (languagePref === 'auto') {
        langName = phoneDetails.locale;
    } else if (languagePref !== 'en') {
        let custom = languagePref.replace('=', '-').trim();
        if (custom.length === 5 && custom.includes('-')) {
            const parts = custom.split('-');
            const langOnly = parts[0].toLowerCase();
            const region = parts[1].toUpperCase();
            langName = `${langOnly}_${region}`;
        } else {
            langName = custom.replace('-', '_').split(',')[0];
        }
    } else {
        langName = 'en_US';
    }

    const regionNames = new Intl.DisplayNames(['en'], {type: 'region'});
    let numberCountryName = 'Unknown';
    try {
        const regionCode = langName.split('_')[1];
        if (regionCode) numberCountryName = regionNames.of(regionCode);
    } catch(e) {}

    let proxyCountryName = 'Direct';
    if (proxy && proxy.user) {
        const match = proxy.user.match(/(?:country|cc|cr|zone|region)[-_.]?([a-zA-Z]{2})(?:[-_.]|$)/i) || proxy.user.match(/[-_]([a-zA-Z]{2})[-_]sess/i);
        if (match) {
            try {
                proxyCountryName = regionNames.of(match[1].toUpperCase()) || match[1].toUpperCase();
            } catch(e) {
                proxyCountryName = match[1].toUpperCase();
            }
        } else {
            proxyCountryName = 'Unknown';
        }
    }

    const ua = getRandomDevice(langName);

    // Extract version major from UA to pick matching Bloks hash
    const verMajorMatch = ua.match(/InstagramCarbon\/(\d+)/);
    const verMajor = verMajorMatch ? parseInt(verMajorMatch[1]) : 440;
    const bloksVersionId = getBloksVersionForAppVer(verMajor);

    onStatus(`[1/2] Constructing Payload...`);
    const payload = buildPayload(normalizedPhone, deviceId, phoneDetails, stablePhoneId, stableFamilyDevId);

    onStatus(`[2/2] Triggering SMS (${ua.split(' ')[0]})...`);

    const url = `https://i.instagram.com/api/v1/accounts/send_signup_sms_code/`;

    // Build Accept-Language from locale (e.g. en_ZW → "en-ZW, en;q=0.9")
    const localeParts = langName.split('_');
    const acceptLang = localeParts.length === 2
        ? `${localeParts[0]}-${localeParts[1]}, ${localeParts[0]};q=0.9`
        : `${langName.replace('_', '-')};q=0.9, en;q=0.8`;

    const headers = {
        'User-Agent': ua,
        'Accept': '*/*',
        'Accept-Language': acceptLang,                    // IG varies response by this — CRITICAL
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-FB-HTTP-Engine': 'Liger',
        'x-fb-connection-quality': getRandomConnectionQuality(),
        'X-IG-Connection-Speed': Math.floor(Math.random() * 5000) + 2000 + 'kbps',
        'X-IG-Bandwidth-Speed-KBPS': '-1.000',
        'X-IG-Bandwidth-TotalBytes-B': '0',
        'X-IG-Bandwidth-TotalTime-MS': '0',
        'X-IG-App-Locale': langName,
        'X-IG-Device-Locale': langName,
        'X-IG-Mapped-Locale': langName,
        'X-IG-Timezone-Offset': phoneDetails.offset,
        'X-IG-Connection-Type': 'WIFI',
        'X-IG-Capabilities': '3brTAgE=',
        'X-IG-App-ID': selectedAppId,                    // rotates per number from App ID pool
        'X-IG-Device-ID': deviceId,
        'X-IG-Android-ID': deviceId,                     // android-<hex> format device identifier
        'X-MID': crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').substring(0, 10) + 'X8' + crypto.randomBytes(4).toString('base64').replace(/[+/=]/g, '').substring(0, 3) + 'Q',
        'X-Pigeon-Session-Id': 'UFS-' + crypto.randomUUID(),  // analytics session per request
        'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3), // unix float timestamp
        'X-Bloks-Version-Id': bloksVersionId,            // matched to UA app version — no mismatch
        'X-Bloks-Is-Layout-RTL': 'false',
        'Priority': 'u=3, i',
        'Connection': 'Keep-Alive',
    };

    let csrfToken = 'missing';
    let cookie = '';
    const sessionGuid = crypto.randomUUID();

    try {
        // ── Step 1: Pre-fetch session headers (MANDATORY — real IG Lite flow) ──────────
        // Every IG Lite client fetches /si/fetch_headers first to get a valid session
        // (csrftoken, mid, ig_did). Skipping this causes per-AppID 429 rate limiting.
        // NOTE: uses the same headers object as the SMS request so both look like the same client fingerprint.
        onStatus(`[1/3] Fetching session tokens...`);
        const fetchHeadersUrl = `https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=signup&guid=${sessionGuid.replace(/-/g, '')}`;
        try {
            const sessionRes = await sendRequest(fetchHeadersUrl, 'GET', headers, null, proxy, timeout);

            if (sessionRes.headers['set-cookie']) {
                const cookiesStr = Array.isArray(sessionRes.headers['set-cookie'])
                    ? sessionRes.headers['set-cookie'].join(';')
                    : sessionRes.headers['set-cookie'];
                const csrfMatch = cookiesStr.match(/csrftoken=([^;,\s]+)/);
                const midMatch = cookiesStr.match(/mid=([^;,\s]+)/);
                const igDidMatch = cookiesStr.match(/ig_did=([^;,\s]+)/);
                if (csrfMatch) csrfToken = csrfMatch[1];
                const parts = [];
                if (csrfToken !== 'missing') parts.push(`csrftoken=${csrfToken}`);
                if (midMatch) parts.push(`mid=${midMatch[1]}`);
                if (igDidMatch) parts.push(`ig_did=${igDidMatch[1]}`);
                cookie = parts.join('; ');
            }
            // ── Log the session fetch result ──────────────────────────────────
            const fetchStack   = sessionRes.headers['x-stack'] || 'unknown';
            const fetchPush    = sessionRes.headers['x-ig-push-state'] || '-';
            const fetchAed     = sessionRes.headers['x-aed'] || '-';
            dbg(barePhone, `FETCH_HEADERS HTTP ${sessionRes.status}`, null, {
                stack: fetchStack, 'push-state': fetchPush, aed: fetchAed,
                csrf: csrfToken !== 'missing' ? 'GOT' : 'MISSING',
                appId: selectedAppId
            });
        } catch (e) {
            // Pre-fetch failed (proxy issue) — continue without session cookies (fallback)
        }

        // ── Step 2: Send SMS trigger with fresh session ──────────────────────────────
        onStatus(`[2/3] Triggering SMS...`);
        if (csrfToken !== 'missing') {
            headers['X-CSRFToken'] = csrfToken;
            headers['Cookie'] = cookie;
        }

        // Try the SMS request
        let res = await sendRequest(url, 'POST', headers, payload, proxy, timeout);

        let dataStr = res.data;
        // ── Step 3: CSRF retry if session pre-fetch didn't get a token ───────────────
        if (res.status === 403 && dataStr.includes('CSRF')) {
            onStatus(`[3/3] CSRF retry...`);
            if (res.headers['set-cookie']) {
                const cookiesStr = Array.isArray(res.headers['set-cookie'])
                    ? res.headers['set-cookie'].join(';')
                    : res.headers['set-cookie'];
                const csrfMatch = cookiesStr.match(/csrftoken=([^;,\s]+)/);
                const midMatch = cookiesStr.match(/mid=([^;,\s]+)/);
                const igDidMatch = cookiesStr.match(/ig_did=([^;,\s]+)/);
                if (csrfMatch) csrfToken = csrfMatch[1];
                const parts = [];
                if (csrfToken !== 'missing') parts.push(`csrftoken=${csrfToken}`);
                if (midMatch) parts.push(`mid=${midMatch[1]}`);
                if (igDidMatch) parts.push(`ig_did=${igDidMatch[1]}`);
                cookie = parts.join('; ');
                headers['X-CSRFToken'] = csrfToken;
                headers['Cookie'] = cookie;
            }
            res = await sendRequest(url, 'POST', headers, payload, proxy, timeout);
            dataStr = res.data;
        }

        const proxyLog = proxy ? (proxy.host + ':' + proxy.port + ' (' + (proxy.user ? proxy.user : 'No Auth') + ')') : 'DIRECT';

        // ── Full debug log for every request ──────────────────────────────────
        const stack = res.headers['x-stack'] || 'unknown';
        const aed = res.headers['x-aed'] || '-';
        const peakTime = res.headers['x-ig-peak-time'] || '-';
        const region = res.headers['x-ig-server-region'] || res.headers['x-ig-origin-region'] || '-';
        const elapsed = res.headers['x-ig-request-elapsed-time-ms'] || '-';
        dbg(barePhone, `HTTP ${res.status}`, dataStr, {
            stack, aed, 'peak-time': peakTime, region, 'elapsed-ms': elapsed,
            proxy: proxyLog, csrf: csrfToken !== 'missing' ? 'OK' : 'MISSING',
            appId: selectedAppId, ua: ua.split(' ')[0]
        });

        // ── Stack shift detection: x-stack:www means IG is routing to web challenge layer ──
        // This appears after ~8-10 requests from same proxy IP (progressive rate limiting)
        if (stack === 'www') {
            dbg(barePhone, '⚠️  STACK SHIFT → www', 'IG is routing to web challenge layer (IP rate-limited)', { proxy: proxyLog });
        }
        // ── push-state c2 = IG has seen this device/session before (tracking across requests)
        const pushState = res.headers['x-ig-push-state'] || '-';
        if (pushState === 'c2') {
            dbg(barePhone, '📌 PUSH-STATE c2', 'IG tracking this session — proxy IP is flagged for repeat sends', { proxy: proxyLog });
        }


        if (res.status === 200) {
            // Strict success detection — must match real IG Lite binary/JSON response
            // NOT just any 200 that contains 'ok' anywhere (rate-limited responses also return 200)
            const isRealSuccess = (
                dataStr.includes('"ok"') ||
                dataStr.includes('"status":"ok"') ||
                dataStr.includes('"status": "ok"') ||
                dataStr.includes('age_required') ||      // OTP was sent; IG needs age verify next step
                dataStr.includes('age_check') ||
                /\x00\x01ok/.test(res.raw.toString('binary')) ||
                /\x00\x01success/.test(res.raw.toString('binary'))
            );

            if (isRealSuccess) {
                const tosMatch = dataStr.match(/"tos_version"\s*:\s*"([^"]+)"/);
                const tosVersion = tosMatch ? tosMatch[1].toLowerCase() : '';
                // Only WhatsApp if IG explicitly signals it — tos_version:"eu" is GDPR ToS, NOT WhatsApp routing
                const isWhatsApp = dataStr.includes('"otp_delivery_method":"whatsapp"') ||
                                   dataStr.includes('"otp_method":"whatsapp"') ||
                                   (dataStr.includes('"whatsapp"') && !dataStr.includes('"tos_version"'));
                const isAgeGated = dataStr.includes('age_required') || dataStr.includes('age_check');
                if (isWhatsApp) {
                    onStatus(`[1/1] 💬 WhatsApp OTP routed (EU number)`);
                    return { success: true, whatsapp: true, message: 'WhatsApp OTP routed (EU - not SMS)', phone: normalizedPhone, langName, proxyCountryName, numberCountryName };
                }
                if (isAgeGated) {
                    onStatus(`[1/1] ✅ SMS triggered (age gate — OTP sent)`);
                    return { success: true, whatsapp: false, ageGated: true, message: 'SMS triggered (age gate)', phone: normalizedPhone, langName, proxyCountryName, numberCountryName };
                }
                onStatus(`[1/1] ✅ SMS successfully triggered`);
                return { success: true, whatsapp: false, message: 'SMS successfully triggered', phone: normalizedPhone, langName, proxyCountryName, numberCountryName };
            } else {
                // 200 but NOT a real success — rate-limited, challenge, or unknown IG error
                let errMsg = 'Blocked response (rate-limited or challenge) — no OTP sent';
                if (dataStr.includes('challenge')) errMsg = 'Challenge required (proxy flagged by IG)';
                if (dataStr.includes('429') || dataStr.includes('too_many')) errMsg = 'Rate limited (429) — proxy exhausted';
                if (dataStr.includes('checkpoint')) errMsg = 'Checkpoint required';
                if (dataStr.includes('spam')) errMsg = 'Spam flag on this proxy/number';
                return { success: false, message: `Failed: ${errMsg} - HTTP 200`, phone: normalizedPhone, langName, proxyCountryName, numberCountryName };
            }
        } else {
            let errMsg = 'Unknown Error';
            if (dataStr.includes('fail')) errMsg = 'Failed (Check proxy or limits)';
            if (dataStr.includes('CSRF')) errMsg = 'CSRF Error persisted';
            if (res.status === 429) errMsg = 'HTTP 429 Too Many Requests (Blocked)';
            if (res.status === 403) errMsg = 'HTTP 403 Forbidden (Proxy Blocked / Limits)';
            if (res.status === 400) errMsg = 'HTTP 400 Bad Request (Payload format incorrect)';

            return { success: false, message: `Failed: ${errMsg} - HTTP ${res.status}`, phone: normalizedPhone, langName, proxyCountryName, numberCountryName };
        }
    } catch (err) {
        const proxyLog = proxy ? (proxy.host + ':' + proxy.port + ' (' + (proxy.user || 'NoAuth') + ')') : 'DIRECT';
        const errCode = err.code || err.syscall || 'UNKNOWN';
        dbg(barePhone, `💥 PROXY_ERROR ${errCode}`, err.message, { proxy: proxyLog });
        return { success: false, message: `Failed: Proxy/Network Error [${errCode}: ${err.message}]`, phone: normalizedPhone, langName: 'Unknown', proxyCountryName: 'Unknown', numberCountryName: 'Unknown' };
    }

}

// ── 9. Main Orchestrator ──────────────────────────────────────
if (isMainThread) {
    class Dashboard {
        constructor(totalNumbers) {
            this.totalNumbers = totalNumbers;
            this.processed = 0;
            this.successful = 0;
            this.failed = 0;
            this.startTime = Date.now();
        }

        addLog(msg, type, extInfo = '') {
            let prefix = '';
            if (type === 'success') prefix = B(`[IG-LITE] [SMS ✅]`);
            else if (type === 'whatsapp') prefix = Y(`[IG-LITE] [WA  💬]`);
            else if (type === 'retry') prefix = Y(`[RETRY  ]`);
            else prefix = R(`[ERROR  ]`);

            const logLine = `${prefix} ${msg}${extInfo ? ' ' + G(extInfo) : ''}`;
            process.stdout.write(`\r\x1b[K${logLine}\n`);
            this.render();
        }

        setStatus(msg) { }
        update() { }

        render() {
            const pct = ((this.processed / Math.max(this.totalNumbers, 1)) * 100).toFixed(1);
            const bar = `  ${W.bold('IG-LITE')} ⮞ [${this.processed}/${this.totalNumbers}] ${pct}% │ ${B('Sent: ' + this.successful)} │ ${R('Err: ' + this.failed)}`;
            process.stdout.write(`\r\x1b[K${bar}`);
        }

        stop() {
            process.stdout.write('\x1b[2K\r\n');
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            const timeStr = `${m}m ${s}s`;

            console.log(C(`  ╔════════════════════════════════════════════╗`));
            console.log(C(`  ║`) + W.bold(`  IG LITE SMS TRIGGER — COMPLETE            `) + C(`║`));
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
            process.stdin.resume();
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);

            const draw = () => {
                process.stdout.write('\x1b[2J\x1b[H');
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
        process.stdout.write('\x1b[2J\x1b[H');
        printHeader();
        console.log(W.bold('  --- IG LITE THRIFT SENDER  ---\n'));

        // ── Number Source Selection ──
        const numSource = await selectOption("SELECT NUMBER SOURCE", [
            { name: "📁 Load from file (numbers.txt)", value: "file" },
            { name: "🌐 Auto fetch from NexaOTP Panel", value: "nexa" }
        ]);

        let numbersFile = 'numbers.txt';
        let nexaConfig = null;

        if (numSource === 'nexa') {
            // ── API Key Management ──
            let apiKey = '';
            if (fs.existsSync(NEXA_KEY_FILE)) {
                apiKey = fs.readFileSync(NEXA_KEY_FILE, 'utf8').trim();
                const keyAct = await selectOption(`Saved NexaOTP Key found (${apiKey.substring(0, 10)}...)`, [
                    { name: "Use saved key", value: "use" },
                    { name: "Enter new key", value: "new" },
                    { name: "Remove saved key", value: "remove" }
                ]);
                if (keyAct === 'remove') {
                    fs.unlinkSync(NEXA_KEY_FILE);
                    apiKey = '';
                    console.log(G('\n   ✓ Saved API key removed.\n'));
                } else if (keyAct === 'new') {
                    apiKey = '';
                }
            }
            if (!apiKey) {
                apiKey = await promptText("Enter NexaOTP API Key:", "");
                const saveIt = await selectOption("Save this key for future use?", [
                    { name: "Yes, save it", value: "yes" },
                    { name: "No", value: "no" }
                ]);
                if (saveIt === 'yes') {
                    fs.writeFileSync(NEXA_KEY_FILE, apiKey, 'utf8');
                    console.log(G('\n   ✓ API key saved.\n'));
                }
            }

            // ── Multi-Range Input ──
            let ranges = [];
            let addMore = true;
            while (addMore) {
                const r = await promptText(`Enter range #${ranges.length + 1} (e.g. 21624485XXX):`, "");
                if (r) ranges.push(r);
                const another = await selectOption("Add another range?", [
                    { name: "Yes", value: "yes" },
                    { name: "No, proceed", value: "no" }
                ]);
                if (another === 'no') addMore = false;
            }
            if (ranges.length === 0) {
                console.log(R('\n   ✗ You must provide at least one range.\n'));
                process.exit(1);
            }

            // ── How many numbers to fetch ──
            const countInput = await promptText("How many numbers to process? (e.g. 100):", "50");
            const totalCount = parseInt(countInput) || 50;

            // ── Select Server Endpoint ──
            const serverEndpoint = await selectOption("SELECT NEXA SERVER", [
                { name: "Server 1 (/get)", value: "/api/v1/numbers/get" },
                { name: "Server 2 (/p2/get)", value: "/api/v1/numbers/p2/get" },
                { name: "Server 3 (/p3/get)", value: "/api/v1/numbers/p3/get" }
            ]);

            nexaConfig = { apiKey, ranges, totalCount, serverEndpoint };
        } else {
            numbersFile = await promptText("Enter Numbers/Emails File Path [default: numbers.txt]:", "numbers.txt");
            if (!fs.existsSync(numbersFile)) fs.writeFileSync(numbersFile, '');
        }

        let proxiesFile = await promptText("Enter Proxies File Path (Leave blank for direct) [default: none]:", "none");
        if (proxiesFile === 'none' || proxiesFile === '') proxiesFile = '';

        let threads = await selectOption("SELECT THREADS", [
            { name: "10 Threads", value: 10 },
            { name: "20 Threads (Default)", value: 20 },
            { name: "50 Threads (Fast)", value: 50 },
            { name: "100 Threads (Extreme)", value: 100 },
            { name: "Custom", value: "custom" }
        ]);

        if (threads === "custom") {
            const customThreads = await promptText("Enter custom number of threads:", "20");
            threads = parseInt(customThreads) || 20;
        }

        let languageOpt = await selectOption("SELECT ACCEPT-LANGUAGE", [
            { name: "🇬🇧 Default (en_US)", value: "en" },
            { name: "🌍 Auto Language (Match country code)", value: "auto" },
            { name: "✏️ Custom Input", value: "custom" }
        ]);

        if (languageOpt === 'custom') {
            languageOpt = await promptText("Enter custom Locale (e.g. es_ES):", "en_US");
        }

        process.stdin.pause();
        return { numbersFile, threads: String(threads), proxiesFile, nexaConfig, languageOpt };
    }

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
        const cliArgs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

        // HWID VALIDATION
        let hwid = '';
        if (cliArgs[5] && cliArgs[5] !== 'SKING-UI-HARDWARE-ID') {
            hwid = cliArgs[5];
        }

        if (!hwid) {
            hwid = generateHWID();
        }

        globalHwid = hwid;

        if (!hwid) {
            console.error(R(`\n  ✗ Could not generate Hardware ID. Run on Windows.\n`));
            process.exit(1);
        }

        // ── Anti-tamper: regenerate HWID and compare ──────────────
        if (!cliArgs[5] || cliArgs[5] === 'SKING-UI-HARDWARE-ID') {
            const hwidVerify = generateHWID();
            if (hwidVerify !== hwid) {
                console.error(R(`\n  ✗ HWID integrity check failed. Tampering detected.\n`));
                process.exit(1);
            }
        }

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
                    app_id: 'iglite',
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
                    console.error(R(`  ║    ✗ UNAUTHORIZED HARDWARE — IGLITE TOOL    ║`));
                    console.error(R(`  ╠══════════════════════════════════════════════╣`));
                    console.error(R(`  ║  HWID   : `) + Y(hwid.padEnd(33)) + R(`║`));
                    console.error(R(`  ║  Status : ${reason.padEnd(26)}║`));
                    console.error(R(`  ║  Contact: t.me/scraper_king to register     ║`));
                    console.error(R(`  ╚══════════════════════════════════════════════╝\n`));
                    process.exit(1);
                }

                // Verify the cryptographic signature (Ed25519)
                const payloadToVerify = `${hwid}|iglite|2.0.2|${reqTimestamp}`;
                
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
                
                globalPingInterval = setInterval(() => {
                    if (!sessionToken) {
                        console.error(R(`\n  ✗ Session Token lost. Aborting...\n`));
                        process.exit(1);
                    }
                    
                    const pingData = JSON.stringify({
                        hwid: hwid,
                        app_id: 'iglite',
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
                    
                }, 25000); // Ping every 25 seconds (faster than the 60s server expiry to account for event loop lag)
                
                // Allow process to exit normally without waiting for this interval
                if (globalPingInterval && globalPingInterval.unref) globalPingInterval.unref();

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

        let args = cliArgs;
        let wizardResult = null;
        let nexaConfig = null;

        if (args.length === 0) {
            wizardResult = await interactiveWizard();
        }

        let numbersFile, workersCount, proxiesFile, languageOpt;

        if (wizardResult && typeof wizardResult === 'object' && !Array.isArray(wizardResult)) {
            numbersFile = path.resolve(wizardResult.numbersFile || 'numbers.txt');
            workersCount = parseInt(wizardResult.threads) || 20;
            proxiesFile = wizardResult.proxiesFile || '';
            if (proxiesFile.toLowerCase() === 'none' || proxiesFile === 'false') proxiesFile = '';
            nexaConfig = wizardResult.nexaConfig || null;
            languageOpt = wizardResult.languageOpt || 'en';
        } else {
            const finalArgs = wizardResult || cliArgs;
            numbersFile = path.resolve(finalArgs[0] || 'numbers.txt');
            workersCount = parseInt(finalArgs[1]) || 20;
            proxiesFile = finalArgs[2] !== undefined ? finalArgs[2] : 'proxies.txt';
            if (proxiesFile.toLowerCase() === 'none' || proxiesFile === 'false') proxiesFile = '';
            languageOpt = finalArgs[3] || 'en';
        }

        printHeader();
        console.log(B(`  ✓ License: ${licenseUser}`) + G(` | HWID: ${hwid}`));

        let numbers = [];
        let nexaBuffer = [];
        let nexaFeederDone = false;
        let nexaFetched = 0;
        let nexaFailed = 0;
        let nexaWaiters = [];

        if (nexaConfig) {
            console.log(Y(`\n  [NexaOTP] Streaming ${nexaConfig.totalCount} numbers from panel (${nexaConfig.ranges.length} range(s))...`));
            (async () => {
                for (let i = 0; i < nexaConfig.totalCount; i++) {
                    try {
                        const range = nexaConfig.ranges[Math.floor(Math.random() * nexaConfig.ranges.length)];
                        const num = await nexaLimiter.enqueue(() => nexaFetchNumber(nexaConfig.apiKey, range, nexaConfig.serverEndpoint));
                        if (num) {
                            nexaFetched++;
                            if (nexaWaiters.length > 0) {
                                const waiter = nexaWaiters.shift();
                                waiter(num);
                            } else {
                                nexaBuffer.push(num);
                            }
                        }
                    } catch (e) {
                        nexaFailed++;
                    }
                }
                nexaFeederDone = true;
                for (const waiter of nexaWaiters) waiter(null);
                nexaWaiters = [];
            })();
        } else {
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
        let proxies = rawProxies.map(parseProxy).filter(Boolean);

        if (nexaConfig) {
            console.log(Y(`  ✓ Mode: NexaOTP Streaming (${nexaConfig.totalCount} numbers)`));
        } else {
            console.log(Y(`✓ Loaded ${numbers.length} targets`));
        }

        if (proxies.length === 0) console.log(G(`  No proxies configured (running direct)`));
        else console.log(G(`  Proxies loaded: ${proxies.length}`));
        console.log(C(`✓ Threads: ${workersCount}\n`));

        fs.writeFileSync(SUCCESSFUL_FILE, '');
        fs.writeFileSync(FAILED_FILE, '');
        fs.writeFileSync(WHATSAPP_FILE, '');
        // fs.writeFileSync(DEBUG_FILE, `=== DEBUG SESSION ${new Date().toISOString()} ===\n`);

        const totalForDashboard = nexaConfig ? nexaConfig.totalCount : numbers.length;
        const dashboard = new Dashboard(totalForDashboard);

        const pickNextNumber = nexaConfig
            ? async () => {
                if (nexaBuffer.length > 0) return nexaBuffer.shift();
                if (nexaFeederDone) return null;
                return new Promise(resolve => { nexaWaiters.push(resolve); });
            }
            : async () => {
                if (numbers.length === 0) return null;
                const idx = Math.floor(Math.random() * numbers.length);
                return numbers.splice(idx, 1)[0];
            };

        // 1 number = 1 isolated proxy — pick randomly, never share across concurrent numbers
        const getNextProxy = () => {
            if (proxies.length === 0) return null;
            // Random selection — avoids predictable round-robin clustering on the same proxy
            const p = proxies[Math.floor(Math.random() * proxies.length)];
            // Rotate session ID so even if same proxy IP is picked, the session token is unique
            return rotateSessionId({ ...p }); // shallow clone to avoid mutating shared proxy object
        };

        function removeFromFile(phone) {
            try {
                if (nexaConfig) return; // Don't remove from file in nexa mode
                const current = fs.readFileSync(numbersFile, 'utf8');
                const updated = current.split(/\r?\n/).filter(l => l.trim() !== phone.trim()).join('\n');
                fs.writeFileSync(numbersFile, updated);
            } catch (e) { }
        }

        const initialWorkers = nexaConfig ? Math.min(workersCount, nexaConfig.totalCount) : Math.min(workersCount, numbers.length);
        const workerPromises = [];
        const dashboardInterval = setInterval(() => dashboard.render(), 500);

        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        async function processWorker(workerId) {
            while (true) {
                const phone = await pickNextNumber();
                if (!phone) break;

                try {
                    const currentProxy = getNextProxy();
                    const result = await triggerSms(phone, {
                        onStatus: (msg) => dashboard.setStatus(`Worker ${workerId}: ${msg}`),
                        proxy: currentProxy,
                        timeout: 15000,
                        languagePref: languageOpt
                    });

                    const finalLang = result.langName || languageOpt;
                    const finalProxyCountry = result.proxyCountryName || 'Direct';
                    const finalNumCountry = result.numberCountryName || 'Unknown';
                    const extInfo = `- ${finalLang} - Proxy (${finalProxyCountry}) Number (${finalNumCountry})`;

                    if (result.success) {
                        dashboard.successful++;
                        dashboard.processed++;
                        removeFromFile(phone);
                        if (result.whatsapp) {
                            fs.appendFileSync(WHATSAPP_FILE, `${result.phone}|OTP_SENT_WA\n`);
                            dashboard.addLog(`Triggered WA OTP for ${result.phone}`, 'whatsapp', extInfo);
                            dbg(result.phone, '✅ RESULT=WA_SUCCESS', null, { written: 'whatsapp.txt' });
                        } else {
                            fs.appendFileSync(SUCCESSFUL_FILE, `${result.phone}|OTP_SENT\n`);
                            dashboard.addLog(`Triggered OTP for ${result.phone}`, 'success', extInfo);
                            dbg(result.phone, '✅ RESULT=SUCCESS', null, { written: 'successful.txt', ageGated: result.ageGated || false });
                        }
                    } else {
                        dashboard.failed++;
                        dashboard.processed++;
                        fs.appendFileSync(FAILED_FILE, `${result.phone}|${result.message}\n`);
                        dashboard.addLog(`Failed on ${result.phone}: ${result.message}`, 'error', extInfo);
                        dbg(result.phone, '❌ RESULT=FAILED', result.message, { written: 'failed.txt' });
                    }

                } catch (err) {
                    dashboard.failed++;
                    dashboard.processed++;
                    dashboard.addLog(`Fatal error on ${phone}: ${err.message}`, 'error', '');
                }

                // Add randomized delay to prevent rate limiting (1.5s to 4.5s)
                const delayMs = Math.floor(Math.random() * 3000) + 1500;
                await sleep(delayMs);
            }
        }

        for (let i = 0; i < initialWorkers; i++) {
            workerPromises.push(processWorker(i));
        }

        await Promise.all(workerPromises);
        clearInterval(dashboardInterval);
        
        // Stop the background ping loop so the process can exit
        if (typeof globalPingInterval !== 'undefined') {
            clearInterval(globalPingInterval);
        }
        
        dashboard.render();
        dashboard.stop();
    }

    start();
}
