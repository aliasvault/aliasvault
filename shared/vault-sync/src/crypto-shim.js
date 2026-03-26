// Browser/service-worker shim for Node.js "crypto" module.
// secrets.js-34r7h only needs crypto.getRandomValues(), which is
// available as a global in all modern browsers and service workers.
module.exports = globalThis.crypto;
