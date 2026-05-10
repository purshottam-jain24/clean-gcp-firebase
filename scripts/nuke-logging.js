#!/usr/bin/env node
// Delete user-created log sinks and metric configs.
// Leaves Google-managed _Default, _Required, and _AllLogs alone.

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-logging.js <projectId>'); process.exit(2); }

const SINKS = `https://logging.googleapis.com/v2/projects/${projectId}/sinks`;
const METRICS = `https://logging.googleapis.com/v2/projects/${projectId}/metrics`;

const PROTECTED_SINKS = new Set(['_Default', '_Required', '_AllLogs']);

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
                console.error(`  logging API not enabled: ${e.message}`);
                return [];
            }
            throw e;
        }
    } while (pageToken);
    return items;
}

async function main() {
    const sinks = await listAll(SINKS, 'sinks');
    let s = 0;
    for (const sink of sinks) {
        if (PROTECTED_SINKS.has(sink.name)) continue;
        try {
            await del(`${SINKS}/${encodeURIComponent(sink.name)}`);
            console.log(`    deleted sink ${sink.name}`);
            s++;
        } catch (e) {
            console.warn(`    failed sink ${sink.name}: ${e.message}`);
        }
    }

    const metrics = await listAll(METRICS, 'metrics');
    let m = 0;
    for (const metric of metrics) {
        try {
            await del(`${METRICS}/${encodeURIComponent(metric.name)}`);
            console.log(`    deleted metric ${metric.name}`);
            m++;
        } catch (e) {
            console.warn(`    failed metric ${metric.name}: ${e.message}`);
        }
    }
    console.log(`  logging: ${s} sink(s), ${m} metric(s) deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
