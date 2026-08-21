# Plan 003: Remove the vendor (English/Chinese) firmware flashing path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 883a7da..HEAD -- src/remote/firmwareFetcher.ts src/app/page.tsx src/esp/useEspOperations.ts`
> Plans 001 and 002 are expected to have changed the first two files. Compare
> the "Current state" excerpts below against the live code before proceeding;
> on a mismatch in the _vendor-firmware_ code specifically, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-test-baseline-ota-and-firmware-logic.md`,
  `plans/002-repoint-community-firmware-to-forkdrift.md` (both touch
  `src/remote/firmwareFetcher.ts`)
- **Category**: security
- **Planned at**: commit `883a7da`, 2026-08-21
- **Supersedes**: an earlier draft of this plan titled "Verify official firmware
  against the vendor's published SHA-256". That approach was abandoned after a
  scope decision — see "Why this matters".

## Why this matters

This app downloads a firmware binary over **plain HTTP** from a third-party
vendor server and writes it to an ESP32's flash with no integrity check of any
kind (`src/remote/firmwareFetcher.ts:25,32,38,40`). Anyone able to modify the
user's network path can substitute arbitrary bytes and have this app flash
them.

An earlier draft of this plan proposed hardening that path: verify the
downloaded bytes against the SHA-256 the vendor API already publishes, and
surface honest errors instead of a silent stale fallback. That work is real but
it is **maintaining a feature this project has decided not to own**. The
decision, made 2026-08-21: this flasher exists to install **ForkDrift**
firmware. Flashing stock vendor firmware is not its job.

Three facts make removal clearly better than hardening:

1. **The feature is already dead in production.** Both deploy targets serve
   over HTTPS — GitHub Pages via `.github/workflows/pages.yml`, and Vercel via
   `vercel.json`. `src/app/page.tsx:1` is `'use client'` and the metadata fetch
   runs in a `useEffect` (`page.tsx:35-41`), so these are browser-initiated
   `http://` subresource requests from an `https://` page. Browsers block those
   as mixed content, and no CSP `upgrade-insecure-requests` is set
   (`next.config.ts` sets only `Permissions-Policy`). Nobody is successfully
   using these buttons today.
2. **Restoring it would need infrastructure this project does not want.** The
   vendor does not serve HTTPS (verified: `https://gotaserver.xteink.com/…`
   does not answer; only `http://` does). Working around that needs a
   same-origin proxy, which works on Vercel but **cannot be statically
   exported** for the GitHub Pages deploy — so the two deploys would diverge.
3. **The fallback is actively misleading.** `firmwareFetcher.ts:20-35`
   hardcodes `V3.1.1` as the English firmware version, and it is used silently
   via `.catch(() => firmwareVersionFallback)` at `:91`. The vendor currently
   ships **`V5.1.6`**. Because of (1), that stale number is what the deployed
   UI actually displays.

Deleting the path removes the vulnerability outright rather than mitigating it,
deletes ~90 lines, and removes the only plain-HTTP traffic in the app. Users who
genuinely need stock vendor firmware still have a working route: download the
`.bin` from the vendor themselves and use the existing **Write flash from
file** / custom-firmware upload, which this plan leaves fully intact.

## Current state

### What gets deleted from `src/remote/firmwareFetcher.ts`

**Lines 1-10** — the vendor types:

```ts
interface OfficialFirmwareData {
  change_log: string;
  download_url: string;
  version: string;
}

interface OfficialFirmwareVersions {
  en: OfficialFirmwareData;
  ch: OfficialFirmwareData;
}
```

**Lines 20-40** — the hardcoded fallback and the two plain-HTTP endpoints
(abridged here; delete the whole `firmwareVersionFallback` object and both URL
constants):

