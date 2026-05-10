#!/usr/bin/env node
// Delete every Cloud Tasks queue (gen-2 .onTaskDispatched functions create these).

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-tasks.js <projectId>'); process.exit(2); }

const API = 'https://cloudtasks.googleapis.com/v2';

async function listLocations() {
    try {
        const data = await get(`${API}/projects/${projectId}/locations`);
        return (data.locations || []).map(l => l.locationId);
    } catch (e) {
        if (e.status === 403 || e.status === 404) {
            console.error(`  cloud tasks API not enabled: ${e.message}`);
            return [];
        }
        throw e;
    }
}

async function listQueues(loc) {
    let items = [], pageToken;
    do {
        const u = `${API}/projects/${projectId}/locations/${loc}/queues` +
            (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        const data = await get(u);
        if (data.queues) items = items.concat(data.queues);
        pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
}

async function main() {
    const locations = await listLocations();
    let total = 0;
    for (const loc of locations) {
        let queues;
        try { queues = await listQueues(loc); }
        catch (e) { console.warn(`  ${loc}: list failed — ${e.message}`); continue; }
        if (queues.length === 0) continue;
        console.log(`  ${loc}: ${queues.length} queue(s)`);
        for (const q of queues) {
            try {
                await del(`${API}/${q.name}`);
                console.log(`    deleted ${q.name}`);
                total++;
            } catch (e) {
                console.warn(`    failed ${q.name}: ${e.message}`);
            }
        }
    }
    console.log(`  cloud tasks: ${total} queue(s) deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
