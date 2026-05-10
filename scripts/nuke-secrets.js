#!/usr/bin/env node
// Delete every Secret Manager secret (functions using defineSecret() create these).

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-secrets.js <projectId>'); process.exit(2); }

const API = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`;

async function main() {
    let items = [], pageToken;
    do {
        const u = API + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        try {
            const data = await get(u);
            if (data.secrets) items = items.concat(data.secrets);
            pageToken = data.nextPageToken;
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                console.error(`  secret manager API not enabled: ${e.message}`);
                return;
            }
            throw e;
        }
    } while (pageToken);

    let n = 0;
    for (const s of items) {
        try {
            await del(`https://secretmanager.googleapis.com/v1/${s.name}`);
            console.log(`    deleted ${s.name}`);
            n++;
        } catch (e) {
            console.warn(`    failed ${s.name}: ${e.message}`);
        }
    }
    console.log(`  secrets: ${n} deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