```ts
const firmwareVersionFallback: OfficialFirmwareVersions = {
  en: {
    /* … version: 'V3.1.1', download_url: 'http://…' … */
  },
  ch: {
    /* … version: 'V3.1.9', download_url: 'http://…' … */
  },
};

const chineseFirmwareCheckUrl =
  'http://47.122.74.33:5000/api/check-update?current_version=V3.0.1&device_type=ESP32C3';
const englishFirmwareCheckUrl =
  'http://gotaserver.xteink.com/api/check-update?current_version=V3.0.1&device_type=ESP32C3&device_id=1234';
```

**Lines 68-101** — `getOfficialFirmwareRemoteData` and
`getOfficialFirmwareVersions`.

**Lines 137-143** — `getOfficialFirmware`:

```ts
export async function getOfficialFirmware(region: 'en' | 'ch') {
  const url = await getOfficialFirmwareRemoteData().then(
    (data) => data[region].download_url,
  );
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}
```

**What must survive** in that file: the `CacheEntry` type, `memoryCache`,
`getCached`, `setCached` (lines 42-66) — the community path uses them — and
everything plan 002 wrote (`getCommunityFirmwareRemoteData`,
`getCommunityFirmware`, and the GitHub release interfaces).

### What gets deleted from `src/esp/useEspOperations.ts`

**Line 6** — the import (leave `getCommunityFirmware` on line 5):

```ts
import {
  getCommunityFirmware,
  getOfficialFirmware,
} from '@/remote/firmwareFetcher';
```

**Lines 158-161**:

```ts
const flashEnglishFirmware = async () =>
  flashRemoteFirmware(() => getOfficialFirmware('en'));
const flashChineseFirmware = async () =>
  flashRemoteFirmware(() => getOfficialFirmware('ch'));
```

**Lines 583-584**, inside the hook's returned `actions` object:

```ts
    actions: {
      flashEnglishFirmware: wrapWithRunningWakeLock(flashEnglishFirmware),
      flashChineseFirmware: wrapWithRunningWakeLock(flashChineseFirmware),
      flashCrossPointFirmware: wrapWithRunningWakeLock(flashCrossPointFirmware),
      flashCustomFirmware: wrapWithRunningWakeLock(flashCustomFirmware),
      saveFullFlash: wrapWithRunningWakeLock(saveFullFlash),
      writeFullFlash: wrapWithRunningWakeLock(writeFullFlash),
      fakeWriteFullFlash: wrapWithRunning(fakeWriteFullFlash),
    },
```

**What must survive**: `flashRemoteFirmware` itself
(`useEspOperations.ts:73-155`) — `flashCrossPointFirmware` still calls it.
Deleting it would break the ForkDrift path.

### What gets deleted from `src/app/page.tsx`

**Line 19** — the import; **lines 25-28** — the state; **lines 35-38** — the
`useEffect` call:

```tsx
const [officialFirmwareVersions, setOfficialFirmwareVersions] = useState<{
  en: string;
  ch: string;
} | null>(null);
```

```tsx
getOfficialFirmwareVersions().then((versions) =>
  setOfficialFirmwareVersions(versions),
);
```

**Lines 150-165** — the two buttons (keep the `flashCrossPointFirmware` button
immediately after them):

```tsx
          <Button
            variant="subtle"
            onClick={actions.flashEnglishFirmware}
            disabled={isRunning || !officialFirmwareVersions}
            loading={!officialFirmwareVersions}
          >
            Flash English firmware ({officialFirmwareVersions?.en ?? '...'})
          </Button>
          <Button
            variant="subtle"
            onClick={actions.flashChineseFirmware}
            disabled={isRunning || !officialFirmwareVersions}
            loading={!officialFirmwareVersions}
          >
            Flash Chinese firmware ({officialFirmwareVersions?.ch ?? '...'})
          </Button>
```

**Two prose blocks reference the deleted buttons by name and must be reworded,
not deleted.** `page.tsx:72-77`:

```tsx
<p>
  Once you start <b>Write flash from file</b> or <b>Flash English firmware</b>,
  you should avoid disconnecting your device or closing the tab until the
  operation is complete. Writing a full flash from your backup should always
  restore your device to its old state.
</p>
```

