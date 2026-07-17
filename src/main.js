'use strict';

const {
    app,
    BrowserWindow,
    desktopCapturer,
    dialog,
    Menu,
    nativeImage,
    screen,
    session,
    shell,
    Tray,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
    desktopExecArgument,
    externalUrl,
    isAllowedNavigation,
    isWhatsAppOrigin,
    permissionCheckOrigin,
    permissionRequestOrigin,
} = require('./security');

// ── App identity ─────────────────────────────────────────────────────
// Setzt app.getName() / WM_CLASS / userData-Dirname. Muss zur
// StartupWMClass im .desktop passen, sonst hängt das Icon nicht am Fenster.
app.setName('WhatsApp');
app.enableSandbox();

// Electron >= 38 wählt Wayland automatisch. Zusätzliche Ozone-Feature-Flags
// würden inzwischen nur Chromiums native Erkennung überschreiben.
if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland') {
    // Chromium 150 unterstützt seinen Vulkan-Compositor noch nicht mit Ozone
    // Wayland. Ganesh/OpenGL und Video-Decoding bleiben hardwarebeschleunigt.
    app.commandLine.appendSwitch('use-vulkan', 'disabled');
    app.commandLine.appendSwitch('disable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan');
}

// ── Constants ────────────────────────────────────────────────────────
const APP_URL = 'https://web.whatsapp.com/';
const ICON_PATH = path.join(__dirname, 'icon.png');

function safeOpenExternal(rawUrl) {
    const url = externalUrl(rawUrl);
    if (!url) return false;
    shell.openExternal(url).catch((error) => {
        console.warn('[external-link] open failed:', error?.message || error);
    });
    return true;
}

// ── Tiny prefs store ────────────────────────────────────────────────
const PREFS_DEFAULTS = {
    window: { width: 1280, height: 860, x: undefined, y: undefined, maximized: false },
    minimizeToTray: true,
    startMinimized: false,
};
const prefsPath = path.join(app.getPath('userData'), 'whatsapp-prefs.json');

function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function validatedPrefs(loaded = {}) {
    const loadedWindow = loaded.window || {};
    return {
        window: {
            width: finiteNumber(loadedWindow.width, PREFS_DEFAULTS.window.width),
            height: finiteNumber(loadedWindow.height, PREFS_DEFAULTS.window.height),
            x: finiteNumber(loadedWindow.x, undefined),
            y: finiteNumber(loadedWindow.y, undefined),
            maximized: typeof loadedWindow.maximized === 'boolean'
                ? loadedWindow.maximized
                : PREFS_DEFAULTS.window.maximized,
        },
        minimizeToTray: typeof loaded.minimizeToTray === 'boolean'
            ? loaded.minimizeToTray
            : PREFS_DEFAULTS.minimizeToTray,
        startMinimized: typeof loaded.startMinimized === 'boolean'
            ? loaded.startMinimized
            : PREFS_DEFAULTS.startMinimized,
    };
}

let prefs = validatedPrefs();
try {
    if (fs.existsSync(prefsPath)) {
        const loaded = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        prefs = validatedPrefs(loaded);
    }
} catch (e) {
    console.warn('[prefs] load failed:', e?.message || e);
}
let saveTimer = null;
function flushPrefs() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    try {
        const temporaryPath = `${prefsPath}.tmp`;
        fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
        fs.writeFileSync(temporaryPath, JSON.stringify(prefs, null, 2));
        fs.renameSync(temporaryPath, prefsPath);
    } catch (e) {
        console.warn('[prefs] save failed:', e?.message || e);
    }
}

