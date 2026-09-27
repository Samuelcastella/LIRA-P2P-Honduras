# LIRA — Pagos P2P en Honduras

> **Sandbox financiero con datos simulados. No procesa dinero real, no conecta con bancos y no debe emplearse para decisiones financieras ni producción.**

LIRA es un prototipo web autenticado para explorar pagos P2P en Honduras con HNL. Esta versión incorpora un ledger de doble entrada, estados explícitos de transferencia, controles de riesgo simulados, verificación PIN + OTP para envíos, gestión de dispositivos y sesiones de seguridad, límites preventivos y documentación de preparación bancaria.

## Contenido del repositorio

```text
client/                       Interfaz React + Tailwind
server/                       API Express + tRPC y dominio financiero
drizzle/                      Esquema MySQL y migraciones
server/financial/             Ledger, riesgo y adaptador de proveedor sandbox
server/security/              PIN, OTP, dispositivos y sesiones sandbox
docs/bank-readiness/          Auditoría, controles, runbooks y evidencia
skills/                       Skills reutilizables creadas para este proyecto
Dockerfile.* y archivos ZIP     Artefactos heredados de despliegue, preservados en la raíz
```

## Controles implementados en el sandbox

- **Ledger de doble entrada:** los saldos se derivan de asientos contables; no existe edición directa de saldo.
- **Idempotencia y estados:** una clave se limita al usuario, se rechaza un payload distinto con la misma clave y las transiciones de estado se validan en servidor.
- **Riesgo y operación:** reglas de riesgo simuladas, interruptor administrativo para nuevos envíos y cola transaccional de salida.
- **Proveedor simulado:** `SandboxBankAdapter` usa eventos firmados, timestamp, deduplicación y conciliación simulada.
- **PIN y OTP:** secretos con hash scrypt, límites de intentos, caducidad, vínculo de desafío con usuario/sesión y consumo condicional de un solo uso.
- **Sesiones y dispositivos:** registros por usuario, revocación de dispositivo/sesión y cierre de las demás sesiones al rotar el PIN.
- **Límites preventivos:** máximo de **L 1,000.00** por envío y reserva diaria UTC de **L 2,000.00**, evaluados en el servidor.
- **Interfaz explícita:** estados pendiente, rechazado, expirado, fallido, completado y cancelado, junto con alertas y bitácora segura.

## Inicio local

### Requisitos

- Node.js 22
- pnpm 10
- Una base MySQL/TiDB para los flujos persistidos
- Variables de entorno de Manus/WebDev para el inicio de sesión del entorno

```bash
pnpm install --frozen-lockfile
pnpm drizzle-kit migrate
pnpm dev
```

Para validar la aplicación:

```bash
pnpm check
pnpm test
pnpm build
pnpm audit --prod
```

## Migraciones

Las migraciones se generan desde `drizzle/schema.ts`:

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Revise siempre el SQL generado antes de aplicarlo. La migración más reciente, `0005_nifty_komodo.sql`, añade `daily_transfer_controls` para la reserva atómica de límites diarios del sandbox.

## Documentación y skills

- [Auditoría de preparación bancaria](docs/bank-readiness/audit-report.md)
- [Roadmap hacia un piloto real](docs/bank-readiness/roadmap.md)
- [Controles de identidad del sandbox](docs/bank-readiness/security/sandbox-identity-controls.md)
- [Evidencia de verificación más reciente](docs/bank-readiness/evidence/verification-2026-09-27.md)
- [Skill de auditoría bancaria](skills/bank-readiness-audit/SKILL.md)
- [Skill de mejora de seguridad financiera](skills/financial-sandbox-security-upgrade/SKILL.md)

## Límites deliberados

LIRA sigue clasificado como **NOT_READY** para cualquier piloto con dinero real, integración bancaria o lanzamiento productivo. Entre las brechas deliberadamente abiertas están:

1. OTP solo demostrativo: no hay SMS, correo ni push con entrega verificada.
2. Identificadores de dispositivos creados en cliente: no hay passkeys/WebAuthn ni atestación independiente.
3. La revocación se limita al registro de sesión del sandbox; no reemplaza una arquitectura de sesión productiva.
4. No existe proveedor financiero real, KYC/AML, conciliación contra extractos, observabilidad productiva, recuperación de cuentas ni pruebas de concurrencia contra una base de datos remota.

Consulta la auditoría y los runbooks antes de reutilizar el código fuera de un entorno de demostración.

## Automatización y artefactos heredados

Los Dockerfiles y archivos ZIP históricos se conservan en la raíz por trazabilidad. **No son el código fuente vigente ni deben desplegarse como esta versión de LIRA.**

La automatización heredada de GitHub Actions continúa validando el archivo ZIP histórico. La fuente actual fue validada localmente con instalación reproducible, type check, 16 pruebas, build y auditoría de dependencias. El workflow debe actualizarse para validar la fuente de la raíz cuando la integración de GitHub disponga de permiso `workflows`.
