# Plan 001: Establish a test baseline covering OTA boot-slot selection and firmware identification

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 883a7da..HEAD -- src/esp/ src/utils/ package.json`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `883a7da`, 2026-08-21

## Why this matters

This repository is a browser-based firmware flasher for the Xteink X4 e-ink
reader. It writes raw bytes to an ESP32's OTA app partitions and then rewrites
the `otadata` partition to select which slot boots next. If the boot-slot
selection logic is wrong, the device flashes "successfully" and then does not
boot — a failure the user only discovers after the fact, on hardware, with no
error message.

That logic (`src/esp/OtaPartition.ts`) is pure, synchronous, byte-level code:
exactly the kind that is cheap to test and expensive to debug on a device.
Today the repository has **no test runner at all** — no `test` script, no
runner config, no test files. The only CI gate is `yarn lint`, which checks
formatting and types but executes nothing.

After this plan lands there is a working `yarn test` command and a suite
covering the byte-level logic, so later changes (plans 002 and 003 both touch
firmware fetching) have something to regress against. **This plan must land
before 002 and 003** — it is the verification baseline they rely on.

This plan adds tests only. It does **not** change any behavior.

## Current state

### The repository has no test infrastructure

- `package.json:5-11` — the full script list. There is no `test` entry:

```json
  "scripts": {
    "lint": "yarn eslint --max-warnings 0 --cache && yarn prettier --check . && yarn tsc",
    "lint:fix": "yarn eslint --max-warnings 0 --cache --fix && yarn prettier --write .",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "prepare": "husky"
  },
```

- `package.json` devDependencies include `"@types/jest": "^30.0.0"` but **no
  `jest` package and no jest config exists anywhere in the repo**. Treat that
  dependency as leftover intent, not a decision — see Step 1.
- `find . -name "*.test.ts*" -not -path "./node_modules/*"` returns nothing.

### The code under test

**`src/esp/OtaPartition.ts`** — parses and rewrites the ESP32 `otadata`
partition. `otadata` is two 0x1000-byte slots; slot 0 describes `app0`, slot at
offset `0x1000` describes `app1`. Each slot holds a 4-byte little-endian
sequence number at offset 0, a 4-byte state at `+0x18`, and a 4-byte CRC at
`+0x1c`. The bootloader picks the valid slot with the **highest** sequence.

`src/esp/OtaPartition.ts:24-68`:

```ts
  otaAppPartitions(): [OtaPartitionDetails, OtaPartitionDetails] {
    if (!this.cachedOtaAppParitions) {
      this.cachedOtaAppParitions = [
        this.parseOtaAppPartition('app0'),
        this.parseOtaAppPartition('app1'),
      ];
    }

    return this.cachedOtaAppParitions;
  }

  getCurrentBootPartition() {
    const partitions = this.otaAppPartitions();

    return partitions
      .filter(
        ({ state, crcValid }) =>
          !['invalid', 'aborted'].includes(state) && crcValid,
      )
      .sort((a, b) => b.sequence - a.sequence)[0];
  }

  getCurrentBootPartitionLabel() {
    return this.getCurrentBootPartition()?.partitionLabel ?? 'app0';
  }

  getCurrentBackupPartitionLabel() {
    return this.getCurrentBootPartitionLabel() === 'app0' ? 'app1' : 'app0';
  }

  setBootPartition(partitionLabel: OtaPartitionDetails['partitionLabel']) {
    const currentBootPartition = this.getCurrentBootPartition();

    if (currentBootPartition?.partitionLabel === partitionLabel) {
      return;
    }

    const nextSequence = (currentBootPartition?.sequence ?? 0) + 1;
    this.setOtaPartitionDetails({
      partitionLabel,
      sequence: nextSequence,
      state: OtaPartitionState.NEW,
      crcBytes: generateCrc32Le(nextSequence),
    });
  }
