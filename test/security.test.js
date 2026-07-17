'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    desktopExecArgument,
    externalUrl,
    isAllowedNavigation,
    isWhatsAppOrigin,
    permissionCheckOrigin,
    permissionRequestOrigin,
} = require('../src/security');

test('only the WhatsApp Web HTTPS host may stay in the app window', () => {
    assert.equal(isAllowedNavigation('https://web.whatsapp.com/'), true);
    assert.equal(isAllowedNavigation('https://www.whatsapp.com/'), false);
    assert.equal(isAllowedNavigation('http://web.whatsapp.com/'), false);
    assert.equal(isAllowedNavigation('https://web.whatsapp.com.evil.test/'), false);
});

test('permissions are limited to HTTPS WhatsApp origins', () => {
    assert.equal(isWhatsAppOrigin('https://web.whatsapp.com/'), true);
    assert.equal(isWhatsAppOrigin('https://media.fra1-1.fna.whatsapp.net/'), true);
    assert.equal(isWhatsAppOrigin('http://web.whatsapp.com/'), false);
    assert.equal(isWhatsAppOrigin('https://whatsapp.com.evil.test/'), false);
    assert.equal(isWhatsAppOrigin('not a url'), false);
});

test('external links allow secure web, mail and telephone URLs only', () => {
    assert.equal(externalUrl('https://example.com/a b'), 'https://example.com/a%20b');
    assert.equal(externalUrl('mailto:test@example.com'), 'mailto:test@example.com');
    assert.equal(externalUrl('tel:+491234'), 'tel:+491234');
    assert.equal(externalUrl('http://example.com/'), 'http://example.com/');
    assert.equal(externalUrl('file:///etc/passwd'), null);
    assert.equal(externalUrl('javascript:alert(1)'), null);
});

test('desktop Exec paths are quoted without allowing line injection', () => {
    assert.equal(desktopExecArgument('/tmp/Whats App.AppImage'), '"/tmp/Whats App.AppImage"');
    assert.equal(desktopExecArgument('/tmp/a"$`\\b'), '"/tmp/a\\"\\$\\`\\\\b"');
    assert.equal(desktopExecArgument('/tmp/app\nName=Injected'), null);
});

test('permission origins prefer the security origin supplied by Chromium', () => {
    const details = {
        securityOrigin: 'https://web.whatsapp.com',
        requestingUrl: 'https://example.test/frame',
        embeddingOrigin: 'https://example.test',
    };
    assert.equal(permissionRequestOrigin(details), 'https://web.whatsapp.com');
    assert.equal(permissionCheckOrigin('https://fallback.test', details), 'https://web.whatsapp.com');
    assert.equal(permissionCheckOrigin('https://fallback.test', {}), 'https://fallback.test');
});
