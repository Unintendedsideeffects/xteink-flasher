# Plan 002: Point the community-firmware download at ForkDrift releases, and stop it hanging the button on failure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 883a7da..HEAD -- src/remote/firmwareFetcher.ts src/app/page.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-test-baseline-ota-and-firmware-logic.md` (needs the
  vitest runner that plan installs)
- **Category**: bug
- **Planned at**: commit `883a7da`, 2026-08-21

## Why this matters

This app was rebranded from "Xteink" to "FORKDRIFT" in commit `883a7da`, but
that commit changed **UI strings only**. The "Flash CrossPoint firmware" button
still downloads from the upstream project's GitHub releases
(`daveallie/crosspoint-reader`), not from this fork
(`Unintendedsideeffects/ForkDrift-crosspointReader`). A user who opens the
FORKDRIFT flasher and clicks the FORKDRIFT-branded button gets **upstream
CrossPoint v1.5.0** flashed to their device.

There is a second, sharper problem hiding behind the first: the code that finds
the firmware asset in a release cannot work against ForkDrift's releases at
all, for two independent reasons (both verified against the live GitHub API on
2026-08-21 — see "Current state"). So this is not a one-line URL swap. Getting
it wrong produces a button that either silently flashes the wrong firmware or
spins forever.

Third: the failure path is invisible. `page.tsx:40` calls
`getCommunityFirmwareRemoteData().then(setCommunityFirmwareVersions)` with no
`.catch()`, and the fetcher itself has no error handling. When it throws, the
promise rejects unhandled and `communityFirmwareVersions` stays `null` forever
— which the button renders as a **permanent loading spinner** (`page.tsx:169-170`
set `disabled` and `loading` from that null). The user sees a button that never
becomes clickable and no error anywhere.

After this plan: the button downloads ForkDrift firmware, and any failure
surfaces as a readable message instead of a spinner.

## Current state

### The fetcher

`src/remote/firmwareFetcher.ts:12-18` — the response type:

```ts
interface CommunityFirmwareVersions {
  crossPoint: {
    version: string;
    releaseDate: string;
    downloadUrl: string;
  };
}
```

`src/remote/firmwareFetcher.ts:103-135` — the function to change:

```ts
export async function getCommunityFirmwareRemoteData(): Promise<CommunityFirmwareVersions> {
  const cacheKey = 'firmware-versions.community.v1';

  const value = getCached<CommunityFirmwareVersions>(cacheKey);
  if (value) {
    return value;
  }

  const releaseData = await fetch(
    'https://api.github.com/repos/daveallie/crosspoint-reader/releases/latest',
  ).then((resp) => resp.json());

  const firmwareAsset = releaseData.assets.find((asset: any) =>
    asset.name.endsWith('firmware.bin'),
  );
  if (!firmwareAsset) {
    throw new Error('CrossPoint firmware asset not found');
  }

  const data = {
    crossPoint: {
      version: releaseData.tag_name,
      releaseDate: new Date(releaseData.published_at)
        .toISOString()
        .slice(0, 10),
      downloadUrl: firmwareAsset.browser_download_url,
    },
  };

  setCached(cacheKey, data, 60 * 60); // 1 hour
  return data;
}
```

`src/remote/firmwareFetcher.ts:145-152` — the download, unchanged by this plan
except that it now resolves a ForkDrift URL:

```ts
export async function getCommunityFirmware(_firmware: 'CrossPoint') {
  const releaseData = await getCommunityFirmwareRemoteData().then(
    (data) => data.crossPoint,
  );

  const response = await fetch(releaseData.downloadUrl);
  return new Uint8Array(await response.arrayBuffer());
}
```

### The three reasons a naive URL swap fails

These were verified with live API calls on 2026-08-21. Do not re-derive them;
do re-check them if a STOP condition fires.