and `page.tsx:139-146`:

```tsx
              <b>Flash English/Chinese firmware</b> will download the firmware,
              overwrite the backup partition with the new firmware, and swap
              over to using this partition (leaving your existing firmware as
              the new backup). This is significantly faster than a full flash
              write and will retain all your settings. If it goes wrong, it
              should be fine to run again.
```

In both, replace the vendor button names with **`Flash ForkDrift firmware`**
(the label plan 002 gives the community button). The surrounding advice is
still true — it describes the OTA fast-flash mechanism, which is unchanged.

**Do NOT delete the "Change device language" alert** at `page.tsx:222-234`. It
tells a user arriving from stock Chinese firmware to switch the device to
English _before_ flashing. That is still useful advice for exactly the audience
this flasher serves.

### Repo conventions to match

- TypeScript strict, `noUncheckedIndexedAccess` on (`tsconfig.json:19`).
- Prettier is CI-enforced. Do not hand-format; run the formatter.
- ESLint with `--max-warnings 0`. An unused import or variable left behind
  after a deletion **will fail the gate** — that is a feature, use it.
- Commit style: conventional commits, e.g.
  `feat: remove vendor firmware flashing in favour of ForkDrift-only`.

## Commands you will need

**There is no `yarn` binary on PATH and `corepack` is not installed.** Yarn 4
is vendored; invoke it through `node`.

| Purpose             | Command                                                  | Expected on success                                            |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Install             | `node .yarn/releases/yarn-4.11.0.cjs install`            | exit 0                                                         |
| Lint (full CI gate) | `node .yarn/releases/yarn-4.11.0.cjs lint`               | exit 0, ends with `All matched files use Prettier code style!` |
| Tests               | `node .yarn/releases/yarn-4.11.0.cjs test`               | exit 0, all pass                                               |
| Format              | `node .yarn/releases/yarn-4.11.0.cjs prettier --write .` | exit 0                                                         |
| Production build    | `node .yarn/releases/yarn-4.11.0.cjs build`              | exit 0                                                         |
| Dev server          | `node .yarn/releases/yarn-4.11.0.cjs dev`                | serves http://localhost:3000                                   |

Run from the repository root (`/home/malcolm/Code/ForkDrift/xteink-flasher`).

## Scope

**In scope**:

- `src/remote/firmwareFetcher.ts` — delete the vendor path only
- `src/remote/firmwareFetcher.test.ts` — remove any vendor-path tests, if plan
  002 left some
- `src/esp/useEspOperations.ts` — delete the two actions and the import
- `src/app/page.tsx` — delete the two buttons and their state; reword two prose
  blocks
- `README.md` — only if it advertises vendor-firmware flashing
- `plans/README.md` — status row only

**Out of scope** (do NOT touch, even though they look related):

- **`flashRemoteFirmware`** (`useEspOperations.ts:73-155`) — still used by the
  ForkDrift path. Deleting it breaks the app.
- **`flashCustomFirmware`, `saveFullFlash`, `writeFullFlash`,
  `fakeWriteFullFlash`, and the `FileUpload` components** — the manual-upload
  route is the documented replacement for the feature being removed. It must
  keep working.
- **`src/utils/firmwareIdentifier.ts`** — it identifies `official-english` /
  `official-chinese` firmware **already installed on the device**, which the
  debug panel still reports. That is reading, not flashing. Leave it and its
  tests entirely alone.
- **The `'CrossPoint or official firmware with the default partition table'`
  error message** at `useEspOperations.ts:106` — it describes what partition
  layout the _device_ must have, which is still accurate. Do not reword it.
- **The "Change device language" alert** (`page.tsx:222-234`).
- **`next.config.ts`, `vercel.json`, `.github/workflows/`** — no deploy change
  is needed.
- `eslint.config.mjs` — auto-generated.

## Git workflow

- Branch: `advisor/003-remove-vendor-firmware` off `fork-drift`, **after** plan
  002 has landed.
