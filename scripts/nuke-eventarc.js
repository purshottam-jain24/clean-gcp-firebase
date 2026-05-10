#!/usr/bin/env node
// Delete every Eventarc trigger (gen-2 function event triggers live here).

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-eventarc.js <projectId>'); process.exit(2); }

const URL = `https://eventarc.googleapis.com/v1/projects/${projectId}/locations/-/triggers`;

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
                console.error(`  eventarc API not enabled: ${e.message}`);
                return;
            }
            throw e;
        }
    } while (pageToken);

    let n = 0;
    for (const t of items) {
        try {
            await del(`https://eventarc.googleapis.com/v1/${t.name}`);
            console.log(`    deleted ${t.name}`);
            n++;
        } catch (e) {
            console.warn(`    failed ${t.name}: ${e.message}`);
        }
    }
    console.log(`  eventarc: ${n} trigger(s) deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
