#!/usr/bin/env node
// Bulk-delete every user in Firebase Auth.
const admin = require('firebase-admin');
const { resolveCredentialPath, printMissingCredsError } = require('./lib/credentials');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-auth.js <projectId>'); process.exit(2); }

const cred = resolveCredentialPath();
if (!cred) { printMissingCredsError(projectId); process.exit(3); }

console.log(`  using credential: ${cred.type} (${cred.path})`);

const credential = cred.type === 'sa'
    ? admin.credential.cert(cred.raw)
    : (process.env.GOOGLE_APPLICATION_CREDENTIALS = cred.path, admin.credential.applicationDefault());

admin.initializeApp({ projectId, credential });

const PAGE = 1000;

async function main() {
    let total = 0, iter = 0;
    while (true) {
        iter++;
        let res;
        try {
            res = await admin.auth().listUsers(PAGE);
        } catch (e) {
            console.error(`\nfatal: listUsers failed: ${e.message}`);
            if (e.errorInfo?.code === 'auth/insufficient-permission') {
                console.error('  the service account is missing the "Firebase Authentication Admin" role.');
            }
            process.exit(4);
        }
        if (res.users.length === 0) break;

        const uids = res.users.map(u => u.uid);
        const result = await admin.auth().deleteUsers(uids);
        total += result.successCount;

        if (result.failureCount > 0) {
            console.warn(`\n  ${result.failureCount} failures in batch:`);
            for (const e of result.errors.slice(0, 5)) {
                console.warn(`    uid=${uids[e.index]}: ${e.error.message}`);
            }
            if (result.errors.length > 5) console.warn(`    ...and ${result.errors.length - 5} more`);
        }

        process.stdout.write(`  deleted ${total} users so far (iter ${iter})...\r`);

        if (result.successCount === 0) {
            console.error(`\nfatal: page returned ${res.users.length} users but none could be deleted — aborting.`);
            process.exit(5);
        }
    }
    process.stdout.write(`\n  total deleted: ${total}\n`);
}

main().catch(err => { console.error('\nfatal:', err.stack || err.message || err); process.exit(1); });