```

`src/esp/OtaPartition.ts:70-96` (parse + write):

```ts
  private parseOtaAppPartition(
    partitionLabel: OtaPartitionDetails['partitionLabel'],
  ) {
    const offset = partitionLabel === 'app1' ? 0x1000 : 0;

    const sequenceBytes = this.data.slice(offset, offset + 4);
    const sequence = leBytesToU32(sequenceBytes);
    const stateBytes = this.data.slice(offset + 0x18, offset + 0x1c);
    const crcBytes = this.data.slice(offset + 0x1c, offset + 0x20);
    const expectedCrcBytes = generateCrc32Le(sequence);

    return {
      partitionLabel,
      sequence,
      state: otaPartitionStateFromBytes(stateBytes),
      crcBytes,
      crcValid: isEqualBytes(crcBytes, expectedCrcBytes),
    };
  }

  private setOtaPartitionDetails(partition: OtaPartitionDetails) {
    const offset = partition.partitionLabel === 'app1' ? 0x1000 : 0;

    this.cachedOtaAppParitions = null;
    this.data.set(u32ToLeBytes(partition.sequence), offset);
    this.data.set(otaPartitionStateToBytes(partition.state), offset + 0x18);
    this.data.set(generateCrc32Le(partition.sequence), offset + 0x1c);
  }
```

**`src/esp/OtaPartitionState.ts:19-46`** — state enum conversion. Note the
asymmetry, which Step 4 tests explicitly: `otaPartitionStateFromBytes` can
return `ABORTED` (from byte value `4`), but `otaPartitionStateToBytes` has
**no branch for `ABORTED`** and throws `'Invalid state'`:

```ts
export function otaPartitionStateToBytes(
  otaPartitionState: OtaPartitionState,
): Uint8Array {
  if (otaPartitionState === OtaPartitionState.NEW) return u32ToLeBytes(0);
  if (otaPartitionState === OtaPartitionState.PENDING_VERIFY)
    return u32ToLeBytes(1);
  if (otaPartitionState === OtaPartitionState.VALID) return u32ToLeBytes(2);
  if (otaPartitionState === OtaPartitionState.INVALID) return u32ToLeBytes(3);
  if (otaPartitionState === OtaPartitionState.UNDEFINED)
    return new Uint8Array([0xff, 0xff, 0xff, 0xff]);

  throw new Error('Invalid state');
}
```

This is currently unreachable (`setBootPartition` only ever writes `NEW`), so
**do not fix it in this plan** — write a test that documents the behavior as it
is. See Step 4 and the maintenance notes.

**`src/utils/bytes.ts:1-33`** — `u32ToLeBytes`, `leBytesToU32`, `isEqualBytes`.
`leBytesToU32` uses `>>>` to force unsigned:

```ts
export function leBytesToU32(bytes: Uint8Array) {
  return (
    (bytes.at(0) ?? 0) +
    (((bytes.at(1) ?? 0) << 8) >>> 0) +
    (((bytes.at(2) ?? 0) << 16) >>> 0) +
    (((bytes.at(3) ?? 0) << 24) >>> 0)
  );
}
```

**`src/utils/crc.ts:1-7`** — CRC32 over the little-endian sequence, seeded
`0xffffffff`:

```ts
import crc32 from 'crc/crc32';
import { u32ToLeBytes } from './bytes';

