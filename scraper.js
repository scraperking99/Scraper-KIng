// ── Scraper King — Android Command Center ────────────────────
// Simple launcher: pick a tool → node script.js → done
// ──────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const https = require('https');

// ── Block Desktop ────────────────────────────────────────────
if (os.platform() === 'win32' || os.platform() === 'darwin') {
    console.log('\n  \x1b[38;2;255;107;107m✗ Android / Termux only. Desktop → use Launcher.bat\x1b[0m\n');
    process.exit(1);
}

// ── Tools ────────────────────────────────────────────────────
const TOOLS = [
    { name: 'Meta AI', icon: '◆', script: 'meta.js', color: '\x1b[38;2;0;191;255m' },
    { name: 'Facebook Reset', icon: '◆', script: 'reset.js', color: '\x1b[38;2;66;133;244m' },
    { name: 'Instagram', icon: '◆', script: 'ig.js', color: '\x1b[38;2;225;48;108m' },
    { name: 'Instagram Lite', icon: '◆', script: 'iglite.js', color: '\x1b[38;2;225;48;108m' },
    { name: 'Viewpoint', icon: '◆', script: 'vp.js', color: '\x1b[38;2;138;43;226m' },
    { name: 'Yango App', icon: '◆', script: 'yango.js', color: '\x1b[38;2;255;165;0m' },
];

