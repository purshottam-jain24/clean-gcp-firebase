// Minimal authenticated REST helper for Google APIs.
// Mints an access token from the resolved credential and exposes
// fetch-style get/del helpers.

const { GoogleAuth } = require('google-auth-library');
const { resolveCredentialPath } = require('./credentials');

let _client;

async function getClient() {
    if (_client) return _client;
    const cred = resolveCredentialPath();
    if (!cred) throw new Error('no credentials available');

    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        ...(cred.type === 'sa' ? { credentials: cred.raw } : { keyFile: cred.path }),
    });
    _client = await auth.getClient();
    return _client;
}

async function request(method, url) {
    const client = await getClient();
    try {
        const res = await client.request({ url, method });
        return res.data;
    } catch (e) {
        const status = e.response?.status;
        const detail = e.response?.data?.error?.message || e.message;
        const err = new Error(`${method} ${url} → ${status || '???'}: ${detail}`);
        err.status = status;
        err.cause = e;
        throw err;
    }
}

const get = (url) => request('GET', url);
const del = (url) => request('DELETE', url);

module.exports = { getClient, request, get, del };
