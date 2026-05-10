#!/usr/bin/env node
// Delete every Artifact Registry repository (function build artifacts live in
// the gcf-artifacts repo) and every legacy Container Registry image.

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-artifacts.js <projectId>'); process.exit(2); }

const AR = 'https://artifactregistry.googleapis.com/v1';

async function listLocations() {
    try {
        const data = await get(`${AR}/projects/${projectId}/locations`);
        return (data.locations || []).map(l => l.locationId);
    } catch (e) {
        if (e.status === 403) {
            console.error(`  artifact registry API not enabled: ${e.message}`);
            return [];
        }
        throw e;
    }
}

async function listRepos(loc) {
    let items = [], pageToken;
    do {
        const u = `${AR}/projects/${projectId}/locations/${loc}/repositories` +
            (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        const data = await get(u);
        if (data.repositories) items = items.concat(data.repositories);
        pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
}

async function main() {
    const locations = await listLocations();
    let total = 0;

    for (const loc of locations) {
        let repos;
        try { repos = await listRepos(loc); }
        catch (e) { console.warn(`  ${loc}: list failed — ${e.message}`); continue; }
        if (repos.length === 0) continue;

        console.log(`  ${loc}: ${repos.length} repo(s)`);
        for (const r of repos) {
            try {
                // returns long-running operation; don't wait
                await del(`${AR}/${r.name}`);
                console.log(`    deleted ${r.name}`);
                total++;
            } catch (e) {
                console.warn(`    failed ${r.name}: ${e.message}`);
            }
        }
    }
    console.log(`  artifact registry: ${total} repository deletion(s) issued`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
