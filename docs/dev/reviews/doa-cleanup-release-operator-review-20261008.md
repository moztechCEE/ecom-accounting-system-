# Cleanup DEV operator — prepare-only independent review, 2026-10-08

Conclusion: **PASS_SCOPED_PREPARATION_ONLY**. No new release was initialized, planned against live services, deployed or promoted. Main f3 is a parent-reported boundary; this review made no cloud reads. The integrated UI batch is separately **HELD** for the author-confirmed pending-load concurrency P2; this operator review does not clear that issue.

## Immutable previous release

The existing release remains in `/private/tmp/corely-doa-release-20261008`. Its source is `264352c5b863d9928a36ab2a9dbecc697f35a028`, build `e992243c-3c30-471a-ba13-8e1fc7231e7f`, and the stored phase sequence is exactly `candidate-api`, `candidate-web`, `final-web`. No API promotion is present.

- Original operator SHA256: `4ce411fa6562da9760a500fb13300ef95916ed20406968981b711b56aa3aaf5e`.
- Original state SHA256: `796374a789dc22a5199e4a54d780bb2d61c3a310017a591d9d6aa1d66fd9e5c1`.

The new baseline requires all nine fixed services and exact normalized identity, including full runtime configuration, environment, all tags, active revision, UID, generation and latest Ready/Created revisions. It permits only the existing owned review/final tags below, with API and Web actual main still the f3 revision at 100%. All unrelated tags, five protected services and two Source/module DEV services remain exact.

| Service | Review tag | Final tag | Active main |
| --- | --- | --- | --- |
| API | `corely-erp-api-dev-doa-264352c5b863-c` | `corely-erp-api-dev-as-f3f14c410490-f` | f3 final 100% |
| Web | `corely-erp-dev-doa-264352c5b863-c` | `corely-erp-dev-doa-264352c5b863-f` | f3 final 100% |

Source20f and module20f revision/digest pins are unchanged. The new helper keeps all five original ordered phases: candidate API, candidate Web, final Web, API promotion, Web promotion. The phase observation still requires actual Ready/Created equality, planned configuration/traffic, preserved service UID and immutable revision image digest. Fresh phase acceptance remains required before promotion; the parent owns the separately adapted UI verifier/acceptance composer.

## New private artifacts

Private directory: `/private/tmp/corely-doa-cleanup-release-20261008` (0700); helper/test/receipt files 0600.

| File | SHA256 |
| --- | --- |
| `operator.py` | `6a8718dbaa0320c3311c819baf8d4ce068c36c3b33ef1a2cb558c90d1460f4f5` |
| `operator-proposed.patch` | `a735d63a0289c30fbc46e1b61198111a070a9837eef918ba56f00b7e280db084` |
| `operator-offline-tests.py` | `cce9bf8e0561d73d404237c8cafe60ab65eecafc8459298ede2f0fd063d98d88` |
| `operator-offline-review.json` | `0f94a18fb7b1699c20e98269187be102578e04ff40755816099738ebd0262256` |

Executed `python3 operator-offline-tests.py`: **65/65 PASS**, comprising 12 positive and 53 rejection cases. The positive cases use the actual archived nine-service baseline and explicitly labeled in-memory future source/build/image fixtures for all five ordered phase plans and replacement preflights. Negatives cover changed prior-owned tags, actual main, unrelated tags/environment, protected/source services, missing services, altered history/bytes, stale source/build/acceptance, false or missing acceptance flags, stale timestamps and ongoing metadata changes. No fake future source/build was persisted into the helper or release state.

Two initial peer findings were repaired within this new helper: `record()` now enters the common pin/history gate before metadata reads, and every ongoing state must contain the exact nine services. The four known CLI modes are explicit. Independent static re-review found no remaining P1/P2 in this scoped helper.

`SOURCE_SHA`, `BUILD_ID` and `CONTEXT_MANIFEST_SHA256` remain **None**. Root must supply a final clean approved source, actual successful build and exact context manifest pin, then re-review/rerun the offline guards before init. No new `state.json` exists. Old files were rehashed after testing and remained byte-identical. Cloud/DB/network calls: **0**. Product/source/test/generated files, credentials, real records and notifications: **untouched**.
