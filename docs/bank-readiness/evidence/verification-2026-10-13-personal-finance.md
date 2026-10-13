# Evidencia de verificación — productos personales sandbox — 2026-10-13

## Alcance revisado

- `drizzle/schema.ts`
- `db/migrations/004_personal_finance_sandbox.sql`
- `server/db.ts`
- `server/routers.ts`
- `server/financial/domain.ts`
- `server/financial/domain.test.ts`
- `client/src/pages/Home.tsx`
- `client/src/index.css`

## Controles implementados

| Área | Evidencia de código |
| --- | --- |
| Saldo de ahorro derivado | `savings_goals.reserveAccountId` apunta a `financial_accounts`; el saldo se consulta desde `ledger_entries`. |
| Integridad | `createInternalBalancedJournal` genera un débito/crédito sin inventar una transferencia. |
| Idempotencia | Contribuciones, retiros y depósitos de nómina guardan una llave y huella de solicitud. |
| Autorización | Mutaciones del usuario son `protectedProcedure`; nómina demo es `adminProcedure`. |
| Verificación | Contribuciones y retiros consumen OTP de propósito `savings_contribution` tras PIN+OTP y sesión/dispositivo confiable. |
| Tarjeta | Solo guarda etiqueta, últimos cuatro y estado. No se modela PAN ni integración de pagos. |
| Límites | El modelo y la interfaz describen explícitamente un sandbox sin dinero real. |

## Validaciones ejecutadas

Ejecutadas en `/home/ubuntu/lira-github-publish`:

```text
pnpm check  → PASS
pnpm test   → PASS (4 archivos, 21 pruebas)
pnpm build  → PASS
pnpm audit --prod --audit-level=high → PASS (sin vulnerabilidades conocidas)
```

Las pruebas de dominio incluyen journals internos balanceados, ausencia de `transferId` para movimientos internos y rechazo de movimientos hacia la misma cuenta.

## Revisión de migración

`004_personal_finance_sandbox.sql` es una migración **PostgreSQL canónica**. Crea los tipos y tablas de metas, contribuciones, retiros, tarjeta sandbox y nómina de demostración; no modifica balances directamente.

La variable `DATABASE_URL` disponible en este entorno de edición apunta a la base MySQL/TiDB de WebDev, no a la instancia PostgreSQL canónica. Por ese motivo, `pnpm migrate` no se ejecutó contra esta URL: usarla habría intentado una conexión `pg` a un endpoint MySQL y falló antes de aplicar cambios. La aplicación debe ocurrir mediante el pipeline/despliegue PostgreSQL canónico, donde `scripts/migrate.mjs` registra el checksum en `lira_schema_migrations`.

Una revisión estática adicional confirmó que la migración define los seis productos requeridos y los checks de importe positivo. La CI canónica ahora exige cuatro migraciones, la presencia del propósito OTP de ahorro y las seis tablas antes de validar invariantes del ledger.

## Resultado

La implementación y sus pruebas unitarias pasan. La aplicación y smoke-test de la migración PostgreSQL quedan como condición previa al despliegue de esta funcionalidad; no se declara una validación de base de datos remota que no se realizó.
