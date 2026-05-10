#!/usr/bin/env node
// Delete all Pub/Sub subscriptions, then all topics, via REST.

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-pubsub.js <projectId>'); process.exit(2); }

const BASE = 'https://pubsub.googleapis.com/v1';

async function listAll(kind) {
    let items = [];
    let pageToken;
    do {
        const url = `${BASE}/projects/${projectId}/${kind}` +
            (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        try {
            const data = await get(url);
            if (data[kind]) items = items.concat(data[kind]);
            pageToken = data.nextPageToken;
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                console.error(`  pub/sub API not enabled (or missing permission): ${e.message}`);
                return [];
            }
            throw e;
        }
    } while (pageToken);
    return items;
}

async function main() {
    let subs = await listAll('subscriptions');
    let subsDeleted = 0;
    for (const s of subs) {
        const name = typeof s === 'string' ? s : s.name;
        try {
            await del(`${BASE}/${name}`);
            console.log(`    deleted subscription ${name}`);
            subsDeleted++;
        } catch (e) {
            console.warn(`    failed ${name}: ${e.message}`);
        }
    }

    let topics = await listAll('topics');
    let topicsDeleted = 0;
    for (const t of topics) {
        const name = typeof t === 'string' ? t : t.name;
        // skip Google-managed topics
        if (name.includes('/topics/cloud-builds') || name.includes('/topics/__')) continue;
        try {
            await del(`${BASE}/${name}`);
            console.log(`    deleted topic ${name}`);
            topicsDeleted++;
        } catch (e) {
            console.warn(`    failed ${name}: ${e.message}`);
        }
    }

    console.log(`  pub/sub: ${subsDeleted} subscription(s), ${topicsDeleted} topic(s) deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
