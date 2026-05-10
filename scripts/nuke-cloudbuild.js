#!/usr/bin/env node
// Delete every Cloud Build trigger (build history expires automatically — 365 days).

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-cloudbuild.js <projectId>'); process.exit(2); }

const URL = `https://cloudbuild.googleapis.com/v1/projects/${projectId}/triggers`;

async function main() {
    let items = [], pageToken;
    do {
        const u = URL + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        try {
            const data = await get(u);
            if (data.triggers) items = items.concat(data.triggers);
            pageToken = data.nextPageToken;
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                console.error(`  cloud build API not enabled: ${e.message}`);
                return;
            }
            throw e;
        }
    } while (pageToken);

    let n = 0;
    for (const t of items) {
        try {
            await del(`${URL}/${t.id}`);
            console.log(`    deleted trigger ${t.name || t.id}`);
            n++;
        } catch (e) {
            console.warn(`    failed ${t.id}: ${e.message}`);
        }
    }
    console.log(`  cloud build: ${n} trigger(s) deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