// ── ANSI ─────────────────────────────────────────────────────
const X = '\x1b[0m';
const B = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[38;2;0;210;255m';
const GREEN = '\x1b[38;2;0;255;136m';
const YELLOW = '\x1b[38;2;255;215;0m';
const RED = '\x1b[38;2;255;107;107m';
const WHITE = '\x1b[97m';
const GRAY = '\x1b[38;2;100;100;100m';
const LGRAY = '\x1b[38;2;160;160;160m';
const ACCENT = '\x1b[38;2;120;120;255m';
const TEAL = '\x1b[38;2;0;200;180m';
const clear = () => process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

// ══════════════════════════════════════════════════════════════
// HWID
// ══════════════════════════════════════════════════════════════
function getHWID() {
    const f = path.join(os.homedir(), '.sking_hwid');
    if (fs.existsSync(f)) { const s = fs.readFileSync(f, 'utf8').trim(); if (s.startsWith('ANKING-')) return s; }

    let raw = '';
    try { raw = execSync('getprop ro.serialno 2>/dev/null', { stdio: 'pipe', timeout: 3000 }).toString().trim(); } catch (e) { }
    if (!raw || raw === 'unknown') try { raw = execSync('settings get secure android_id 2>/dev/null', { stdio: 'pipe', timeout: 3000 }).toString().trim(); } catch (e) { }
    if (!raw || raw === 'null') try { raw = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e) { }
    if (!raw) raw = crypto.randomBytes(16).toString('hex');

    const h = crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
    const hwid = 'ANKING-' + h.substring(0, 8) + '-' + h.substring(8, 12) + '-' + h.substring(12, 16);
    try { fs.writeFileSync(f, hwid, 'utf8'); } catch (e) { }
    return hwid;
}

// ══════════════════════════════════════════════════════════════
// LICENSE
// ══════════════════════════════════════════════════════════════
function checkLicense(hwid) {
    return new Promise((resolve, reject) => {
        const url = [104, 116, 116, 112, 115, 58, 47, 47, 103, 105, 115, 116, 46, 103, 105, 116, 104, 117, 98, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116, 46, 99, 111, 109, 47].map(x => String.fromCharCode(x)).join('')
            + [115, 99, 114, 97, 112, 101, 114, 107, 105, 110, 103, 57, 57, 47].map(x => String.fromCharCode(x)).join('')
            + [100, 50, 51, 49, 50, 56, 54, 97, 50, 100, 50, 51, 101, 49, 55, 48, 54, 97, 50, 98, 52, 100, 49, 48, 52, 55, 56, 99, 51, 55, 49, 98, 47, 114, 97, 119, 47, 107, 101, 121, 115, 46, 106, 115, 111, 110].map(x => String.fromCharCode(x)).join('');
        https.get(url + `?t=${Date.now()}`, { timeout: 15000 }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const key = data?.keys?.[hwid];
                    if (!key) return resolve({ ok: false, msg: 'NOT REGISTERED' });
                    if (key.expires && key.expires < new Date().toISOString().split('T')[0]) return resolve({ ok: false, msg: 'EXPIRED' });
                    resolve({ ok: true, user: key.user || 'Licensed' });
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// ══════════════════════════════════════════════════════════════
// GIT PULL
// ══════════════════════════════════════════════════════════════
function gitPull() {
    try {
        if (!fs.existsSync(path.join(__dirname, '.git'))) return '—';
        const out = execSync('git pull --ff-only 2>&1', { cwd: __dirname, stdio: 'pipe', timeout: 30000 }).toString().trim();
        return out.includes('Already up to date') ? 'up to date' : 'updated ✓';
    } catch (e) { return 'offline'; }
}

// ══════════════════════════════════════════════════════════════
// MODERN UI
// ══════════════════════════════════════════════════════════════

function drawHeader(user, hwid, syncStatus) {
    clear();
    console.log('');

    // ── Logo ──
    console.log(`${CYAN}${B}      ╔═╗┌─┐┬─┐┌─┐┌─┐┌─┐┬─┐  ╦╔═┬┌┐┌┌─┐${X}`);
    console.log(`${CYAN}      ╚═╗│  ├┬┘├─┤├─┘├┤ ├┬┘  ╠╩╗│││││ ┬${X}`);
    console.log(`${CYAN}      ╚═╝└─┘┴└─┴ ┴┴  └─┘┴└─  ╩ ╩┴┘└┘└─┘${X}`);
    console.log('');

    // ── Info bar ──
    const line = `${GRAY}─────────────────────────────────────────────${X}`;
    console.log(`  ${line}`);
    console.log(`  ${LGRAY}  user${X}     ${GREEN}${B}${user}${X}`);
    console.log(`  ${LGRAY}  hwid${X}     ${YELLOW}${hwid}${X}`);
    console.log(`  ${LGRAY}  sync${X}     ${TEAL}${syncStatus}${X}`);
    console.log(`  ${LGRAY}  ver${X}      ${ACCENT}SK-V7.0.2${X}`);
    console.log(`  ${line}`);
    console.log('');
}

function drawMenu(tools, cursor, exitIdx) {
    console.log(`  ${WHITE}${B}  SELECT TOOL${X}\n`);

    tools.forEach((t, i) => {
        if (i === cursor) {
            console.log(`  ${t.color}${B}  ▸ ${t.icon}  ${t.name}${X}`);
        } else {
            console.log(`  ${GRAY}    ${t.icon}  ${t.name}${X}`);
        }
    });

    // Exit option
    console.log('');
    if (cursor === exitIdx) {
        console.log(`  ${RED}${B}  ▸ ✕  Exit${X}`);
    } else {
        console.log(`  ${GRAY}    ✕  Exit${X}`);
    }

    console.log(`\n  ${GRAY}  ↑↓ navigate  ⏎ select${X}\n`);
}

function showMenu(user, hwid, syncStatus) {
    return new Promise((resolve) => {
        let cursor = 0;
        const total = TOOLS.length + 1; // tools + exit
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();

        const draw = () => {
            drawHeader(user, hwid, syncStatus);
            drawMenu(TOOLS, cursor, TOOLS.length);
        };
        draw();

        const onKey = (_, key) => {
            if (!key) return;
            if (key.ctrl && key.name === 'c') { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.exit(0); }
            if (key.name === 'up') { cursor = (cursor - 1 + total) % total; draw(); }
            if (key.name === 'down') { cursor = (cursor + 1) % total; draw(); }
            if (key.name === 'return') {
                if (process.stdin.isTTY) process.stdin.setRawMode(false);
                process.stdin.removeListener('keypress', onKey);
                process.stdin.pause();
                resolve(cursor);
            }
        };
        process.stdin.on('keypress', onKey);
    });
}

// ══════════════════════════════════════════════════════════════
// RUN — just: node <script>.js   (nothing else)
// ══════════════════════════════════════════════════════════════
function run(tool) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, tool.script);
        if (!fs.existsSync(scriptPath)) {
            console.log(`\n  ${RED}✗ ${tool.script} not found — run: git pull${X}\n`);
            return resolve();
        }

        clear();
        console.log('');
        console.log(`  ${tool.color}${B}══════════════════════════════════════${X}`);
        console.log(`  ${tool.color}${B}  ► ${tool.name}${X}`);
        console.log(`  ${tool.color}${B}══════════════════════════════════════${X}`);
        console.log('');
        console.log(`  ${WHITE}Please wait, you are being transferred...${X}`);
        console.log('');

        // Animated loading dots
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let i = 0;
        const spinner = setInterval(() => {
            process.stdout.write(`\r  ${tool.color}${frames[i++ % frames.length]}${X} ${LGRAY}Loading ${tool.name}${'·'.repeat((i % 4) + 1).padEnd(4)}${X}`);
        }, 80);

        // Show loading for 1.5s then launch
        setTimeout(() => {
            clearInterval(spinner);
            process.stdout.write(`\r  ${GREEN}✓ Launching...${X}              \n\n`);

            setTimeout(() => {
                clear();
                const child = spawn('node', [tool.script], {
                    cwd: __dirname,
                    stdio: 'inherit',
                });

                child.on('close', () => resolve());
                child.on('error', (e) => { console.log(`  ${RED}✗ ${e.message}${X}`); resolve(); });
            }, 300);
        }, 1500);
    });
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function main() {
    clear();

    // 1. HWID
    console.log(`\n  ${CYAN}● Generating HWID...${X}`);
    const hwid = getHWID();
    if (!hwid) { console.log(`  ${RED}✗ HWID failed${X}`); process.exit(1); }
    console.log(`  ${GREEN}✓ ${hwid}${X}`);

    // 2. Git pull
    console.log(`  ${CYAN}● Syncing...${X}`);
    const syncStatus = gitPull();
    console.log(`  ${GREEN}✓ ${syncStatus}${X}`);

    // 3. License
    console.log(`  ${CYAN}● License...${X}`);
    let user = '';
    try {
        const lic = await checkLicense(hwid);
        if (!lic.ok) {
            console.log(`\n  ${RED}✗ ${lic.msg}${X}`);
            console.log(`  ${YELLOW}HWID: ${hwid}${X}`);
            console.log(`  ${GRAY}Contact: t.me/scraper_king${X}\n`);
            process.exit(1);
        }
        user = lic.user;
        console.log(`  ${GREEN}✓ ${user}${X}`);
    } catch (e) {
        console.log(`  ${RED}✗ Offline: ${e.message}${X}\n`);
        process.exit(1);
    }

    await new Promise(r => setTimeout(r, 400));

    // 4. Menu loop
    while (true) {
        const choice = await showMenu(user, hwid, syncStatus);

        // Exit
        if (choice === TOOLS.length) {
            clear();
            console.log(`\n  ${GREEN}${B}Goodbye! — Scraper King${X}\n`);
            process.exit(0);
        }

        // Run selected tool (plain node script.js, nothing extra)
        await run(TOOLS[choice]);

        // Return to menu
        process.stdin.resume();
        await new Promise(r => {
            console.log(`\n  ${GRAY}Press Enter to go back...${X}`);
            process.stdin.once('data', () => { process.stdin.pause(); r(); });
        });
    }
}

main();