**1. `/releases/latest` returns 404 for the ForkDrift repo.** GitHub's
`/releases/latest` endpoint **excludes prereleases**. `scripts/release.sh` in
the firmware repo creates every release with `--prerelease`
(`gh release create "$ch" --repo "$REPO" --prerelease --title "$VERSION"`), so
there is no non-prerelease release to return:

```
GET https://api.github.com/repos/Unintendedsideeffects/ForkDrift-crosspointReader/releases/latest
→ 404
```

The releases are addressed **by channel tag** instead. Live state:

| tag       | `name`     | prerelease | assets                                                                                                                                                                                          |
| --------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest`  | `3109-dev` | true       | `crosspoint-standard.bin`, `crosspoint-lean.bin`, `crosspoint-full.bin`, `crosspoint-lean-reset.bin`, `crosspoint-full-reset.bin`, `crosspoint-partitions.bin`, `firmware-20260726-39072d6.bin` |
| `nightly` | `20260810` | true       | `bootloader.bin`, `partitions.bin` only                                                                                                                                                         |

**2. No ForkDrift asset name ends with `firmware.bin`.** The current matcher is
`asset.name.endsWith('firmware.bin')`. Against upstream that matches a literal
`firmware.bin`. Against ForkDrift, the closest name is
`firmware-20260726-39072d6.bin`, which ends with `39072d6.bin`. The matcher
finds nothing and throws.

**3. `tag_name` is not a version for ForkDrift.** The tag is the channel name
(`latest`), and the human-readable version lives in the release's `name` field
(`3109-dev`). Using `tag_name` would render the button as
"Flash ForkDrift firmware (latest)".

For reference, upstream's shape (which the current code was written against):
tag `v1.5.0`, name `v1.5.0`, `prerelease: false`, assets `firmware.bin` and
`sticky.bin`. Note also that
`https://api.github.com/repos/daveallie/crosspoint-reader/...` now answers
**301** — that repository has been renamed — and the current code only works
because `fetch` follows redirects by default.

### Why `crosspoint-standard.bin`

`scripts/release.sh` in the firmware repo (workspace path
`../crosspoint-reader/scripts/release.sh:86-100`) publishes three feature
profiles per channel. `standard` is the default profile — the firmware repo's
`./build-firmware.sh` with no argument builds it, and `release.sh` maps the
unsuffixed build to `crosspoint-standard.bin`. Use it. Offering a
lean/standard/full picker is a reasonable follow-up but is **explicitly out of
scope here** (see "Out of scope").

### The unhandled call site

`src/app/page.tsx:29-41`:

```tsx
  const [communityFirmwareVersions, setCommunityFirmwareVersions] = useState<{
    crossPoint: { version: string; releaseDate: string };
  } | null>(null);
  ...
  useEffect(() => {
    getOfficialFirmwareVersions().then((versions) =>
      setOfficialFirmwareVersions(versions),
    );

    getCommunityFirmwareRemoteData().then(setCommunityFirmwareVersions);
  }, []);
```

`src/app/page.tsx:166-175`:

```tsx
<Button
  variant="subtle"
  onClick={actions.flashCrossPointFirmware}
  disabled={isRunning || !communityFirmwareVersions}
  loading={!communityFirmwareVersions}
>
  Flash CrossPoint firmware ({communityFirmwareVersions?.crossPoint.version}) -{' '}
  {communityFirmwareVersions?.crossPoint.releaseDate}
</Button>
```

Contrast with the official-firmware path at `firmwareFetcher.ts:76-91`, which
ends in `.catch(() => firmwareVersionFallback)` — that is the in-repo
convention for "remote metadata is best-effort". Match its _spirit_ (never let
a metadata fetch reject) but not its literal fallback: there is no sensible
hardcoded ForkDrift download URL to fall back to, so this plan surfaces the
error instead.

### Repo conventions to match

