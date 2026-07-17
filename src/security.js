'use strict';

const TRUSTED_HOSTS = new Set([
    'web.whatsapp.com',
]);

const TRUSTED_ORIGIN_SUFFIXES = [
    '.whatsapp.com',
    '.whatsapp.net',
];

function parseHttpsUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

function isWhatsAppOrigin(rawUrl) {
    const url = parseHttpsUrl(rawUrl);
    if (!url) return false;

    return url.hostname === 'whatsapp.com'
        || url.hostname === 'whatsapp.net'
        || TRUSTED_ORIGIN_SUFFIXES.some(suffix => url.hostname.endsWith(suffix));
}

function isAllowedNavigation(rawUrl) {
    const url = parseHttpsUrl(rawUrl);
    return Boolean(url && TRUSTED_HOSTS.has(url.hostname));
}

function externalUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) return url.toString();
        if (url.protocol === 'mailto:' || url.protocol === 'tel:') return url.toString();
    } catch {
        // Invalid or unsafe URL.
    }
    return null;
}

function desktopExecArgument(value) {
    if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) return null;
    return `"${value.replace(/[\\`"$]/g, character => `\\${character}`)}"`;
}

function permissionRequestOrigin(details = {}) {
    return details.securityOrigin || details.requestingUrl || '';
}

function permissionCheckOrigin(requestingOrigin, details = {}) {
    return details.securityOrigin
        || details.requestingUrl
        || requestingOrigin
        || details.embeddingOrigin
        || '';
}

module.exports = {
    desktopExecArgument,
    externalUrl,
    isAllowedNavigation,
    isWhatsAppOrigin,
    permissionCheckOrigin,
    permissionRequestOrigin,
};
