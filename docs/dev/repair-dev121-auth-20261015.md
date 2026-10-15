# Original DEV technician login

Base: `0855802642216e579a86809b0712dee034e7b303`.

The user requested `DEV121` with the synthetic DEV password for the existing repair technician. The login exception applies only with `ERP_DEV_SANDBOX=true`, the exact QA company `doa-dev-qa-20261002`, employee login `DEV121`, the exact requested password, and no email or platform identifier. Input normalization is limited to the two existing approved fixture aliases.

AuthService reads the active Employee on every login and checks the original technician user `doa-dev-tech-20261002` and Employee `c7585674-980b-4fb2-afb9-7f2adcca413e`, including their company, canonical employee number and relationship. Stored bcrypt verification, active User, enrolled two-factor authentication and normal JWT creation remain required. This change neither creates identities nor changes stored credentials, roles, grants, source actors, case ownership or physical custody. The original `DEV123` clerk exception retains its existing behavior; ordinary accounts retain the eight-character minimum.

## Validation

Focused tests cover the actual Nest ValidationPipe and AuthService, exact DEV flag and company, non-string inputs and mixed identifiers, fresh employee linkage, user/employee cross-pairing, bcrypt, disabled identities, two-factor rejection and success, direct-service calls, ordinary employee lookup and the unchanged clerk/account settings cases. The database and JWT adapter in these tests are mocked; they do not establish a live login or database transition.

The DOA coordinator owns deployment and the single credential transition. It must preserve the original identities and use a fresh reviewed runtime SHA, pre-change auth fingerprint, exact-row CAS, durable attempt receipt and readback. A separate, explicit technician credentials override supports the normal DEV harness without rewriting its original QA7001 credentials or parser. Unknown transition outcomes require readback before any further operation.

Completion requires normal API and browser login as the same technician, current company/employee/permissions readback, preserved original case ownership and the original repair workflow receipts. Local code and tests alone do not satisfy that acceptance.

No operating page, tab, interface annotation, common status, schema, financial boundary or Claw workflow route changes in this slice.
