#!/usr/bin/env node
// Delete every Cloud Run service and job (gen-2 Firebase Functions live here).

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-cloudrun.js <projectId>'); process.exit(2); }

const SERVICES = `https://run.googleapis.com/v2/projects/${projectId}/locations/-/services`;
const JOBS = `https://run.googleapis.com/v2/projects/${projectId}/locations/-/jobs`;

async function listAll(url, key) {
    let items = [], pageToken;
    do {
        const u = url + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        try {
            const data = await get(u);
            if (data[key]) items = items.concat(data[key]);
            pageToken = data.nextPageToken;
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                console.error(`  cloud run API not enabled or no permission: ${e.message}`);
                return [];
            }
            throw e;
        }
    } while (pageToken);
    return items;
}

async function nuke(items, kind) {
    let n = 0;
    for (const item of items) {
        const url = `https://run.googleapis.com/v2/${item.name}`;
        try {
            await del(url);
            console.log(`    deleted ${kind} ${item.name}`);
            n++;
        } catch (e) {
            console.warn(`    failed ${item.name}: ${e.message}`);
        }
    }
    return n;
}

async function main() {
    const services = await listAll(SERVICES, 'services');
    const jobs = await listAll(JOBS, 'jobs');
    const s = await nuke(services, 'service');
    const j = await nuke(jobs, 'job');
    console.log(`  cloud run: ${s} service(s), ${j} job(s) deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
