# 3.2.2 Release Verification Contract

`release-verification.json` is privacy-safe aggregate evidence generated after
the exact Canada candidate completes its five-minute canary. Validate it with:

```bash
node scripts/release-verification.mjs --input release-verification.json --output release-verification.canonical.json
```

The format is `formatVersion: 1` with these required objects:

- `release`: version, merged-main SHA, candidate run/attempt, distinct world
  and Canada digests, and deployment time;
- `performance.releaseBranch` and `performance.mergedMain`: run ID, SHA,
  `profile: "full"`, `canonicalReleaseProof: true`, and `passed: true`;
- `browser`: merged-main canonical performance run ID,
  receive-to-state/animation p95, maximum visual age,
  eligible/start/loss counts, emergency count, frame p95, and repeated long
  tasks;
- `canary.5m`: completion time, pass state,
  accepted/processed/public-event deltas, and zero failure/loss counters;
- `audit`: five-minute result hash, consistent-snapshot integrity/foreign-key
  results, snapshot hash, pre-canary backup-verification evidence hash, schema
  `32000`, and remaining free space.

The validator enforces the 3.2.2 thresholds and can bind every workflow/digest
field to trusted values through `--expect-*` options. The tag workflow performs
that bound validation again. It reconstructs browser evidence from the trusted
merged-main performance artifact and fetches the five-minute audit over pinned
SSH before comparing either object with the tag payload.

Add the canonical JSON to the annotated tag without shell reformatting:

```bash
verification_base64="$(base64 -w0 release-verification.canonical.json)"
git tag -a v3.2.2 -F tag-message.txt
```

`tag-message.txt` contains exactly one of each trailer:

```text
MC-CartoLive 3.2.2

Candidate-Run-Id: <run-id>
Candidate-Run-Attempt: <attempt>
Candidate-World-Digest: sha256:<digest>
Candidate-Canada-Digest: sha256:<digest>
Candidate-Deployed-At: <RFC3339-UTC>
Release-Verification-Base64: <single-line-base64>
```

The validated JSON is included in `SHA256SUMS`, attested with the other release
assets, and attached to the GitHub release.
