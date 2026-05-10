// Shared credential resolution for nuke-* scripts.
// Looks for a service-account JSON or ADC, in priority order:
//   1. SERVICE_ACCOUNT env var
//   2. GOOGLE_APPLICATION_CREDENTIALS env var
//   3. ./service-account.json next to package.json
//   4. ~/.config/gcloud/application_default_credentials.json

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveCredentialPath() {
    const candidates = [
        process.env.SERVICE_ACCOUNT,
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        path.resolve(__dirname, '..', '..', 'service-account.json'),
        path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
    ].filter(Boolean);

    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                return { path: p, raw, type: raw.type === 'service_account' ? 'sa' : 'adc' };
            }
        } catch (e) {
            // keep looking
        }
    }
    return null;
}

function printMissingCredsError(projectId) {
    console.error('');
    console.error('ERROR: no credentials found for the firebase-admin / Google APIs.');
    console.error('');
    console.error('Save a service-account JSON as ./service-account.json. Download from:');
    console.error(`  https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`);
    console.error('');
}

module.exports = { resolveCredentialPath, printMissingCredsError };