- TypeScript strict, `noUncheckedIndexedAccess` on (`tsconfig.json:19`).
- ESLint runs with `--max-warnings 0`. The existing code uses
  `(asset: any)` at `firmwareFetcher.ts:115`; airbnb's
  `@typescript-eslint/no-explicit-any` is evidently not erroring today, but
  **prefer a narrow interface over `any`** in new code (Step 1 gives one).
- Prettier is CI-enforced. Do not hand-format; run the formatter.
- Path alias `@/*` → `./src/*` (`tsconfig.json:27-29`).
- Commit style: conventional commits, e.g.
  `fix: point community firmware download at ForkDrift releases`.

## Commands you will need

**There is no `yarn` binary on PATH and `corepack` is not installed.** Yarn 4
is vendored; invoke it through `node`.

| Purpose                   | Command                                                  | Expected on success                                            |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Install                   | `node .yarn/releases/yarn-4.11.0.cjs install`            | exit 0                                                         |
| Lint (full CI gate)       | `node .yarn/releases/yarn-4.11.0.cjs lint`               | exit 0, ends with `All matched files use Prettier code style!` |
| Tests                     | `node .yarn/releases/yarn-4.11.0.cjs test`               | exit 0, all pass                                               |
| Format                    | `node .yarn/releases/yarn-4.11.0.cjs prettier --write .` | exit 0                                                         |
| Dev server (manual check) | `node .yarn/releases/yarn-4.11.0.cjs dev`                | serves http://localhost:3000                                   |

Run from the repository root (`/home/malcolm/Code/ForkDrift/xteink-flasher`).

## Scope

**In scope**:

- `src/remote/firmwareFetcher.ts` — only `CommunityFirmwareVersions` and
  `getCommunityFirmwareRemoteData`
- `src/remote/firmwareFetcher.test.ts` (create)
- `src/app/page.tsx` — the `useEffect` at lines 35-41 and the button at lines
  166-175
- `plans/README.md` — status row only

**Out of scope** (do NOT touch, even though they look related):

- **`getOfficialFirmwareRemoteData`, `getOfficialFirmware`,
  `getOfficialFirmwareVersions`, and `firmwareVersionFallback`**
  (`firmwareFetcher.ts:20-101,137-143`). Those use plain-HTTP URLs and are the
  subject of plan 003. Touching them here will conflict.
- **A lean/standard/full profile picker.** Tempting, because the release
  publishes all three — but it changes the UI shape and the `useEspOperations`
  action signature. Deferred deliberately; see maintenance notes.
- **`src/esp/*`** — the flashing path itself is unchanged. This plan only
  changes which bytes are downloaded.
- **Adding a GitHub token to authenticate the API call.** This is a static,
  client-side app; any token shipped to the browser is public. Rate limiting is
  handled by caching and a readable error, not by a credential.
- `eslint.config.mjs` — auto-generated (see its header comment).

## Git workflow

- Branch: `advisor/002-forkdrift-community-firmware` off `fork-drift`.
- Commit per step. Message style: conventional commits.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite `getCommunityFirmwareRemoteData` against the ForkDrift release shape

Replace `getCommunityFirmwareRemoteData` in `src/remote/firmwareFetcher.ts`.
Keep the exported name, keep the `CommunityFirmwareVersions` return shape
(`page.tsx` reads `.crossPoint.version` and `.crossPoint.releaseDate`), and
keep the existing `getCached`/`setCached` usage.

Required behavior:

1. Fetch `https://api.github.com/repos/Unintendedsideeffects/ForkDrift-crosspointReader/releases/tags/latest`
   — **`/releases/tags/latest`, not `/releases/latest`**. Define the repo and
   channel as module-level constants near the other URL constants
   (`firmwareFetcher.ts:37-40`) so they are easy to find and change.
2. Check `response.ok` **before** calling `.json()`. On a non-OK response throw
   an `Error` whose message includes the status code, e.g.
   `` `GitHub API returned ${response.status} for the ForkDrift release` ``.
   This is what turns a rate-limit 403 into a readable message instead of the
   current `TypeError: Cannot read properties of undefined`.
