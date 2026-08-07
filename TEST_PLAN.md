# step-simulator-progress test matrix

Use only this TEST repository while validating Google sync.

## Baseline safety
- Production `exam-simulator2` remains unchanged.
- Confirm the visible badge says `SYNC TEST • step-simulator-progress`.
- In Settings → Google Progress Sync — TEST LAB, confirm the Drive filename is `step-simulator-progress.TEST.progress.sync.json`.
- Run **Validate Local Progress** before the first Google connection.

## A. Single-device round trip
1. Import 2–3 forms.
2. Create answers, marks, strikethroughs, stem highlights, explanation highlights, notes, and one completed block.
3. Run **Validate Local Progress**.
4. Expected: `Round-trip: PASS`, with nonzero counts matching the local simulator.

## B. First cloud upload
1. Save the Google Web Client ID.
2. Connect Google.
3. Expected: connected Gmail shown; status `Synced`.
4. Expected hidden Drive file: `step-simulator-progress.TEST.progress.sync.json`.

## C. Second device restore
1. Open the TEST repo on another device.
2. Import the exact same form files.
3. Connect the same Gmail.
4. Expected: matching `formId + bankHash` progress restores.
5. Compare answers, marks, highlights, notes, results, attempts, and suspended state.

## D. Independent edits
1. Device A changes Question A.
2. Device B changes Question B before pulling Device A's latest state.
3. Sync both.
4. Expected: both question changes survive.

## E. Highlight concurrency
1. Device A adds a stem/explanation highlight on one question.
2. Device B independently adds another highlight on that question.
3. Sync both.
4. Expected: both additions survive when they do not represent the same removed anchor.

## F. Same-field conflict
1. Both devices change the same answer while based on the same prior sync.
2. Sync both.
3. Expected: deterministic winner; no crash; other fields survive.

## G. Explicit deletion
1. Sync a form with progress.
2. Use **Delete Progress** on Device A while that form remains loaded.
3. Sync Device A, then Device B.
4. Expected: deletion tombstone prevents an unchanged stale copy from resurrecting progress.

## H. Missing/uninstalled form is not deletion
1. Cloud contains progress for Form A.
2. Open a fresh TEST device without importing Form A.
3. Sync.
4. Expected: cloud Form A remains intact.
5. Import matching Form A and sync again.
6. Expected: progress restores.

## I. Bank-hash mismatch
1. Cloud contains one version of a form.
2. Import a changed/different JSON into the same form slot on another device.
3. Sync.
4. Expected: no overwrite into the mismatched local form; cloud copy is retained separately by `formId + bankHash`.

## J. Active exam safety
1. Start a test and change answers.
2. Trigger a sync checkpoint while the exam screen remains active.
3. Expected: cloud can checkpoint, but remote reconciliation is not written into the active in-memory exam.
4. Return to main menu and sync.
5. Expected: full local/cloud reconciliation completes.

## K. Offline
1. Disconnect network and continue answering.
2. Expected: local simulator works; status becomes local pending/offline.
3. Reconnect network.
4. Expected: pending progress can synchronize.

## L. OAuth expiry / reconnect
1. Start from a browser session without a valid access token but with sync previously enabled.
2. Expected: `Reconnect Google`, local progress unaffected.
3. Click Sync Now/Connect and authorize.
4. Expected: immediate bidirectional sync.

## M. Corrupt remote protection
Do this only after keeping a known-good TEST backup/checkpoint.
1. Introduce invalid JSON into the TEST Drive sync file using a controlled test method.
2. Sync.
3. Expected: local progress remains unchanged; status reports sync failure; valid Google authorization is not mislabeled as OAuth expiry.

## N. Cache/PWA isolation
1. Install/open both production and TEST deployments if desired.
2. Use **Update App / Clear Cache** in the TEST build.
3. Expected: only `/step-simulator-progress/` service worker and `step-simulator-progress-*` caches are affected.
4. Production `exam-simulator2` data and service-worker scope remain untouched.
