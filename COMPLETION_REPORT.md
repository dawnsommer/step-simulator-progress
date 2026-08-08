# step-simulator-progress — TEST-7 Completion Report

Build: `STEP-PROGRESS-TEST-7`

## 1. Current project architecture discovered

The simulator is a GitHub Pages/PWA application with a large single `index.html` application shell and additive sync modules under `js/`. Its browser/iPad DATA directory is emulated by IndexedDB; desktop DATA-folder mode uses the File System Access API. Google Drive `appDataFolder` is the cloud storage backend. TEST-6 already used per-form progress backups plus a small Drive manifest and a separate manual full-library backup.

## 2. Current IndexedDB schema

- `StepSimulatorProgress_TEST_BrowserLibrary_DB`
  - store: `files`
  - keyPath: `path`
  - virtual DATA filesystem records including `catalog.json`, `forms/**`, `assets/**`, and `progress/**`.
- `StepSimulatorProgress_TEST_DATA_Handle_DB`
  - store: `handles`
  - stores the remembered desktop DATA-folder handle.
- `StepSimulatorProgress_SYNC_META_TEST_DB`
  - store: `kv`
  - sync metadata, device ID, dirty state, Worker session, known cloud lineage, recovery checkpoint metadata.
- `StepSimulatorProgress_LIBRARY_TRANSFER_TEST_DB`
  - store: `chunks`, keyPath `key`
  - temporary resumable full-library download chunks.

## 3. Current Google auth flow found

TEST-6 used browser-only Google Identity Services (`google.accounts.oauth2.initTokenClient`) and a short-lived Google access token cached in `sessionStorage`, which required browser reauthorization after token/session loss.

## 4. Files modified

- `index.html`
- `js/sync-config.js`
- `js/google-auth.js`
- `js/progress-sync.js`
- `js/sync-storage.js`
- `js/library-backup.js`
- `sw.js`
- `manifest.webmanifest`
- `privacy.html`
- `README.md`
- `TEST_PLAN.md`

Added this `COMPLETION_REPORT.md`.

## 5. Old browser-only auth removed/replaced

Removed GIS token-client loading/use and the public Google OAuth Client ID from the frontend sync configuration. No `initTokenClient` or GIS client script remains. The only stale token key reference is a deliberate one-time cleanup of the previous TEST browser token from `sessionStorage`.

## 6. Worker session storage implementation

The OAuth callback fragment `#cloud-auth=...` is captured by `google-auth.js` near the top of the document, removed immediately with `history.replaceState()`, and then stored as `cloudWorkerSession` in the isolated sync metadata IndexedDB. It is not written to progress/library data, Drive, localStorage, exports, or the service-worker cache.

The persistent device UUID is reused from the sync metadata DB. Connect redirects to the shared Worker with:

- `app_id=step-simulator-progress`
- `return_url=https://dawnsommer.github.io/step-simulator-progress/`
- `device_id=<persistent UUID>`

## 7. Silent `/token` refresh implementation

`getValidDriveAccessToken()` is centralized in `js/google-auth.js`.

- Valid in-memory Google access token with >60 seconds remaining: reused.
- Otherwise: `POST https://study-tools-auth-worker.summerofdawn20.workers.dev/token`
- Header: `Authorization: Bearer <opaque Worker session>`
- Accepts Worker response fields `accessToken`, `expiresIn`, `tokenType`, `email`, and `appId` (and snake_case equivalents).
- Never expects or requests a Google refresh token.

## 8. Google access-token caching strategy

Google access tokens are held in JavaScript memory only. They are not persisted as the long-term credential. Reload/reopen therefore starts with no Google access token and silently obtains a fresh one from the Worker when Drive access is needed.

## 9. Drive API retry behavior

All Drive traffic uses one centralized `driveFetch()` wrapper.

- Drive 401: discard only the in-memory Google access token, call Worker `/token`, retry the Drive request exactly once.
- Drive 403: surface the Google error/reason; do not clear the Worker session automatically.
- Worker/session 401: clear the invalid local Worker session and show reconnect state.
- Network/Worker/Drive failures leave simulator IndexedDB untouched.

## 10. Per-form Drive file architecture

Normal progress remains per form/version plus Qbank. New backup filenames follow the central prefix, for example:

- `step-simulator-progress.TEST.form.N-11.<bankHash-prefix>.json`
- `step-simulator-progress.TEST.qbank.progress.json`

Existing TEST manifest file IDs/file names remain usable so old TEST backups are not intentionally orphaned solely by the auth migration.

## 11. Manifest design

Small progress manifest remains:

`step-simulator-progress.TEST.manifest.json`

Entries include form identity/bankHash, Drive file ID/name, backup ID, revision, content hash/checksum, updated time, device ID, size, and deletion timestamp/tombstone state. `appId` is now written/validated when present.

The separate manual library manifest remains:

`step-simulator-progress.TEST.library.manifest.json`

## 12. Cloud serialization strategy

Explicit `serializeForCloud()` and `restoreFromCloud()` boundaries were added/retained. TEST-7 intentionally uses a lossless cloned representation and minified JSON. No lossy field removal/deduplication was introduced without a representative real progress fixture proving reconstruction safety.

The 3-digit score remains part of its form progress cloud payload even though the simulator stores it in catalog metadata locally.

## 13. Round-trip test results

A synthetic progress round-trip test was actually executed:

`native entity -> serializeForCloud() -> restoreFromCloud()`

It passed deep equality for the synthetic fixture, including answers, flags, strikeouts, notes, 3-digit score, stem highlight anchors (`id/start/end/quote/prefix/suffix/rootHash`) and explanation highlight anchors (`explanationHash`).

