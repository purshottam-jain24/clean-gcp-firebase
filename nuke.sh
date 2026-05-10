#!/usr/bin/env bash
#
# nuke.sh — wipe a Firebase / GCP project back to an empty shell.
#
# Removes (in this order):
#   functions    — Cloud Functions (gen-1)
#   cloudrun     — Cloud Run services + jobs (gen-2 functions)
#   eventarc     — Eventarc triggers (gen-2 function triggers)
#   scheduler    — Cloud Scheduler jobs
#   tasks        — Cloud Tasks queues
#   cloudbuild   — Cloud Build triggers
#   pubsub       — Pub/Sub topics + subscriptions
#   firestore    — Firestore data
#   indexes      — Firestore composite indexes
#   rtdb         — Realtime Database data
#   auth         — Auth users
#   storage      — empty Firebase default bucket(s)
#   buckets      — delete every non-default Cloud Storage bucket
#   artifacts    — Artifact Registry repos (function build artifacts)
#   secrets      — Secret Manager secrets
#   logging      — log sinks + custom metrics
#   rules        — reset Firestore + Storage security rules to deny-all
#   hosting      — disable Hosting site
#   remoteconfig — Remote Config template
#   extensions   — uninstall installed extensions
#
# The project itself is NOT deleted — only its contents.
#
# Modes:
#   ./nuke.sh <projectId>            # FULL wipe — Firebase + all underlying GCP
#   ./nuke.sh <projectId> --firebase # FIREBASE ONLY — leaves raw GCP alone
#
# Other flags:
#   --yes / -y           skip the confirmation prompts (DANGEROUS)
#   --dry-run / -n       print what would happen
#   --skip a,b,c         drop specific steps from the run
#   --only a,b,c         run only the listed steps (mutually exclusive with --firebase)
#
# Auth requires either ./service-account.json next to this file, or
# `gcloud auth application-default login`.

set -uo pipefail

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; DIM=$'\e[2m'; RESET=$'\e[0m'

log()    { printf '%s[nuke]%s %s\n'   "$BLUE"  "$RESET" "$*"; }
ok()     { printf '%s[ ok ]%s %s\n'   "$GREEN" "$RESET" "$*"; }
warn()   { printf '%s[warn]%s %s\n'   "$YELLOW" "$RESET" "$*" >&2; }
err()    { printf '%s[fail]%s %s\n'   "$RED"   "$RESET" "$*" >&2; }
section() { printf '\n%s%s== %s ==%s\n' "$BOLD" "$BLUE" "$*" "$RESET"; }

PROJECT_ID=""
DRY_RUN=0
ASSUME_YES=0
SKIP=""
ONLY=""
FIREBASE_ONLY=0
MODE_LABEL="FULL (Firebase + all underlying GCP)"

# Steps that show up in the Firebase Console — anything else is raw GCP.
FIREBASE_STEPS="functions,firestore,indexes,rtdb,auth,storage,hosting,remoteconfig,extensions,rules"

while (($#)); do
    case "$1" in
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        --yes|-y)    ASSUME_YES=1 ;;
        --dry-run|-n) DRY_RUN=1 ;;
        --firebase)  FIREBASE_ONLY=1 ;;
        --skip)      SKIP="${2:-}"; shift ;;
        --only)      ONLY="${2:-}"; shift ;;
        --skip=*)    SKIP="${1#--skip=}" ;;
        --only=*)    ONLY="${1#--only=}" ;;
        -*) err "unknown flag: $1"; exit 2 ;;
        *)
            if [[ -n "$PROJECT_ID" ]]; then err "unexpected arg: $1"; exit 2; fi
            PROJECT_ID="$1"
            ;;
    esac
    shift
done

if [[ -z "$PROJECT_ID" ]]; then
    err "missing project id. usage: $0 <projectId> [--firebase] [flags]"
    exit 2
fi

if (( FIREBASE_ONLY )); then
    if [[ -n "$ONLY" ]]; then
        err "--firebase cannot be combined with --only (choose one)"
        exit 2
    fi
    ONLY="$FIREBASE_STEPS"
    MODE_LABEL="FIREBASE ONLY (raw GCP resources untouched)"
fi

want() {
    local step="$1"
    if [[ -n "$ONLY" ]]; then
        [[ ",$ONLY," == *",$step,"* ]] && return 0 || return 1
    fi
    if [[ -n "$SKIP" ]]; then
        [[ ",$SKIP," == *",$step,"* ]] && return 1 || return 0
    fi
    return 0
}

run() {
    if (( DRY_RUN )); then
        printf '%s[dry ]%s %s\n' "$DIM" "$RESET" "$*"
        return 0
    fi
    "$@"
}

