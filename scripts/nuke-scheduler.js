#!/usr/bin/env node
// Delete every Cloud Scheduler job in every region, using the REST API.

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-scheduler.js <projectId>'); process.exit(2); }

const BASE = 'https://cloudscheduler.googleapis.com/v1';

async function listLocations() {
    try {
        const data = await get(`${BASE}/projects/${projectId}/locations`);
        return (data.locations || []).map(l => l.locationId);
    } catch (e) {
        if (e.status === 403) {
            console.error(`  scheduler API not enabled (or missing permission): ${e.message}`);
            return [];
        }
        throw e;
    }
}

async function listJobs(location) {
    let jobs = [];
    let pageToken;
    do {
        const url = `${BASE}/projects/${projectId}/locations/${location}/jobs` +
            (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        const data = await get(url);
        if (data.jobs) jobs = jobs.concat(data.jobs);
        pageToken = data.nextPageToken;
    } while (pageToken);
    return jobs;
}

async function main() {
    const locations = await listLocations();
    if (locations.length === 0) {
        console.log('  no scheduler locations available — nothing to do.');
        return;
    }

    let totalDeleted = 0;
    for (const loc of locations) {
        let jobs;
        try { jobs = await listJobs(loc); }
        catch (e) { console.warn(`  ${loc}: list failed — ${e.message}`); continue; }
        if (jobs.length === 0) continue;

        console.log(`  ${loc}: ${jobs.length} job(s)`);
        for (const j of jobs) {
            try {
                await del(`${BASE}/${j.name}`);
                console.log(`    deleted ${j.name}`);
                totalDeleted++;
            } catch (e) {
                console.warn(`    failed ${j.name}: ${e.message}`);
            }
        }
    }
    console.log(`  total scheduler jobs deleted: ${totalDeleted}`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