This was not a test against a real 500-700 KB user progress file because no representative real progress file was bundled in the uploaded project. Therefore no claim is made that a new deduplicated 538 KB canonical format has been proven.

## 14. Dirty-state strategy

Dirty forms are persisted in the sync metadata DB (`dirtyKeys` plus related lineage maps) so reload does not forget pending progress. Writes to progress/suspended/Qbank files mark only the relevant entity dirty. 3-digit score changes mark only that form dirty.

## 15. Debounce/checkpoint behavior

Routine progress writes while an exam is actively visible save locally and mark dirty without immediately uploading the form file. Outside an active exam, durable writes use an approximately 8-second trailing checkpoint. Major block/form/navigation checkpoints use a shorter approximately 2.5-second checkpoint. Network restoration and foreground/reopen can evaluate pending dirty data. No-change checks do not rewrite unchanged form files.

## 16. Fresh-device restore behavior

Missing local progress is not interpreted as deletion. Cloud-only entries are reported as available for restore. Progress restore requires the matching source form/version (`formId + bankHash`) to exist locally; therefore a fully cleared/new device should restore/import the Form Library first, then restore matching progress.

## 17. Conflict/delete behavior

The existing simple backup-lineage guard is preserved: the system does not silently choose an entire local or cloud copy when both have diverged. It requires an explicit direction for the conflicting entity.

Explicit progress deletion/reset while sync is enabled creates a tombstone; mere absence of local data does not. A disconnected delete preserves the cloud recovery copy. A form-removal path now emits stable form ID/bankHash deletion metadata before catalog removal so that explicit deletion is not lost due to a catalog lookup race.

Automatic semantic merging of independent edits inside the same form (for example Mac Block 3 plus iPad Block 8) is **not implemented in TEST-7**. The current architecture intentionally stops on same-form divergence rather than risking highlight/attempt loss. This remains an unresolved limitation relative to an ideal multi-writer merge model.

## 18. ~300 MB library backup behavior

The full library backup remains completely separate from normal progress sync and manual-only. It excludes `progress/**` and sends catalog/forms/assets directly browser -> Google Drive through Drive API endpoints. The Worker supplies access tokens only and never carries the payload.

Resumable/chunked upload/download, progress UI, Pause/Resume/Cancel, and locally persisted transfer checkpoints remain. On successful restore, obsolete non-progress local library files not present in the cloud manifest are pruned, while `progress/**` is preserved. `catalog.json` is restored last. Changed cloud library files are committed transactionally via the library manifest before obsolete old Drive objects are cleaned.

## 19. Service-worker changes

Build/cache version bumped to `STEP-PROGRESS-TEST-7`. Navigation and critical sync JS are network-first. The service worker handles GET only; Worker `/token` and `/disconnect` POST requests are not cached. Cross-origin Drive/Worker content is not added to the TEST cache. The OAuth fragment is a URL fragment and is never sent in HTTP requests.

## 20. Tests actually performed

Actually executed locally:

1. `node --check` on all external sync JS modules and `sw.js` — passed.
2. Extracted and syntax-checked all 32 non-empty inline JavaScript blocks in `index.html` — passed.
3. Static legacy-auth scan — no GIS `initTokenClient`, GIS client script, or hard-coded old OAuth Client ID remains.
4. Central-config scan — Worker base URL occurs in executable frontend code only in `js/sync-config.js`.
5. Mock callback/auth lifecycle test — passed:
   - `#cloud-auth` captured,
   - fragment removed,
   - Worker session persisted,
   - Worker `/token` called,
   - Drive 401 caused exactly one token refresh + one retry,
   - account email retained,
   - device-local disconnect cleared the Worker session.
6. Mock reload/reopen test using a fresh JavaScript memory context but shared persistent metadata — passed; each reopen silently obtained a new Google token without redirect.
7. Mock Drive 403 test — passed; Worker session remained connected and 403 reason was preserved.
8. Synthetic cloud serialization round-trip — passed as described above.
9. Static payload-routing inspection — `library-backup.js` uses `driveFetch()` with Google Drive/resumable URLs; Worker endpoint use is confined to the auth module/config.

Could **not** be performed in this workspace and therefore are not claimed as passed:

- real `/health` response (the execution container could not resolve the Worker hostname),
- real Google OAuth redirect/callback,
- real Worker `/token` or `/disconnect`,
- real Google Drive read/write,
- true access-token-expiry test against Google,
- desktop/iPad Safari/iPad Home-Screen PWA tests,
- real 30-form / 30-50 MB progress dataset,
- real ~300 MB resumable library transfer.

Those are listed in `TEST_PLAN.md` for deployment testing.

## 21. Unresolved limitations

1. Same-form multi-device divergence is guarded, not semantically merged. User direction remains required rather than attempting risky block/question/highlight merging.
2. The cloud serializer is lossless/minified, not aggressively deduplicated, because no real large progress fixture was available to prove a smaller reconstruction-safe representation.
3. A fully cleared device still needs its source form library present before per-form progress can be restored; use Restore Library first, then Restore Progress.
4. Installed iPad PWA OAuth return behavior must be tested on the deployed origin. The frontend callback handling is prepared, but the local workspace cannot prove whether iPadOS returns the Worker redirect into the standalone PWA or Safari for the user's exact installation state.
5. Worker CORS/session behavior is assumed to match the already-deployed backend described in the implementation prompt; no Worker changes were made.

## Portability to exam-simulator2

Shared infrastructure is centralized under `CLOUD_CONFIG` in `js/sync-config.js`. Production migration is intended to require changing only the app-specific values (`appId`, `returnUrl`, `driveFilePrefix`) plus production-specific isolated build/cache/database naming as desired. The same Worker, Google Cloud OAuth project, D1 auth/session backend, and direct Google Drive appDataFolder architecture can remain.