export function generateCrc32Le(sequence: number) {
  const value = crc32(u32ToLeBytes(sequence).buffer, 0xffffffff);
  return u32ToLeBytes(value);
}
```

**`src/utils/firmwareIdentifier.ts`** — identifies a firmware image from its
bytes. Key exported functions: `identifyFirmware(data: Uint8Array):
FirmwareInfo` and `isIdentificationSuccessful(info)`. Internals (`findString`,
`isValidEsp32Image`, `extractVersion`) are **not exported** — test them through
`identifyFirmware`. The discriminator logic, `firmwareIdentifier.ts:139-203`:

- Valid ESP32 image = byte `0` is `0xe9` **and** the little-endian u32 at
  offset `0x20` is `0xabcd5432`.
- If a `V<d>.<d>.<d>` version is found, the image is valid, and the literal
  `XTOS` appears within 50 bytes either side of the version → `official-chinese`.
- Same but no `XTOS` nearby → `official-english`.
- Otherwise, if `CrossPoint-ESP32-` or `Starting CrossPoint version` appears
  anywhere in the data → `crosspoint`.
- Otherwise → `unknown`.

### Repo conventions to match

- **TypeScript strict mode is on**, including `noUncheckedIndexedAccess`
  (`tsconfig.json:19`). Indexing an array yields `T | undefined`; you must
  narrow with `?? fallback`, `!`, or an explicit check. Existing code uses
  non-null assertion sparingly — see `firmwareIdentifier.ts:98`
  (`crossPointMatch[1]!`).
- **Path alias**: `@/*` maps to `./src/*` (`tsconfig.json:27-29`). Existing
  files use both the alias (`OtaPartitionState.ts:1` imports
  `'@/utils/bytes'`) and relative paths (`crc.ts:2` imports `'./bytes'`).
  Either is fine; prefer the alias in new test files.
- **Formatting is enforced by Prettier** and checked in CI. Do not hand-format;
  run the formatter (Step 6).
- **ESLint runs with `--max-warnings 0`** using an airbnb-extended config. Two
  rules will bite you in tests: `no-bitwise` (already disabled file-wide at
  `bytes.ts:1` via `/* eslint-disable no-bitwise */`) and
  `no-restricted-syntax` for `for...of` (see the disable comment at
  `firmwareIdentifier.ts:103`). Prefer `Array.prototype` methods over
  `for...of` in tests, or add a scoped disable comment as the existing code does.
- **Commit message style** is conventional-commit-ish. From `git log --oneline`:
  `rebrand: rename Xteink → FORKDRIFT across UI strings and error messages`,
  `fix: add force-static to manifest route for static export`,
  `feat: add PWA install flow for Android flashing`.

## Commands you will need

**There is no `yarn` binary on PATH and `corepack` is not installed.** Yarn 4
is vendored in the repo. Every command below invokes it directly through
`node`. Do not substitute `npm` or a bare `yarn`.

| Purpose              | Command                                                  | Expected on success                                            |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Yarn version check   | `node .yarn/releases/yarn-4.11.0.cjs --version`          | prints `4.11.0`                                                |
| Install              | `node .yarn/releases/yarn-4.11.0.cjs install`            | exit 0                                                         |
| Add a dev dep        | `node .yarn/releases/yarn-4.11.0.cjs add -D <pkg>`       | exit 0                                                         |
| Lint (full CI gate)  | `node .yarn/releases/yarn-4.11.0.cjs lint`               | exit 0, ends with `All matched files use Prettier code style!` |
| Format               | `node .yarn/releases/yarn-4.11.0.cjs prettier --write .` | exit 0                                                         |
| Tests (after Step 1) | `node .yarn/releases/yarn-4.11.0.cjs test`               | exit 0, all pass                                               |

Run all commands from the repository root
(`/home/malcolm/Code/ForkDrift/xteink-flasher`).

**Baseline**: `yarn lint` was verified green at commit `883a7da` before this
plan was written. If it fails before you have changed anything, that is a STOP
condition.

**Node version note**: `.tool-versions` pins `nodejs 24`; the local machine has
node v26. The lint gate passes on v26. If you hit an error that names a Node
API version, report it rather than downgrading anything.

## Scope

**In scope** (the only files you should create or modify):

- `package.json` — add `test` script, add vitest, remove `@types/jest`
- `vitest.config.ts` (create)
- `src/utils/bytes.test.ts` (create)
- `src/utils/crc.test.ts` (create)
- `src/utils/firmwareIdentifier.test.ts` (create)
- `src/esp/OtaPartitionState.test.ts` (create)
- `src/esp/OtaPartition.test.ts` (create)
- `.github/workflows/ci.yml` — add a test step
- `yarn.lock` — will change as a side effect of adding vitest; commit it
- `plans/README.md` — status row only

**Out of scope** (do NOT touch, even though they look related):

- **Any file under `src/` that is not a new `*.test.ts`.** This plan adds tests
  only. If a test reveals a bug, write the test to document the _actual_
  current behavior, add a `// BUG:` comment above it, and report it in your
  summary. Do not fix it here.
- `src/esp/EspController.ts`, `src/esp/useEspOperations.ts`,
  `src/esp/useStepRunner.ts` — these talk to real hardware over WebSerial /
  WebUSB. Testing them needs a transport fake, which is a separate, larger
  piece of work. Explicitly deferred.