require() {
    if ! command -v "$1" >/dev/null 2>&1; then
        err "missing dependency: $1"
        exit 1
    fi
}

require firebase
require node

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

ensure_node_deps() {
    if [[ -d "$SCRIPT_DIR/node_modules/firebase-admin" ]] && [[ -d "$SCRIPT_DIR/node_modules/google-auth-library" ]]; then
        return 0
    fi
    warn "installing node deps in $SCRIPT_DIR"
    if ! command -v pnpm >/dev/null 2>&1; then
        err "pnpm not found on PATH. Install it ('npm i -g pnpm' or 'corepack enable') and rerun."
        exit 1
    fi
    (cd "$SCRIPT_DIR" && pnpm install --silent) \
        || { err "pnpm install failed."; exit 1; }
}

# Run a node helper from scripts/. Echoes a [dry] line in dry-run, else
# reports ok/warn based on exit code without aborting.
node_step() {
    local helper="$1" label="$2"
    if (( DRY_RUN )); then
        printf '%s[dry ]%s would run %s\n' "$DIM" "$RESET" "$helper"
        return 0
    fi
    ensure_node_deps
    if node "$SCRIPT_DIR/scripts/$helper" "$PROJECT_ID"; then
        ok "$label complete."
    else
        warn "$label step had errors (see above)."
    fi
}

# ---------- safety: confirmation ----------
if (( ! ASSUME_YES )) && (( ! DRY_RUN )); then
    if (( FIREBASE_ONLY )); then
        scope_summary="Auth users, Firestore + RTDB data, default Storage objects,
Cloud Functions, Hosting, Remote Config, installed Extensions,
Firestore composite indexes; resets Firestore + Storage rules to
deny-all. ${BOLD}Raw GCP resources are untouched.${RESET}"
    else
        scope_summary="Auth users, Firestore + RTDB data, all non-default Storage buckets,
every Cloud Function (gen-1 & gen-2), Cloud Run services & jobs,
Eventarc triggers, Cloud Scheduler & Cloud Tasks, Pub/Sub, Cloud Build
triggers, Artifact Registry repos, Secret Manager secrets, custom log
sinks/metrics, Firestore composite indexes, Hosting, Remote Config,
installed Extensions; resets Firestore + Storage rules to deny-all."
    fi
    cat <<EOF

${RED}${BOLD}!! DESTRUCTIVE OPERATION !!${RESET}

  project: ${BOLD}${PROJECT_ID}${RESET}
  mode:    ${BOLD}${MODE_LABEL}${RESET}

This will delete:
${scope_summary}

${BOLD}There is no undo.${RESET}

EOF
    read -r -p "Type the project id to confirm: " confirm1
    if [[ "$confirm1" != "$PROJECT_ID" ]]; then err "confirmation mismatch — aborting."; exit 1; fi
    read -r -p "Type 'NUKE' to proceed: " confirm2
    if [[ "$confirm2" != "NUKE" ]]; then err "confirmation mismatch — aborting."; exit 1; fi
fi

export FIREBASE_PROJECT="$PROJECT_ID"
FB=(firebase --project "$PROJECT_ID" --non-interactive)

if (( DRY_RUN )); then warn "DRY RUN — no changes will be made."; fi

# ====================================================================
# 1. Compute / runtime layer — kill triggers BEFORE wiping data so they
#    can't react to the wipe.
# ====================================================================

# 1a. Cloud Functions (gen-1)
if want functions; then
    section "Cloud Functions (gen-1)"
    if (( DRY_RUN )); then
        run "${FB[@]}" functions:list
    else
        names="$("${FB[@]}" functions:list 2>/dev/null \
            | awk 'NR>1 && $2!="" {print $2}' \
            | sort -u)"
        if [[ -z "$names" ]]; then
            ok "no functions deployed."
        else
            while IFS= read -r fn; do
                [[ -z "$fn" ]] && continue
                log "deleting function: $fn"
                "${FB[@]}" functions:delete "$fn" --force 2>&1 | sed 's/^/      /' || warn "failed to delete $fn"
            done <<<"$names"
            ok "functions removed."
        fi
    fi
fi

# 1b. Cloud Run (gen-2 functions)
if want cloudrun; then
    section "Cloud Run (services + jobs)"
    node_step nuke-cloudrun.js "cloud run"
fi

# 1c. Eventarc triggers
if want eventarc; then
    section "Eventarc"
    node_step nuke-eventarc.js "eventarc"
fi

# 1d. Cloud Scheduler
if want scheduler; then
    section "Cloud Scheduler"
    node_step nuke-scheduler.js "scheduler"
fi

# 1e. Cloud Tasks
if want tasks; then
    section "Cloud Tasks"
    node_step nuke-tasks.js "cloud tasks"
