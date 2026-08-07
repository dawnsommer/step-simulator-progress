# TEST-4 Per-Form Backup Test Plan

1. **First backup with empty cloud** — import a test form, create progress/highlights, connect Google, press Back Up Now. Confirm manifest + one form backup are created.
2. **Routine local saves** — answer/highlight several questions. Confirm simulator saves locally without a Drive request per action. Complete/end the form and confirm one checkpoint backup occurs.
3. **Per-form upload** — modify only Form A. Confirm Form B's backupId/revision remains unchanged after backup.
4. **Cloud restore after local loss** — back up Form A, delete/reset it locally, then press Restore from Cloud. Confirm progress/highlights return. Cloud copy must have survived the local deletion.
5. **Fresh browser metadata** — clear test-site browser storage, re-import the matching form, connect Google. Confirm no automatic upload occurs over the existing cloud backup; Restore from Cloud remains available.
6. **Different-device lineage conflict** — Device A backs up Form A. Device B restores/establishes that lineage, changes Form A and backs it up. Device A then changes Form A. Confirm Device A reports Backup decision required rather than overwriting.
7. **Explicit local wins** — in the conflict above choose Replace Cloud with This Device. Confirm cloud revision advances and Device A's copy becomes the cloud backup.
8. **Explicit cloud wins** — create another conflict and choose Restore from Cloud. Confirm a local checkpoint is created and cloud copy replaces only matching loaded backup entities.
9. **bankHash mismatch** — import a different version of a form with the same formId. Confirm cloud progress is not applied to it.
10. **Offline** — make local progress offline. Confirm local IndexedDB works normally. When online and lineage is safe, checkpoint backup may resume.
11. **OAuth expiry** — confirm local use continues and UI shows Reconnect Google rather than treating it as storage loss.
12. **Old V3 file** — if `step-simulator-progress.TEST.progress.sync.json` still exists in appDataFolder, confirm TEST-4 ignores it and uses only the TEST-4 manifest/per-form files.