- `src/remote/firmwareFetcher.ts` — plans 002 and 003 rewrite this. Adding
  tests for it now would guarantee a conflict.
- Any React component or `.tsx` file — no DOM testing setup in this plan.
- `eslint.config.mjs` — it is auto-generated (see the header comment at
  `eslint.config.mjs:1-6`). If ESLint complains about test files, fix the test
  code, do not edit the config.

## Git workflow

- Branch: `advisor/001-test-baseline` off the current branch (`fork-drift`).
- Commit per step or per logical unit. Message style: conventional commits, e.g.
  `test: add vitest and cover OTA boot-slot selection`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add vitest and a `test` script

Use **vitest**, not jest. Rationale (so you do not second-guess it): this is an
ESM + TypeScript + Next 16 project with a `@/*` path alias; vitest reads
`tsconfig.json` paths through a single config file and needs no Babel or
transform setup, whereas jest needs a transformer plus explicit
`moduleNameMapper`. The stray `@types/jest` in devDependencies is leftover
intent — there is no jest package and no jest config — so remove it as part of
this step.

1. Install vitest:

```
node .yarn/releases/yarn-4.11.0.cjs add -D vitest vite-tsconfig-paths
```

2. Remove the unused jest types:

```
node .yarn/releases/yarn-4.11.0.cjs remove @types/jest
```

3. Create `vitest.config.ts` at the repository root:

```ts
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

4. Add a `test` script to `package.json`. Keep the existing scripts unchanged
   and keep the file's existing key order; insert `test` after `lint:fix`:

```json
    "test": "vitest run",
```

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → exits 0 and reports
`No test files found` (or equivalent). This confirms the runner is wired before
any tests exist.

Also confirm the types still check: `node .yarn/releases/yarn-4.11.0.cjs tsc`
→ exit 0, no output.

### Step 2: Test `src/utils/bytes.ts`

Create `src/utils/bytes.test.ts`. Cover:

- `u32ToLeBytes(0)` → `Uint8Array [0, 0, 0, 0]`
- `u32ToLeBytes(1)` → `[1, 0, 0, 0]`
- `u32ToLeBytes(0x12345678)` → `[0x78, 0x56, 0x34, 0x12]`
- `u32ToLeBytes(0xffffffff)` → `[0xff, 0xff, 0xff, 0xff]`
- `leBytesToU32` round-trips each of the above back to the original number.
  **This is the important one**: `0xffffffff` must round-trip to `4294967295`,
  not `-1`. That is what the `>>> 0` operators in `leBytesToU32` exist for.
- `leBytesToU32(new Uint8Array([]))` → `0` (the `?? 0` fallbacks)
- `leBytesToU32(new Uint8Array([1, 2]))` → `513` (short input, missing bytes
  treated as zero)
- `isEqualBytes`: equal arrays → `true`; same length different content →
  `false`; different lengths → `false`; two empty arrays → `true`

Use `expect(...).toEqual(new Uint8Array([...]))` for byte arrays — `toBe` does
identity comparison and will fail.

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → all pass, ~8 tests in
1 file.

### Step 3: Test `src/utils/crc.ts`

Create `src/utils/crc.test.ts`. `generateCrc32Le` is a thin wrapper over the
`crc` package, so test the properties that matter rather than hardcoding
magic constants you cannot derive:

- It returns a `Uint8Array` of length 4, for inputs `0`, `1`, and `255`.
- It is deterministic: two calls with the same input are `toEqual`.
- Different sequences produce different CRCs: assert
  `generateCrc32Le(1)` is not `toEqual` to `generateCrc32Le(2)`.
- Round-trip against the parser: for sequence `n`,
  `leBytesToU32(generateCrc32Le(n))` returns a number in `[0, 0xffffffff]`.

**If you want an exact-value regression test**, compute the expected bytes by
calling the function once and pasting the observed output as a literal — but
mark it clearly:

```ts
// Golden value: captured from the current implementation to detect
// accidental changes to the CRC seed or byte order. Not independently derived.
```

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → all pass.

### Step 4: Test `src/esp/OtaPartitionState.ts`

Create `src/esp/OtaPartitionState.test.ts`. Cover:

- `otaPartitionStateFromBytes` for every documented value: `0`→`NEW`,
  `1`→`PENDING_VERIFY`, `2`→`VALID`, `3`→`INVALID`, `4`→`ABORTED`,
  `0xffffffff`→`UNDEFINED`. Build inputs with `u32ToLeBytes`.
- `otaPartitionStateFromBytes(u32ToLeBytes(5))` throws `'Invalid state'`.
- `otaPartitionStateToBytes` for `NEW`, `PENDING_VERIFY`, `VALID`, `INVALID`,
  `UNDEFINED` — each round-trips back through `otaPartitionStateFromBytes`.
- **The asymmetry**: `otaPartitionStateToBytes(OtaPartitionState.ABORTED)`
  **throws**. Write this as a passing test asserting the throw, with this
  comment above it:

```ts
// BUG (documented, not fixed here): fromBytes() produces ABORTED for byte
// value 4, but toBytes() has no ABORTED branch and throws. Unreachable today
// because setBootPartition() only ever writes NEW. See plans/001 maintenance
// notes.
```

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → all pass.

### Step 5: Test `src/esp/OtaPartition.ts` — the boot-slot logic

Create `src/esp/OtaPartition.test.ts`. This is the highest-value file in the
plan; take the time to get the helper right.

First write a helper that builds a synthetic `otadata` buffer, so each test
reads as a scenario rather than as byte arithmetic:

```ts
const OTADATA_SIZE = 0x2000;