3. Guard the shape before indexing: if `releaseData.assets` is not an array,
   throw `new Error('Unexpected GitHub release payload')`.
4. Find the asset whose `name` is **exactly** `crosspoint-standard.bin`. Use
   `===`, not `endsWith` — the release also contains
   `crosspoint-standard`-adjacent names (`crosspoint-full.bin`,
   `crosspoint-lean.bin`) and a loose matcher is what caused this bug.
   If not found, throw
   `new Error('ForkDrift firmware asset crosspoint-standard.bin not found in the latest release')`.
5. Read the version from `releaseData.name` (e.g. `3109-dev`), falling back to
   `releaseData.tag_name` if `name` is empty or missing.
6. Keep `releaseDate` derived from `published_at` via
   `new Date(...).toISOString().slice(0, 10)`, but guard against a missing
   `published_at` — fall back to the empty string rather than rendering
   `Invalid Date`.
7. Keep the 1-hour cache TTL. **Only cache on success** — the existing
   structure already does this because `setCached` runs after the throws.

Replace the `(asset: any)` cast with a narrow local interface, e.g.:

```ts
interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  name?: string;
  tag_name?: string;
  published_at?: string;
  assets?: GithubReleaseAsset[];
}
```

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs lint` → exit 0.

### Step 2: Add tests for the new fetcher logic

Create `src/remote/firmwareFetcher.test.ts`. Plan 001 installed vitest; use
`vi.stubGlobal('fetch', ...)` to fake the network — **no test may make a real
network call**.

Two things to handle:

- The module-level `memoryCache` (`firmwareFetcher.ts:47`) persists between
  tests in the same file. Because the cache key is a module constant you cannot
  clear it directly. Use `vi.resetModules()` in `beforeEach` and re-import the
  module with a dynamic `await import('@/remote/firmwareFetcher')` inside each
  test, so every test gets a fresh cache.
- Restore the global with `vi.unstubAllGlobals()` in `afterEach`.

Cases:

1. **Happy path**: fetch resolves `{ ok: true, json: async () => release }`
   where `release` mirrors the live shape — `name: '3109-dev'`,
   `tag_name: 'latest'`, `published_at: '2026-02-23T22:40:01Z'`, and an
   `assets` array containing `crosspoint-lean.bin`, `crosspoint-standard.bin`,
   and `firmware-20260726-39072d6.bin`. Assert the result is
   `{ crossPoint: { version: '3109-dev', releaseDate: '2026-02-23',
downloadUrl: <the standard.bin url> } }`.
2. **It picks `crosspoint-standard.bin`, not a sibling**: same as above but
   with `crosspoint-full.bin` listed _before_ standard. Assert `downloadUrl`
   is still the standard one. This is the regression test for the actual bug.
3. **The URL is the ForkDrift tag endpoint**: assert the mock fetch was called
   with a URL containing
   `Unintendedsideeffects/ForkDrift-crosspointReader` and
   `/releases/tags/latest`, and **not** containing `daveallie` or ending in
   `/releases/latest`.
4. **Non-OK response throws with the status**: fetch resolves
   `{ ok: false, status: 403 }` → the returned promise rejects with a message
   containing `403`.
5. **Missing asset throws**: `ok: true` but `assets` contains only
   `crosspoint-lean.bin` → rejects with a message containing
   `crosspoint-standard.bin`.
6. **Malformed payload throws rather than TypeErrors**: `ok: true`,
   `json: async () => ({})` (no `assets` key) → rejects with a message
   containing `Unexpected`. Assert it is **not** a `TypeError`.
7. **Version falls back to the tag**: `name` absent → `version` is the
   `tag_name` value.
8. **Result is cached**: call twice with the same stubbed fetch; assert the
   mock was called exactly once and both results are `toEqual`.
9. **Failures are not cached**: first call fails (`ok: false`), second call
   succeeds; assert the second call returns data and the mock was called twice.

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → all pass, 9 new tests.

### Step 3: Surface the failure in the UI instead of spinning forever

In `src/app/page.tsx`:

1. Add an error state next to the existing one:

```tsx
const [communityFirmwareError, setCommunityFirmwareError] = useState<
  string | null