- Commit per step. Conventional commits.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Delete the vendor path from the fetcher

Remove from `src/remote/firmwareFetcher.ts`: the `OfficialFirmwareData` and
`OfficialFirmwareVersions` interfaces, the `firmwareVersionFallback` constant,
`chineseFirmwareCheckUrl`, `englishFirmwareCheckUrl`,
`getOfficialFirmwareRemoteData`, `getOfficialFirmwareVersions`, and
`getOfficialFirmware`.

Keep `CacheEntry`, `memoryCache`, `getCached`, `setCached`, and everything plan
002 added.

**Verify**:

```
grep -c "http://" src/remote/firmwareFetcher.ts
```

→ must print `0`. This is the security done-criterion: no plain-HTTP URL
remains in the file.

### Step 2: Delete the two flash actions

In `src/esp/useEspOperations.ts`, remove `flashEnglishFirmware`,
`flashChineseFirmware`, their two entries in the returned `actions` object, and
`getOfficialFirmware` from the import on line 6 (leaving `getCommunityFirmware`).

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs tsc` → exit 0. TypeScript will
error if you missed a reference.

### Step 3: Delete the buttons and reword the prose

In `src/app/page.tsx`:

1. Remove the `getOfficialFirmwareVersions` import, the
   `officialFirmwareVersions` state, and its call inside the `useEffect`.
   Leave the `getCommunityFirmwareRemoteData` call in that same `useEffect`
   intact.
2. Remove the two `<Button>` blocks at lines 150-165.
3. Reword the two prose blocks described in "Current state" so they name
   **`Flash ForkDrift firmware`** instead of the deleted buttons.
4. Leave the "Change device language" alert alone.

**Verify**:

```
grep -rn "flashEnglishFirmware\|flashChineseFirmware\|officialFirmwareVersions\|getOfficialFirmware" src/
```

→ must return **no matches**.

### Step 4: Prune vendor tests, if any exist

If plan 002 left tests covering `getOfficialFirmwareRemoteData` or
`getOfficialFirmware` in `src/remote/firmwareFetcher.test.ts`, delete those
cases. Do **not** delete tests for the community path.

Do not delete anything in `src/utils/firmwareIdentifier.test.ts` — that file
tests firmware _identification_, which is out of scope and still used.

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → exit 0, all pass.

### Step 5: Check the README

```
grep -rniE "english firmware|chinese firmware|official firmware" README.md
```

If any hit advertises flashing vendor firmware as a feature, update it to
describe the ForkDrift path plus the manual-upload route. If there are no hits,
skip — do not invent README changes.

**Verify**: the grep returns nothing, or the remaining hits are accurate.

### Step 6: Manual smoke check

```
node .yarn/releases/yarn-4.11.0.cjs dev
```

Open http://localhost:3000 and confirm, **without connecting a device**:

- The English and Chinese firmware buttons are gone.
- The **Flash ForkDrift firmware** button is present and resolves out of its
  loading state.
- **Write flash from file** and the file-upload controls are still present.
- The browser devtools Network tab shows **no `http://` requests at all**.
- The Console shows no errors and no unhandled promise rejections.

Stop the dev server when done.

**Verify**: all five bullets hold.

### Step 7: Format, gate, and build

```
node .yarn/releases/yarn-4.11.0.cjs prettier --write .
node .yarn/releases/yarn-4.11.0.cjs lint
node .yarn/releases/yarn-4.11.0.cjs test
node .yarn/releases/yarn-4.11.0.cjs build
```

**Verify**: all four exit 0.

## Test plan

This plan removes code; it adds no tests. Verification is:

- **`node .yarn/releases/yarn-4.11.0.cjs test` still passes**, proving the
  community-firmware tests from plan 002 and the identifier/OTA tests from plan
  001 are unaffected.
- **`grep -c "http://" src/` returns 0 for `src/remote/`**, proving the
  insecure transport is gone rather than merely unreferenced.
- **Step 6's manual check**, proving the replacement route (manual upload) still
  works.