function buildOtadata(
  slots: {
    app0?: { sequence: number; state: OtaPartitionState; corruptCrc?: boolean };
    app1?: { sequence: number; state: OtaPartitionState; corruptCrc?: boolean };
  } = {},
): Uint8Array {
  const data = new Uint8Array(OTADATA_SIZE).fill(0xff);
  (['app0', 'app1'] as const).forEach((label) => {
    const slot = slots[label];
    if (!slot) return;
    const offset = label === 'app1' ? 0x1000 : 0;
    data.set(u32ToLeBytes(slot.sequence), offset);
    data.set(otaPartitionStateToBytes(slot.state), offset + 0x18);
    const crc = slot.corruptCrc
      ? new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      : generateCrc32Le(slot.sequence);
    data.set(crc, offset + 0x1c);
  });
  return data;
}
```

Note: the buffer is filled with `0xff` first because that is what erased flash
reads as, and `0xffffffff` is the `UNDEFINED` state — so a slot you do not
populate parses as `UNDEFINED` with sequence `0xffffffff`. Populate **both**
slots in any test where slot precedence matters, or you will be comparing
against a sequence of 4294967295.

Cases to cover:

1. **Higher sequence wins**: app0 seq 5 VALID, app1 seq 9 VALID →
   `getCurrentBootPartitionLabel()` is `'app1'`,
   `getCurrentBackupPartitionLabel()` is `'app0'`.
2. **Reverse**: app0 seq 9 VALID, app1 seq 5 VALID → boot `'app0'`,
   backup `'app1'`.
3. **`INVALID` state is skipped even with the higher sequence**: app0 seq 5
   VALID, app1 seq 9 INVALID → boot `'app0'`.
4. **`ABORTED` state is skipped even with the higher sequence**: app0 seq 5
   VALID, app1 seq 9 ABORTED → boot `'app0'`. (Build this one by writing the
   state bytes directly with `u32ToLeBytes(4)`, since
   `otaPartitionStateToBytes` throws on `ABORTED` — see Step 4.)
5. **A bad CRC disqualifies a slot**: app0 seq 5 VALID, app1 seq 9 VALID but
   `corruptCrc: true` → boot `'app0'`.
6. **No valid slot at all** (both corrupt CRCs) → `getCurrentBootPartition()`
   is `undefined` and `getCurrentBootPartitionLabel()` falls back to `'app0'`.
7. **`setBootPartition` bumps the sequence past the current boot slot**: start
   from case 1 (app1 at seq 9 booting), call `setBootPartition('app0')`, then
   assert:
   - `getCurrentBootPartitionLabel()` is now `'app0'`
   - the app0 slot's `sequence` is `10`
   - the app0 slot's `state` is `OtaPartitionState.NEW`
   - the app0 slot's `crcValid` is `true`
   - the **app1 slot bytes are unchanged** (compare the `0x1000..0x1020` range
     against the pre-call copy — take the copy with `.slice()` before calling)
8. **`setBootPartition` is a no-op when the target is already booting**: from
   case 1, call `setBootPartition('app1')` and assert the entire buffer is
   byte-identical to a `.slice()` copy taken beforehand.
9. **Cache invalidation**: from case 1, read `otaAppPartitions()` once, then
   call `setBootPartition('app0')`, then read `otaAppPartitions()` again and
   assert it reflects the new sequence. This guards the
   `this.cachedOtaAppParitions = null` line in `setOtaPartitionDetails`.

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → all pass, 9 tests in
this file.

### Step 6: Test `src/utils/firmwareIdentifier.ts`

Create `src/utils/firmwareIdentifier.test.ts`. Build synthetic images with a
helper:

```ts
function buildImage(payload: string, { valid = true } = {}): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const data = new Uint8Array(0x40 + body.length);
  data[0] = valid ? 0xe9 : 0x00;
  // App descriptor magic 0xabcd5432, little-endian, at offset 0x20.
  data.set(new Uint8Array([0x32, 0x54, 0xcd, 0xab]), 0x20);
  data.set(body, 0x40);
  return data;
}
```

Cases:

- **Chinese**: `buildImage('V3.1.9 XTOS build')` → `type` is
  `'official-chinese'`, `version` is `'V3.1.9'`.
- **English**: `buildImage('V3.1.1 build info')` (no `XTOS`) → `type` is
  `'official-english'`, `version` is `'V3.1.1'`.
- **`XTOS` too far away counts as English**: put `XTOS` more than 50 bytes
  after the version — `buildImage('V3.1.1' + ' '.repeat(80) + 'XTOS')` →
  `'official-english'`. This pins the proximity window.
- **CrossPoint**: `buildImage('CrossPoint-ESP32-0.12.0')` → `type` is
  `'crosspoint'`, `version` is `'0.12.0'`.
- **CrossPoint via the log-string path**:
  `buildImage('Starting CrossPoint version')` → `type` is `'crosspoint'`.
- **Invalid ESP32 header falls through to CrossPoint/unknown**:
  `buildImage('V3.1.1 XTOS', { valid: false })` → **not** `'official-chinese'`.
  Assert `type` is `'unknown'` (no CrossPoint marker present). This pins the
  `isValidImage` guard at `firmwareIdentifier.ts:158`.
- **Unknown**: `buildImage('nothing recognisable here')` → `type` is
  `'unknown'`.
- **Empty input**: `identifyFirmware(new Uint8Array())` → `type` is
  `'unknown'`, `version` is `'unknown'`. Must not throw.
- **`isIdentificationSuccessful`**: `false` only for `type === 'unknown'`;
  `true` for each of the other three types.

If any of these produce a different result than stated, **do not change
`firmwareIdentifier.ts`**. Assert the actual behavior, add a `// BUG:` comment
explaining the divergence from this plan, and report it. (These expectations
were derived by reading the code, not by running it.)

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs test` → all pass.

### Step 7: Format, lint, and wire tests into CI

1. Format everything you wrote:

```
node .yarn/releases/yarn-4.11.0.cjs prettier --write .
```

2. Add a test step to `.github/workflows/ci.yml`. The existing `lint` job ends
   with:

```yaml
- name: Run linter
  run: yarn lint