>(null);
```

2. Attach a `.catch` to the call in the `useEffect` at lines 35-41:

```tsx
getCommunityFirmwareRemoteData()
  .then(setCommunityFirmwareVersions)
  .catch((error: unknown) =>
    setCommunityFirmwareError(
      error instanceof Error ? error.message : 'Unknown error',
    ),
  );
```

3. Change the button (lines 166-175) so an error state is terminal rather than
   a permanent spinner:
   - `loading={!communityFirmwareVersions && !communityFirmwareError}`
   - `disabled={isRunning || !communityFirmwareVersions}`
   - When `communityFirmwareError` is set, render a label that names the
     problem, e.g.
     `` `ForkDrift firmware unavailable (${communityFirmwareError})` ``, instead
     of the version/date line.
   - When it succeeds, keep the existing shape but say **ForkDrift**, not
     CrossPoint: `Flash ForkDrift firmware (3109-dev) - 2026-02-23`. This
     matches the `883a7da` rebrand, which renamed user-facing strings.

Match the file's existing Chakra UI usage — do not introduce a new component
library or a toast; the button label is the surface.

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs lint` → exit 0.

### Step 4: Manual smoke check against the real API

Start the dev server:

```
node .yarn/releases/yarn-4.11.0.cjs dev
```

Open http://localhost:3000 and confirm, **without connecting a device**:

- The community firmware button resolves out of its loading state within a few
  seconds and reads `Flash ForkDrift firmware (3109-dev) - 2026-02-23` (the
  exact version will differ if a newer release has been published — any
  non-empty version and a valid `YYYY-MM-DD` date is a pass).
- The browser devtools Network tab shows a request to
  `api.github.com/repos/Unintendedsideeffects/ForkDrift-crosspointReader/releases/tags/latest`
  returning 200, and **no** request to `daveallie`.
- The devtools Console shows no unhandled promise rejection.

Do **not** click the button — flashing requires a device and is out of scope
for this verification.

Stop the dev server when done.

**Verify**: all three bullets hold. If the GitHub request returns 403
(rate-limited), the button should show the readable
`ForkDrift firmware unavailable (…403…)` label — that is also a pass for this
step, and confirms Step 3 works. Note it in your report.

### Step 5: Format and run the full gate

```
node .yarn/releases/yarn-4.11.0.cjs prettier --write .
node .yarn/releases/yarn-4.11.0.cjs lint
node .yarn/releases/yarn-4.11.0.cjs test
```

**Verify**: all three exit 0.

## Test plan

- New file: `src/remote/firmwareFetcher.test.ts`, 9 tests as enumerated in
  Step 2.
- Structural pattern: the test files created by plan 001
  (`src/esp/OtaPartition.test.ts` in particular) — one `describe` per exported
  function, one `it` per named case, helpers at the top of the file.
- The load-bearing regression test is **case 2** (picks
  `crosspoint-standard.bin` even when a sibling asset is listed first). If you
  write only one test, write that one.