If you find yourself writing a new test in this plan, stop — you are probably
adding behavior rather than removing it.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node .yarn/releases/yarn-4.11.0.cjs lint` exits 0
- [ ] `node .yarn/releases/yarn-4.11.0.cjs test` exits 0
- [ ] `node .yarn/releases/yarn-4.11.0.cjs build` exits 0
- [ ] `grep -rn "http://" src/` returns **no matches**
- [ ] `grep -rn "flashEnglishFirmware\|flashChineseFirmware\|getOfficialFirmware\|officialFirmwareVersions\|firmwareVersionFallback" src/`
      returns **no matches**
- [ ] `grep -rn "gotaserver\|47.122.74.33" src/` returns **no matches**
- [ ] `grep -n "flashRemoteFirmware" src/esp/useEspOperations.ts` still returns
      matches (it must survive)
- [ ] `grep -n "flashCustomFirmware" src/esp/useEspOperations.ts` still returns
      a match
- [ ] `git diff --stat -- src/utils/firmwareIdentifier.ts src/utils/firmwareIdentifier.test.ts`
      is **empty**
- [ ] Step 6's manual check passed (record which bullets you observed)
- [ ] `git status --porcelain` lists only: `src/remote/firmwareFetcher.ts`,
      `src/esp/useEspOperations.ts`, `src/app/page.tsx`, `plans/README.md`, and
      optionally `src/remote/firmwareFetcher.test.ts` and `README.md`
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `plans/002-repoint-community-firmware-to-forkdrift.md` is not DONE in
  `plans/README.md`. Both plans edit `src/remote/firmwareFetcher.ts`.
- After Step 1, `grep -n "getCommunityFirmware" src/remote/firmwareFetcher.ts`
  returns **nothing** — you deleted too much. Restore and redo the step,
  removing only the named symbols.
- Deleting `flashEnglishFirmware`/`flashChineseFirmware` appears to require
  deleting `flashRemoteFirmware`. It does not — `flashCrossPointFirmware` calls
  it.
- Step 6 shows the **Flash ForkDrift firmware** button missing or permanently
  loading. That is a plan-002 regression surfacing, not something to fix here.
- Any test in `src/utils/firmwareIdentifier.test.ts` or `src/esp/*.test.ts`
  starts failing. Those files are out of scope; a failure there means a
  deletion reached further than intended.
- You conclude the vendor path should be kept after all. That was a product
  decision made on 2026-08-21 with the maintainer; report your reasoning rather
  than reversing it unilaterally.

## Maintenance notes

For whoever owns this next:

- **What users lose, and their replacement route.** One-click reflash back to
  stock Xteink firmware. The replacement is: download the `.bin` from the
  vendor (`http://gotaserver.xteink.com/api/check-update?current_version=V3.0.1&device_type=ESP32C3&device_id=1234`
  returns a JSON `data.download_url`, plus `data.checksums.sha256` to verify it
  by hand) and use **Write flash from file**. Worth a README line if anyone
  asks.
- **This deletes the app's only plain-HTTP traffic.** After this lands, adding
  any `http://` URL to `src/` is a regression. The `grep -rn "http://" src/`
  done-criterion is cheap enough to promote into a CI step if it ever recurs —
  that would be the third rung of the escalation ladder, and it is not needed
  yet.
- **The abandoned alternative, for the record.** The prior draft of this plan
  added SHA-256 verification against `data.checksums.sha256`, which the vendor
  API does publish (alongside `md5`, `sha1`, `crc32`, and `size`). If ForkDrift
  ever _does_ want to serve vendor firmware, that draft's design is the right
  one — verify the digest before flashing, and never flash bytes obtained from
  a fallback. It is recoverable from this file's git history.
- **A reviewer should scrutinise**: that `flashRemoteFirmware`,
  `flashCustomFirmware`, and the whole `saveFullFlash`/`writeFullFlash` group
  survived intact, and that no prose in `page.tsx` still names a button that no
  longer exists.
