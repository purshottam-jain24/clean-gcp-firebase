#!/usr/bin/env node
// Reset Firestore + Storage security rules to deny-all.
//
// Strategy: create a fresh ruleset with deny-all source, then publish a
// release pointing to it. The Firebase Rules API replaces the active rules.
//
// RTDB rules can only be set per-instance — handled separately in the bash
// script via firebase CLI.

const { get, request } = require('./lib/google-rest');
const { GoogleAuth } = require('google-auth-library');
const { resolveCredentialPath } = require('./lib/credentials');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-rules.js <projectId>'); process.exit(2); }

const RULES = 'https://firebaserules.googleapis.com/v1';

const DENY_ALL_FIRESTORE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

const DENY_ALL_STORAGE = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}`;

async function authedFetch(method, url, body) {
    const cred = resolveCredentialPath();
    if (!cred) throw new Error('no credentials');
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        ...(cred.type === 'sa' ? { credentials: cred.raw } : { keyFile: cred.path }),
    });
    const client = await auth.getClient();
    const res = await client.request({ url, method, data: body });
    return res.data;
}

async function createRuleset(source) {
    const body = { source: { files: [{ name: 'rules', content: source }] } };
    const r = await authedFetch('POST', `${RULES}/projects/${projectId}/rulesets`, body);
    return r.name; // projects/p/rulesets/<id>
}

async function publishRelease(releaseName, rulesetName) {
    // Update existing release if present, else create new
    try {
        await authedFetch('PATCH',
            `${RULES}/projects/${projectId}/releases/${encodeURIComponent(releaseName)}` +
                `?updateMask.fieldPaths=rulesetName`,
            { name: `projects/${projectId}/releases/${releaseName}`, rulesetName });
        return 'updated';
    } catch (e) {
        if (e.response?.status === 404) {
            await authedFetch('POST',
                `${RULES}/projects/${projectId}/releases`,
                { name: `projects/${projectId}/releases/${releaseName}`, rulesetName });
            return 'created';
        }
        throw e;
    }
}

async function reset(releaseName, source, label) {
    try {
        const ruleset = await createRuleset(source);
        const action = await publishRelease(releaseName, ruleset);
        console.log(`  ${label}: ${action} (ruleset ${ruleset.split('/').pop()})`);
    } catch (e) {
        const detail = e.response?.data?.error?.message || e.message;
        console.warn(`  ${label}: failed — ${detail}`);
    }
}

async function main() {
    await reset('cloud.firestore', DENY_ALL_FIRESTORE, 'firestore rules');
    await reset(`firebase.storage/${projectId}.appspot.com`, DENY_ALL_STORAGE, 'storage rules (appspot.com)');
    await reset(`firebase.storage/${projectId}.firebasestorage.app`, DENY_ALL_STORAGE, 'storage rules (firebasestorage.app)');
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