- No test may perform real network I/O. If `node .yarn/releases/yarn-4.11.0.cjs test`
  ever takes more than a few seconds, suspect an unstubbed `fetch`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node .yarn/releases/yarn-4.11.0.cjs lint` exits 0
- [ ] `node .yarn/releases/yarn-4.11.0.cjs test` exits 0, including 9 new tests
      in `src/remote/firmwareFetcher.test.ts`
- [ ] `grep -rn "daveallie" src/` returns **no matches**
- [ ] `grep -rn "releases/latest" src/` returns **no matches** (the correct
      endpoint is `/releases/tags/latest`)
- [ ] `grep -n "crosspoint-standard.bin" src/remote/firmwareFetcher.ts` returns
      a match
- [ ] `grep -n "endsWith('firmware.bin')" src/remote/firmwareFetcher.ts`
      returns **no matches**
- [ ] `grep -n "catch" src/app/page.tsx` returns a match inside the
      `useEffect` that calls `getCommunityFirmwareRemoteData`
- [ ] Step 4's manual smoke check passed (record which bullet outcomes you saw)
- [ ] `git status --porcelain` lists only: `src/remote/firmwareFetcher.ts`,
      `src/remote/firmwareFetcher.test.ts`, `src/app/page.tsx`,
      `plans/README.md`
- [ ] `git diff -- src/remote/firmwareFetcher.ts | grep '^[-+].*http://'`
      returns **no matches** — this plan must not touch the plain-HTTP official
      URLs, which belong to plan 003
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `plans/001-test-baseline-ota-and-firmware-logic.md` has not been executed
  (there is no `test` script in `package.json`). This plan's Step 2 depends on
  the vitest runner it installs. Do not install a test runner yourself.
- `curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/Unintendedsideeffects/ForkDrift-crosspointReader/releases/tags/latest"`
  does **not** return `200`. The whole plan is built on that endpoint existing.
- The `latest` release no longer contains an asset named exactly
  `crosspoint-standard.bin`. Check with:
  `curl -s "https://api.github.com/repos/Unintendedsideeffects/ForkDrift-crosspointReader/releases/tags/latest" | grep -o '"name": "crosspoint[^"]*"'`
  If the asset naming has changed, the firmware repo's `scripts/release.sh`
  changed and this plan needs re-deriving — report rather than guessing a new
  name.
- The `assets` array is empty or contains only `bootloader.bin` and
  `partitions.bin`. That is the shape of the stale `nightly` release; if
  `latest` looks like that, someone re-pointed the channels and the target
  needs a human decision.
- Step 3's UI change requires touching a Chakra component's props in a way that
  breaks the build. Report the exact TypeScript error rather than restructuring
  the button.
- You find yourself wanting to modify `getOfficialFirmwareRemoteData` or any
  `http://` URL. That is plan 003's scope — stop and report.

## Maintenance notes

For whoever owns this next:

- **The channel tag is a policy choice, not a constant of nature.** This plan
  targets the `latest` channel. `scripts/release.sh` in the firmware repo also
  supports `stable` and `nightly` (`release.sh:30`), but as of 2026-08-21 no
  `stable` release exists and `nightly` holds only `bootloader.bin` and
  `partitions.bin` — it is stale. If a `stable` channel starts being published,
  moving the flasher to it is a one-constant change.
- **The deferred profile picker.** The `latest` release publishes
  `crosspoint-lean.bin`, `crosspoint-standard.bin`, `crosspoint-full.bin` and
  two `-reset` variants. Exposing them is a genuinely useful follow-up, and the
  asset names are already a stable contract enforced by `release.sh`. It was
  left out here because it changes the button into a picker and touches
  `useEspOperations`'s action surface — a UI change riding along with a
  correctness fix makes both harder to review.
- **This is a hardcoded matcher against another repo's release conventions —
  the same class of coupling that caused this bug.** If the firmware repo
  renames its assets again, this breaks again, and only at runtime. The durable
  fix is for the firmware repo to publish a small `channels.json` manifest
  alongside the binaries that the flasher, the device's OTA picker, and the
  Android app all read. Worth doing if a third consumer appears.
- **A reviewer should scrutinize**: that the asset lookup uses `===` and not
  `endsWith`/`includes`, and that `setCached` is still unreachable on every
  throw path (a cached failure would persist for an hour).
- **Rate limits are real.** Unauthenticated `api.github.com` allows 60 requests
  per hour per IP. The 1-hour cache is per browser tab (an in-memory `Map`, not
  `localStorage`), so a user reloading repeatedly can hit the limit. Step 3's
  error label is what makes that diagnosable rather than mysterious.