fi

# 1f. Cloud Build triggers
if want cloudbuild; then
    section "Cloud Build (triggers)"
    node_step nuke-cloudbuild.js "cloud build"
fi

# 1g. Pub/Sub
if want pubsub; then
    section "Pub/Sub"
    node_step nuke-pubsub.js "pubsub"
fi

# ====================================================================
# 2. Data layer
# ====================================================================

if want firestore; then
    section "Firestore (data)"
    run "${FB[@]}" firestore:delete --all-collections --recursive --force \
        && ok "firestore wiped." \
        || warn "firestore wipe reported errors (may be empty already)."
fi

if want indexes; then
    section "Firestore (composite indexes)"
    node_step nuke-indexes.js "firestore indexes"
fi

if want rtdb; then
    section "Realtime Database"
    run "${FB[@]}" database:remove / --force --disable-triggers \
        && ok "rtdb wiped." \
        || warn "rtdb wipe reported errors (may be empty or no DB instance)."
fi

if want auth; then
    section "Authentication"
    if (( DRY_RUN )); then
        printf '%s[dry ]%s would bulk-delete all auth users via admin SDK\n' "$DIM" "$RESET"
    else
        ensure_node_deps
        if node "$SCRIPT_DIR/scripts/nuke-auth.js" "$PROJECT_ID"; then
            ok "auth users deleted."
        else
            rc=$?
            err "auth deletion FAILED (exit $rc). See messages above."
            err "fix: either"
            err "  • run 'gcloud auth application-default login' (if you have gcloud), or"
            err "  • download a service-account JSON from"
            err "    https://console.firebase.google.com/project/${PROJECT_ID}/settings/serviceaccounts/adminsdk"
            err "    and save it as ${SCRIPT_DIR}/service-account.json"
        fi
    fi
fi

# ====================================================================
# 3. Storage layer
# ====================================================================

if want storage; then
    section "Cloud Storage (objects in default bucket)"
    node_step nuke-storage.js "storage objects"
fi

if want buckets; then
    section "Cloud Storage (delete non-default buckets)"
    node_step nuke-buckets.js "buckets"
fi

if want artifacts; then
    section "Artifact Registry"
    node_step nuke-artifacts.js "artifact registry"
fi

# ====================================================================
# 4. Misc
# ====================================================================

if want secrets; then
    section "Secret Manager"
    node_step nuke-secrets.js "secrets"
fi

if want logging; then
    section "Cloud Logging (sinks + metrics)"
    node_step nuke-logging.js "logging"
fi

if want rules; then
    section "Security Rules (reset to deny-all)"
    node_step nuke-rules.js "rules reset"
fi

if want hosting; then
    section "Hosting"
    run "${FB[@]}" hosting:disable --force \
        && ok "hosting disabled (returns 404)." \
        || warn "hosting disable reported errors."
fi

if want remoteconfig; then
    section "Remote Config"
    if (( DRY_RUN )); then
        printf '%s[dry ]%s would attempt remote config rollback\n' "$DIM" "$RESET"
    else
        "${FB[@]}" remoteconfig:rollback --force >/dev/null 2>&1 \
            && ok "remote config rolled back." \
            || ok "remote config: nothing to roll back."
    fi
fi

if want extensions; then
    section "Extensions"
    if (( DRY_RUN )); then
        run "${FB[@]}" ext:list
    else
        instances="$("${FB[@]}" ext:list 2>/dev/null \
            | awk 'NR>2 && $1!="" && $1!~/^─/ {print $1}')"
        if [[ -z "$instances" ]]; then
            ok "no extensions installed."
        else
            while IFS= read -r inst; do
                [[ -z "$inst" ]] && continue
                log "uninstalling extension: $inst"
                "${FB[@]}" ext:uninstall "$inst" --force 2>&1 | sed 's/^/      /' || warn "failed: $inst"
            done <<<"$instances"
            ok "extensions uninstalled."
        fi
    fi
fi

section "DONE"
ok "Project ${BOLD}${PROJECT_ID}${RESET}${GREEN} has been nuked.${RESET}"
cat <<EOF

What this script ${BOLD}did not${RESET} touch:
  • The GCP project itself (use 'gcloud projects delete' for that)
  • IAM bindings, service accounts, custom roles
  • App Engine app (cannot be deleted, only disabled)
  • API enablement state
  • Billing account link
  • KMS keys (can only be scheduled for destruction, not deleted)
  • Compute Engine, Cloud SQL, BigQuery, Vertex AI (out of scope)
  • Hosting release history (Firebase retains for rollback)
  • Analytics data (deletion only via console, not API)

EOF
