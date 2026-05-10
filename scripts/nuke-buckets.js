#!/usr/bin/env node
// Delete every Cloud Storage bucket in the project (via the JSON API).
//
// The default Firebase bucket(s) — <projectId>.appspot.com and
// <projectId>.firebasestorage.app — are EMPTIED but kept; Firebase manages
// them and recreates them on first use anyway. Everything else
// (gcf-sources-*, *_cloudbuild, run-sources-*, etc.) is deleted entirely.

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-buckets.js <projectId>'); process.exit(2); }

const KEEP = new Set([
    `${projectId}.appspot.com`,
    `${projectId}.firebasestorage.app`,
]);

const API = 'https://storage.googleapis.com/storage/v1';

async function listBuckets() {
    let items = [], pageToken;
    do {
        const u = `${API}/b?project=${encodeURIComponent(projectId)}` +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const data = await get(u);
        if (data.items) items = items.concat(data.items);
        pageToken = data.nextPageToken;
    } while (pageToken);
    return items.map(b => b.name);
}

async function listObjects(bucket) {
    let items = [], pageToken;
    do {
        const u = `${API}/b/${encodeURIComponent(bucket)}/o?versions=true&maxResults=1000` +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const data = await get(u);
        if (data.items) items = items.concat(data.items);
        pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
}

async function emptyBucket(bucket) {
    const objs = await listObjects(bucket);
    if (objs.length === 0) return 0;
    // serial-with-concurrency-cap to avoid hammering the API
    let i = 0, deleted = 0;
    const workers = Array.from({ length: 16 }, async () => {
        while (i < objs.length) {
            const o = objs[i++];
            const u = `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(o.name)}` +
                (o.generation ? `?generation=${o.generation}` : '');
            try { await del(u); deleted++; }
            catch (e) { /* tolerate already-deleted */ }
        }
    });
    await Promise.all(workers);
    return deleted;
}

async function main() {
    let buckets;
    try { buckets = await listBuckets(); }
    catch (e) {
        if (e.status === 403) { console.error(`  storage API not enabled: ${e.message}`); return; }
        throw e;
    }
    if (buckets.length === 0) { console.log('  no buckets in project.'); return; }

    let kept = 0, deleted = 0, emptiedDefault = 0;
    for (const name of buckets) {
        if (KEEP.has(name)) {
            const n = await emptyBucket(name).catch(e => (console.warn(`    warn: empty ${name}: ${e.message}`), 0));
            console.log(`  kept (Firebase default): gs://${name} — emptied ${n} object(s)`);
            emptiedDefault += n;
            kept++;
            continue;
        }
        try {
            const n = await emptyBucket(name);
            await del(`${API}/b/${encodeURIComponent(name)}`);
            console.log(`  deleted gs://${name} (was holding ${n} object(s))`);
            deleted++;
        } catch (e) {
            console.warn(`  failed gs://${name}: ${e.message}`);
        }
    }
    console.log(`  buckets: ${deleted} deleted, ${kept} kept (emptied ${emptiedDefault} object(s))`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
