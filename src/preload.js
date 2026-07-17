'use strict';

// WhatsApp blendet Calls aus, sobald Electron in den User-Agent Client Hints
// auftaucht. Header werden im Main-Prozess bereinigt; dieser frühe Patch hält
// navigator.userAgentData dazu konsistent, bevor Seitenskripte ausgeführt werden.

const { contextBridge } = require('electron');

function readArg(name, fallback) {
    const prefix = `--${name}=`;
    const found = process.argv.find(argument => argument.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
}

const chromeMajor = readArg('kcw-chrome-major', '150');
const chromeFull = readArg('kcw-chrome-full', `${chromeMajor}.0.0.0`);

try {
    contextBridge.executeInMainWorld({
        func: (major, full) => {
            const lowEntropyBrands = [
                { brand: 'Chromium', version: major },
                { brand: 'Not_A Brand', version: '24' },
                { brand: 'Google Chrome', version: major },
            ];
            const fullVersionList = [
                { brand: 'Chromium', version: full },
                { brand: 'Not_A Brand', version: '24.0.0.0' },
                { brand: 'Google Chrome', version: full },
            ];

            const sanitizeHighEntropy = result => {
                const sanitized = { ...result };
                if ('brands' in sanitized) sanitized.brands = lowEntropyBrands;
                if ('fullVersionList' in sanitized) sanitized.fullVersionList = fullVersionList;
                if ('uaFullVersion' in sanitized) sanitized.uaFullVersion = full;
                return sanitized;
            };

            const patchPrototype = () => {
                let prototype;
                try {
                    prototype = Object.getPrototypeOf(navigator.userAgentData);
                } catch {
                    return false;
                }
                if (!prototype) return false;

                try {
                    Object.defineProperties(prototype, {
                        brands: {
                            configurable: true,
                            enumerable: true,
                            get: () => lowEntropyBrands,
                        },
                        mobile: {
                            configurable: true,
                            enumerable: true,
                            get: () => false,
                        },
                        platform: {
                            configurable: true,
                            enumerable: true,
                            get: () => 'Linux',
                        },
                    });

                    const originalGetHighEntropyValues = prototype.getHighEntropyValues;
                    if (typeof originalGetHighEntropyValues === 'function') {
                        Object.defineProperty(prototype, 'getHighEntropyValues', {
                            configurable: true,
                            writable: true,
                            value(hints) {
                                return originalGetHighEntropyValues.call(this, hints)
                                    .then(sanitizeHighEntropy);
                            },
                        });
                    }
                    Object.defineProperty(prototype, 'toJSON', {
                        configurable: true,
                        writable: true,
                        value: () => ({ brands: lowEntropyBrands, mobile: false, platform: 'Linux' }),
                    });
                    return true;
                } catch {
                    return false;
                }
            };

            const patchInstance = () => {
                try {
                    const original = navigator.userAgentData;
                    if (!original) return false;
                    const replacement = {
                        brands: lowEntropyBrands,
                        mobile: false,
                        platform: 'Linux',
                        toJSON: () => ({ brands: lowEntropyBrands, mobile: false, platform: 'Linux' }),
                        getHighEntropyValues: hints => original.getHighEntropyValues(hints)
                            .then(sanitizeHighEntropy),
                    };
                    Object.defineProperty(navigator, 'userAgentData', {
                        configurable: true,
                        enumerable: true,
                        get: () => replacement,
                    });
                    return true;
                } catch {
                    return false;
                }
            };

            if (!patchPrototype() && !patchInstance()) {
                console.warn('[whatsapp-desktop] userAgentData patch failed');
            }
        },
        args: [chromeMajor, chromeFull],
    });
} catch (error) {
    console.warn('[whatsapp-desktop] preload patch failed:', error);
}
