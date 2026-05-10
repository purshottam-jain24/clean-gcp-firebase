#!/usr/bin/env node
// Empty the default Firebase Storage bucket(s) using the admin SDK.
// Tries both <projectId>.appspot.com and <projectId>.firebasestorage.app.

const admin = require('firebase-admin');
const { resolveCredentialPath, printMissingCredsError } = require('./lib/credentials');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-storage.js <projectId>'); process.exit(2); }

const cred = resolveCredentialPath();
if (!cred) { printMissingCredsError(projectId); process.exit(3); }

const credential = cred.type === 'sa'
    ? admin.credential.cert(cred.raw)
    : (process.env.GOOGLE_APPLICATION_CREDENTIALS = cred.path, admin.credential.applicationDefault());

admin.initializeApp({ projectId, credential });

async function emptyBucket(name) {
    const bucket = admin.storage().bucket(name);
    const [exists] = await bucket.exists();
    if (!exists) return { name, status: 'absent' };

    let totalDeleted = 0;
    let pageToken;
    while (true) {
        const [files, nextQuery] = await bucket.getFiles({
            maxResults: 1000,
            pageToken,
            autoPaginate: false,
        });
        if (files.length === 0) break;

        await Promise.all(files.map(f => f.delete({ ignoreNotFound: true }).catch(e => {
            console.warn(`    warn: failed ${f.name}: ${e.message}`);
        })));
        totalDeleted += files.length;
        process.stdout.write(`  ${name}: deleted ${totalDeleted} objects...\r`);

        if (!nextQuery?.pageToken) break;
        pageToken = nextQuery.pageToken;
    }
    process.stdout.write('\n');
    return { name, status: 'emptied', count: totalDeleted };
}

async function main() {
    const buckets = [`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`];
    let touched = 0;
    for (const b of buckets) {
        try {
            const res = await emptyBucket(b);
            if (res.status === 'absent') {
                console.log(`  gs://${b}: not present`);
            } else {
                console.log(`  gs://${b}: emptied ${res.count} object(s)`);
                touched++;
            }
        } catch (e) {
            console.error(`  gs://${b}: ${e.message}`);
        }
    }
    if (touched === 0) console.log('  no buckets touched.');
}

main().catch(err => { console.error('\nfatal:', err.stack || err.message || err); process.exit(1); });
