#!/usr/bin/env node
// Delete every Firestore composite index (across all databases in the project).

const { get, del } = require('./lib/google-rest');

const projectId = process.argv[2];
if (!projectId) { console.error('usage: nuke-indexes.js <projectId>'); process.exit(2); }

const FS = 'https://firestore.googleapis.com/v1';

async function listDatabases() {
    try {
        const data = await get(`${FS}/projects/${projectId}/databases`);
        return (data.databases || []).map(d => d.name); // e.g. projects/p/databases/(default)
    } catch (e) {
        if (e.status === 403 || e.status === 404) {
            console.error(`  firestore API not enabled: ${e.message}`);
            return [];
        }
        throw e;
    }
}

async function listIndexes(dbName) {
    let items = [], pageToken;
    do {
        // dbName already begins with "projects/.../databases/..."
        const u = `${FS}/${dbName}/collectionGroups/-/indexes` +
            (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
        const data = await get(u);
        if (data.indexes) items = items.concat(data.indexes);
        pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
}

async function main() {
    const dbs = await listDatabases();
    let total = 0;
    for (const db of dbs) {
        let indexes;
        try { indexes = await listIndexes(db); }
        catch (e) { console.warn(`  ${db}: list failed — ${e.message}`); continue; }
        // skip __default__ single-field indexes (managed by Firestore)
        indexes = indexes.filter(i => i.name && !i.name.includes('/__default__/'));
        if (indexes.length === 0) continue;
        console.log(`  ${db}: ${indexes.length} composite index(es)`);
        for (const idx of indexes) {
            try {
                await del(`${FS}/${idx.name}`);
                console.log(`    deleted ${idx.name}`);
                total++;
            } catch (e) {
                console.warn(`    failed ${idx.name}: ${e.message}`);
            }
        }
    }
    console.log(`  firestore indexes: ${total} deleted`);
}

main().catch(err => { console.error('\nfatal:', err.message || err); process.exit(1); });