```

Add immediately after it, at the same indentation:

```yaml
- name: Run tests
  run: yarn test
```

(Inside GitHub Actions `yarn` resolves correctly via the checked-in
`.yarnrc.yml` and the `setup-node` yarn cache, so the bare `yarn` is right
**in CI** — only your local shell needs the `node .yarn/releases/...` form.)

**Verify**: `node .yarn/releases/yarn-4.11.0.cjs lint` → exit 0, ending with
`All matched files use Prettier code style!`

## Test plan

All tests are new; there is no existing test to model on in this repo. Follow
the structure described in Steps 2–6:

- One `describe` block per exported function.
- One `it` per named case listed above, with the case name as the test title.
- Build inputs with the `buildOtadata` / `buildImage` helpers rather than
  inline byte literals, so a reader can see the scenario.
- Byte-array assertions use `toEqual`, never `toBe`.

Final verification: `node .yarn/releases/yarn-4.11.0.cjs test` → **all pass**,
5 test files, roughly 40 tests total.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node .yarn/releases/yarn-4.11.0.cjs test` exits 0
- [ ] `node .yarn/releases/yarn-4.11.0.cjs lint` exits 0
- [ ] These five files exist and each contains at least one `it(`:
      `src/utils/bytes.test.ts`, `src/utils/crc.test.ts`,
      `src/utils/firmwareIdentifier.test.ts`,
      `src/esp/OtaPartitionState.test.ts`, `src/esp/OtaPartition.test.ts`
