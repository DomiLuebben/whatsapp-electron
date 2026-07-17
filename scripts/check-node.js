'use strict';

const [major, minor] = process.versions.node.split('.').map(Number);
const supported = (major === 22 && minor >= 12) || major === 23 || major === 24 || major === 25;

if (!supported) {
    console.error(`Node.js ${process.versions.node} is not supported for this build.`);
    console.error('Please use Node.js 24 (see .nvmrc).');
    process.exit(1);
}
