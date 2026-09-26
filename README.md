# Lira P2P Honduras

Private deployment repository for the Lira Honduras financial sandbox.

## Current gate
- Sandbox only.
- Real-money execution must remain disabled.
- PostgreSQL and Redis are isolated in Railway.
- The original application ZIP is retained here as the product baseline.
- Hardened migration work is being reconciled against that baseline before any real-money pilot.

## Important
This commit preserves the exact Drive ZIP as a traceable baseline. It is not a declaration that the original ZIP is production-ready.
The hardened v2 source adds holds, UNKNOWN/reconciliation, compensating reversals, PostgreSQL migration, device-trust hardening, rate limiting and service separation before deployment.
