# Verification Evidence — 2026-09-25 — Identity and Status UI

## Schema migration
pnpm drizzle-kit migrate: completed successfully

## Type check
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides". See https://pnpm.io/settings for the new home of each setting.

> lira-p2p-honduras@1.0.0 check /home/ubuntu/lira-p2p-honduras
> tsc --noEmit


## Unit tests
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides". See https://pnpm.io/settings for the new home of each setting.

> lira-p2p-honduras@1.0.0 test /home/ubuntu/lira-p2p-honduras
> vitest run


 RUN  v2.1.9 /home/ubuntu/lira-p2p-honduras

 ✓ server/financial/domain.test.ts (7 tests) 8ms
 ✓ server/financial/provider.test.ts (3 tests) 6ms
 ✓ server/security/domain.test.ts (3 tests) 164ms
 ✓ server/auth.logout.test.ts (1 test) 5ms

 Test Files  4 passed (4)
      Tests  14 passed (14)
   Start at  02:26:23
   Duration  829ms (transform 296ms, setup 0ms, collect 904ms, tests 183ms, environment 1ms, prepare 324ms)


## Production build
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides". See https://pnpm.io/settings for the new home of each setting.

> lira-p2p-honduras@1.0.0 build /home/ubuntu/lira-p2p-honduras
> vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

vite v7.1.9 building for production...
transforming...
✓ 1706 modules transformed.
rendering chunks...
computing gzip size...
../dist/public/index.html                 367.89 kB │ gzip: 105.63 kB
../dist/public/assets/index-BTiT7vvc.css  112.63 kB │ gzip:  20.81 kB
../dist/public/assets/index-DT4LuprU.js   471.27 kB │ gzip: 140.00 kB
✓ built in 3.63s

  dist/index.js  88.5kb

⚡ Done in 9ms

## Production dependency audit
{
  "info": 0,
  "low": 0,
  "moderate": 0,
  "high": 0,
  "critical": 0
}

## Database migration verification
Verified tables: otp_challenges, security_sessions, trusted_devices, user_security_profiles.