- [ ] `grep -n '"test"' package.json` returns a match
- [ ] `grep -c '@types/jest' package.json` returns `0`
- [ ] `grep -n 'Run tests' .github/workflows/ci.yml` returns a match
- [ ] `git status --porcelain` lists **only**: `package.json`, `yarn.lock`,
      `vitest.config.ts`, the five `*.test.ts` files,
      `.github/workflows/ci.yml`, `plans/README.md`, and (if yarn created it)
      `.yarn/install-state.gz`
- [ ] `git diff --stat -- src/esp/OtaPartition.ts src/esp/OtaPartitionState.ts src/utils/bytes.ts src/utils/crc.ts src/utils/firmwareIdentifier.ts`
      is **empty** — no production code changed
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `node .yarn/releases/yarn-4.11.0.cjs lint` fails **before** you have changed
  anything. The baseline was green at `883a7da`; a red baseline means the tree
  has drifted and the rest of this plan's assumptions are unsafe.
- `node .yarn/releases/yarn-4.11.0.cjs --version` does not print `4.11.0`, or
  the file `.yarn/releases/yarn-4.11.0.cjs` does not exist.
- Adding vitest changes any file under `src/` other than your new test files.
- The code at `src/esp/OtaPartition.ts:24-96` does not match the excerpts in
  "Current state" — in particular if the slot offset is not `0x1000`, or the
  state/CRC offsets are not `+0x18` / `+0x1c`. Every test in Step 5 depends on
  those constants.
- More than two of the Step 6 firmware-identification expectations turn out to
  be wrong. One or two divergences means this plan mis-read an edge case;
  three or more means `identifyFirmware` does not work the way this plan
  describes, and the test file should be designed against the real behavior by
  someone who can re-read it.
- A test reveals what looks like a real bug in production code. Document it
  with a `// BUG:` comment and a passing test of current behavior, then report
  it — **do not fix it in this plan**.

## Maintenance notes

For whoever owns this next:

- **The `ABORTED` asymmetry in `OtaPartitionState.ts` is real but currently
  unreachable.** `setBootPartition` only ever writes `NEW`. It becomes
  reachable the moment anything writes back a parsed partition unchanged
  (e.g. a "mark current slot valid" feature, or a round-trip refactor of
  `setOtaPartitionDetails`). The Step 4 test will start failing loudly at that
  point, which is the intent. Fix it by adding the `ABORTED` branch
  (`u32ToLeBytes(4)`) rather than by deleting the test.
- **Untested by design, and worth doing next**: `EspController.ts`,
  `useEspOperations.ts`, and `useStepRunner.ts` — the actual flash sequencing.
  They need a fake transport to test. `useEspOperations.ts:116-155` contains
  the flash ordering (read otadata → write backup app partition → rewrite
  otadata → reset), which is the other place a mistake bricks a device.
- **A reviewer should scrutinize**: the `buildOtadata` helper's `0xff` fill.
  If a future test asserts on a slot it did not populate, it will be comparing
  against sequence `4294967295` and state `UNDEFINED`, which can make a broken
  test look like it passes.
- **Plans 002 and 003 depend on this one.** Both modify
  `src/remote/firmwareFetcher.ts`, which this plan deliberately leaves
  untested; they add their own coverage on top of the runner installed here.