function savePrefs() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPrefs, 250);
}
const store = {
    get(key) {
        const parts = key.split('.');
        let v = prefs;
        for (const p of parts) v = v?.[p];
        return v;
    },
    set(key, value) {
        const parts = key.split('.');
        let target = prefs;
        for (let i = 0; i < parts.length - 1; i++) {
            target[parts[i]] = target[parts[i]] ?? {};
            target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
        savePrefs();
    },
};

// ── Desktop integration (AppImage only) ─────────────────────────────
// Beim ersten Start aus AppImage einen .desktop-Eintrag + Icon nach
// ~/.local/share droppen, damit App-Menü und WM-Icon-Mapping funktionieren.
function ensureDesktopIntegration() {
    if (process.platform !== 'linux') return;
    const appImagePath = process.env.APPIMAGE;
    if (!appImagePath) return;
    const appImageExec = desktopExecArgument(appImagePath);
    if (!path.isAbsolute(appImagePath) || !appImageExec) return;

    try {
        const homeDir = os.homedir();
        const appsDir = path.join(homeDir, '.local', 'share', 'applications');
        const iconsDir = path.join(homeDir, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');
        fs.mkdirSync(appsDir, { recursive: true });
        fs.mkdirSync(iconsDir, { recursive: true });

        const installedIcon = path.join(iconsDir, 'whatsapp-desktop.png');
        fs.copyFileSync(ICON_PATH, installedIcon);

        const desktopFile = path.join(appsDir, 'whatsapp-desktop.desktop');
        const desktopBody = [
            '[Desktop Entry]',
            'Name=WhatsApp',
            'Comment=WhatsApp Web Desktop',
            `Exec=${appImageExec} %U`,
            'Icon=whatsapp-desktop',
            'Terminal=false',
            'Type=Application',
            'Categories=Network;InstantMessaging;',
            'StartupWMClass=WhatsApp',
            '',
        ].join('\n');
        let existing = '';
        try { existing = fs.readFileSync(desktopFile, 'utf8'); } catch { /* not yet there */ }
        if (existing !== desktopBody) fs.writeFileSync(desktopFile, desktopBody, { mode: 0o644 });
    } catch (e) {
        console.warn('[desktop-integration] failed:', e?.message || e);
    }
}

// ── Single-instance lock ────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    process.exit(0);
}

// ── State ───────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;
let unreadCount = 0;
let loadRetryTimer = null;
let loadRetryDelay = 5000;

function clearLoadRetry() {
    if (loadRetryTimer) clearTimeout(loadRetryTimer);
    loadRetryTimer = null;
}

function scheduleLoadRetry() {
    clearLoadRetry();
    loadRetryTimer = setTimeout(() => loadWhatsApp(), loadRetryDelay);
    loadRetryTimer.unref();
    loadRetryDelay = Math.min(loadRetryDelay * 2, 60000);
}

function loadWhatsApp({ resetBackoff = false } = {}) {
    clearLoadRetry();
    if (resetBackoff) loadRetryDelay = 5000;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.loadURL(APP_URL).catch((error) => {
        if (error?.code !== 'ERR_ABORTED') {
            console.warn('[navigation] load failed:', error?.message || error);
        }
    });
}

// ── User-Agent / Client-Hints Spoofing ──────────────────────────────
// WhatsApp Web gate'd Audio-/Video-Calls anhand von User-Agent Client
// Hints (Sec-CH-UA + navigator.userAgentData). Sieht es „Electron" in
// der Brand-Liste, deaktiviert es die Call-Buttons. Drei Stellen müssen
// überschrieben werden:
//
//   1. app.userAgentFallback  → trägt fetch/XHR/WebSocket-Handshakes
//      (nicht via setUserAgent erreichbar).
//   2. Sec-CH-UA*-HTTP-Header → Chromium hängt sie automatisch an
//      jeden Request. Wir schreiben sie pro Request um.
//   3. navigator.userAgentData → Page-JS liest Brands client-seitig.
//      Patch wird vom Preload via webFrame in die Main-World injiziert.

const CHROME_FULL_VERSION = process.versions.chrome || '134.0.0.0';
const CHROME_MAJOR = CHROME_FULL_VERSION.split('.')[0];

function chromiumUserAgent() {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`;
}

// Brand-Liste exakt wie ein „nacktes" Chrome — kein Electron, kein Brave.
const SEC_CH_UA = `"Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24", "Google Chrome";v="${CHROME_MAJOR}"`;
const SEC_CH_UA_FULL = `"Chromium";v="${CHROME_FULL_VERSION}", "Not_A Brand";v="24.0.0.0", "Google Chrome";v="${CHROME_FULL_VERSION}"`;

function setupClientHintsSpoofing() {
    // (1) Default-UA für alle Subresources — KEIN setUserAgent, das deckt
    // nur die Top-Level-Navigation ab.
    app.userAgentFallback = app.userAgentFallback
        .replace(/\s*Electron\/\S+/g, '')
        .replace(/\s*WhatsApp\/\S+/g, '');

    // (2) Header-Rewrite für jede Anfrage an WhatsApp-Domains.
    const filter = {
        urls: [
            'https://*.whatsapp.com/*',
            'https://*.whatsapp.net/*',
            'wss://*.whatsapp.com/*',
            'wss://*.whatsapp.net/*',
        ],
    };
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        const h = { ...details.requestHeaders };
        // Header-Namen können je nach Chromium-Version groß/klein-geschrieben sein.
        for (const k of Object.keys(h)) {
            const lk = k.toLowerCase();
            if (lk === 'sec-ch-ua') h[k] = SEC_CH_UA;
            else if (lk === 'sec-ch-ua-full-version-list') h[k] = SEC_CH_UA_FULL;
            else if (lk === 'sec-ch-ua-full-version') h[k] = `"${CHROME_FULL_VERSION}"`;
            else if (lk === 'user-agent' && /Electron/.test(h[k])) {
                h[k] = chromiumUserAgent();
            }
        }
        callback({ requestHeaders: h });
    });
}

const GRANTED_PERMISSIONS = new Set([
    'clipboard-sanitized-write',
    'display-capture',
    'fullscreen',
    'media',
    'notifications',
]);

async function selectScreenSource(request) {
    if (!request.userGesture || !isWhatsAppOrigin(request.securityOrigin)) return null;

    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
    });
    if (!mainWindow || mainWindow.isDestroyed() || sources.length === 0) return null;

    const labels = sources.map((source, index) => source.name || `Bildschirm ${index + 1}`);
    const cancelId = labels.length;
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Bildschirm teilen',
        message: labels.length === 1
            ? 'WhatsApp möchte deinen Bildschirm teilen.'
            : 'Welchen Bildschirm möchtest du in WhatsApp teilen?',
        detail: labels.length === 1 ? labels[0] : 'Die Freigabe kann im Anruf jederzeit beendet werden.',
        buttons: [...labels, 'Abbrechen'],
        defaultId: cancelId,
        cancelId,
        noLink: true,
    });

    return result.response < sources.length ? sources[result.response] : null;
}

function configurePermissions() {
    const appSession = session.defaultSession;

    appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const trustedWindow = mainWindow && webContents === mainWindow.webContents;
        const trustedOrigin = isWhatsAppOrigin(permissionRequestOrigin(details));
        callback(Boolean(trustedWindow && trustedOrigin && GRANTED_PERMISSIONS.has(permission)));
    });

    appSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
        const origin = permissionCheckOrigin(requestingOrigin, details);
        return isWhatsAppOrigin(origin) && GRANTED_PERMISSIONS.has(permission);
    });

    appSession.setDisplayMediaRequestHandler((request, callback) => {
        selectScreenSource(request)
            .then(source => callback(source ? { video: source } : {}))
            .catch((error) => {
                console.warn('[screen-share] selection failed:', error?.message || error);
                callback({});
            });
    });
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function visibleArea(rect, workArea) {
    const width = Math.max(0, Math.min(rect.x + rect.width, workArea.x + workArea.width) - Math.max(rect.x, workArea.x));
    const height = Math.max(0, Math.min(rect.y + rect.height, workArea.y + workArea.height) - Math.max(rect.y, workArea.y));
    return width * height;
}

function restoredWindowBounds(saved) {
    const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y);
    const requested = {
        x: hasPosition ? saved.x : 0,
        y: hasPosition ? saved.y : 0,
        width: Math.max(600, saved.width),
        height: Math.max(600, saved.height),
    };
    const displays = screen.getAllDisplays();
    const isVisible = hasPosition && displays.some(display => visibleArea(requested, display.workArea) >= 64 * 64);
    const display = isVisible ? screen.getDisplayMatching(requested) : screen.getPrimaryDisplay();
    const { workArea } = display;
    const width = Math.min(requested.width, workArea.width);
    const height = Math.min(requested.height, workArea.height);

    if (!isVisible) return { width, height };
    return {
        width,
        height,
        x: clamp(saved.x, workArea.x, workArea.x + workArea.width - width),
        y: clamp(saved.y, workArea.y, workArea.y + workArea.height - height),
    };
}

// ── Main window ─────────────────────────────────────────────────────
function createWindow({ forceShow = false } = {}) {
    const savedBounds = store.get('window');
    const bounds = restoredWindowBounds(savedBounds);
    const startMinimized = !forceShow && store.get('startMinimized');

    mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: 600,
        minHeight: 600,
        title: 'WhatsApp',
        backgroundColor: '#111b21',
        icon: ICON_PATH,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: true,
            // Calls leiden, wenn Chromium den Renderer im Hintergrund drosselt.
            backgroundThrottling: false,
            // Preload muss die Chrome-Version kennen, um navigator.userAgentData
            // konsistent zu den Sec-CH-UA-Headern zu fälschen.
            additionalArguments: [
                `--kcw-chrome-major=${CHROME_MAJOR}`,
                `--kcw-chrome-full=${CHROME_FULL_VERSION}`,
            ],
        },
    });

    if (savedBounds.maximized) mainWindow.maximize();
    mainWindow.setMenuBarVisibility(false);

    const createdWindow = mainWindow;
    const revealWindow = () => {
        if (!startMinimized && !createdWindow.isDestroyed() && !createdWindow.isVisible()) {
            createdWindow.show();
        }
    };
    mainWindow.once('ready-to-show', revealWindow);
    const revealFallback = setTimeout(revealWindow, 4000);
    revealFallback.unref();

    // UA MUSS vor loadURL gesetzt werden, sonst macht der erste Request
    // schon den falschen UA und WhatsApp redirectet weg.
    mainWindow.webContents.setUserAgent(chromiumUserAgent());
    // Zusätzlich auf Session-Ebene, damit Subresources (Avatare, JS-Bundles)
    // ebenfalls den korrekten UA tragen.
    session.defaultSession.setUserAgent(chromiumUserAgent());

    loadWhatsApp({ resetBackoff: true });

    // ── Bounds persistieren ─────────────────────────────────────
    const saveBounds = () => {
        if (!mainWindow) return;
        if (!mainWindow.isMaximized()) {
            const b = mainWindow.getBounds();
            store.set('window', { ...b, maximized: false });
        } else {
            store.set('window.maximized', true);
        }
    };
    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);
    mainWindow.on('maximize', () => store.set('window.maximized', true));
    mainWindow.on('unmaximize', () => store.set('window.maximized', false));

    // ── Schließen → Tray ─────────────────────────────────────────
    mainWindow.on('close', (e) => {
        if (!isQuitting && store.get('minimizeToTray')) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
    mainWindow.on('closed', () => {
        clearTimeout(revealFallback);
        clearLoadRetry();
        mainWindow = null;
    });

    mainWindow.webContents.on('did-finish-load', () => {
        clearLoadRetry();
        loadRetryDelay = 5000;
    });
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || url !== APP_URL) return;
        console.warn(`[navigation] ${errorDescription} (${errorCode}); retrying`);
        scheduleLoadRetry();
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        if (isQuitting || details.reason === 'clean-exit') return;
        console.warn('[renderer] process gone:', details.reason);
        scheduleLoadRetry();
    });

    // ── Unread-Count aus dem Tab-Title ziehen ─────────────────────
    // WhatsApp Web setzt den Title z.B. auf "(3) WhatsApp" wenn neue
    // Nachrichten da sind. Daraus updaten wir Tray-Tooltip + Badge.
    mainWindow.webContents.on('page-title-updated', (_e, title) => {
        const m = /^\((\d+)\)/.exec(title);
        const next = m ? Math.min(Number(m[1]), 9999) : 0;
        if (next !== unreadCount) {
            unreadCount = next;
            updateBadge();
        }
    });

    // ── Externe Links → System-Browser ────────────────────────────
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        safeOpenExternal(url);
        return { action: 'deny' };
    });

    const guardNavigation = (event, url) => {
        if (isAllowedNavigation(url)) return;
        event.preventDefault();
        safeOpenExternal(url);
    };
    mainWindow.webContents.on('will-navigate', guardNavigation);
    mainWindow.webContents.on('will-redirect', guardNavigation);

    mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

// ── Tray ────────────────────────────────────────────────────────────
function createTray() {
    const trayIcon = nativeImage.createFromPath(ICON_PATH).resize({ width: 22, height: 22 });
    tray = new Tray(trayIcon);
    tray.setToolTip('WhatsApp');

    const menu = Menu.buildFromTemplate([
        { label: 'Öffnen', click: () => showWindow() },
        { type: 'separator' },
        {
            label: 'Beim Schließen ins Tray minimieren',
            type: 'checkbox',
            checked: store.get('minimizeToTray'),
            click: (item) => store.set('minimizeToTray', item.checked),
        },
        {
            label: 'Beim Start im Tray bleiben',
            type: 'checkbox',
            checked: store.get('startMinimized'),
            click: (item) => store.set('startMinimized', item.checked),
        },
        { type: 'separator' },
        { label: 'Neu laden', click: () => loadWhatsApp({ resetBackoff: true }) },
        { type: 'separator' },
        { label: 'Beenden', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => toggleWindow());
}

function showWindow() {
    if (!mainWindow) { createWindow({ forceShow: true }); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
}

function toggleWindow() {
    if (!mainWindow) { createWindow({ forceShow: true }); return; }
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
    } else {
        showWindow();
    }
}

function updateBadge() {
    if (tray) {
        tray.setToolTip(unreadCount > 0 ? `WhatsApp · ${unreadCount} ungelesen` : 'WhatsApp');
    }
    // Unity/KDE Badge an der Taskbar — auf GNOME ohne Extension wirkungslos,
    // schadet aber nichts.
    try { app.setBadgeCount(unreadCount); } catch { /* not supported on this DE */ }
}

// ── Second instance ─────────────────────────────────────────────────
app.on('second-instance', () => showWindow());

// ── Lifecycle ───────────────────────────────────────────────────────
app.whenReady().then(() => {
    setupClientHintsSpoofing();
    configurePermissions();
    ensureDesktopIntegration();
    createWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow({ forceShow: true });
        else showWindow();
    });
});

app.on('window-all-closed', () => {
    // Auf Linux/Windows in den Tray bleiben; auf macOS Standard-Verhalten.
    if (process.platform === 'darwin') return;
    if (!store.get('minimizeToTray')) app.quit();
});

app.on('before-quit', () => {
    isQuitting = true;
    clearLoadRetry();
    flushPrefs();
});
