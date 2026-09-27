# LIRA — Roadmap hacia un piloto real (no solo hacia más código)

Este documento consolida qué falta para que LIRA deje de ser NOT_READY, en el orden real en
que hay que resolverlo. Se apoya directamente en `audit-report.md` (hallazgos BR-001…BR-008) —
no repite su detalle técnico, lo organiza en fases y prioridad.

## Estado a 2026-09-27

- **Cerrado hoy:** BR-005 (inmutabilidad del audit log a nivel de base de datos, con triggers
  verificados contra un Postgres real).
- **Avanzado hoy:** BR-004 (worker con reintento/backoff/dead-letter real; reconciliación con
  escalamiento por antigüedad; CI ahora corre ambas rutas contra un contenedor Postgres real —
  ver `evidence/verification-2026-09-27.md`).
- **Sigue igual (no tocado en esta sesión):** BR-001, BR-002, BR-003, BR-006, BR-007, BR-008.

## Las tres fases — y por qué no se pueden comprimir en una

### Fase 1 — Ingeniería (lo que sí se puede seguir acelerando aquí)

Todo lo que sigue es código, y por tanto lo único que un agente como yo puede realmente mover:

| Prioridad | Bloqueador | Qué falta en concreto |
|---|---|---|
| P1 | BR-001 — Proveedor real | Reemplazar `SandboxBankAdapter` por un adaptador de un proveedor de pagos real hondureño (o al menos su sandbox oficial). Sin esto, `dispatchPendingSandboxOutbox`/`reconcilePendingSandboxTransfers` siguen hablando con un simulador que nunca falla ni resuelve por sí solo. |
| P1 | BR-002 — Identidad de producción | Sustituir el adaptador OAuth heredado de la plataforma prototipo (`server/_core/sdk.ts`, `oauth.ts`) por un sistema de identidad propio de Lira. Añadir WebAuthn/passkeys, canal real de entrega de OTP (SMS/push verificado), y recuperación de cuenta. |
| P1 | BR-003 — Solicitudes de pago completas | Hoy se pueden crear y cancelar, pero no completarse ni ser rechazadas por la contraparte. Falta el flujo de fulfilment con pruebas de concurrencia. |
| P1 | BR-004 (resto) | Pruebas de concurrencia multi-nodo (varios workers reclamando el mismo evento a la vez) y un harness de fallos contra un proveedor real, no solo el adaptador simulado. |
| P2 | BR-006 — Observabilidad | Métricas estructuradas, alertas, trazas, dashboards operativos, evidencia de SLO. Hoy solo hay logs de consola y los endpoints `/health`. |
| P2 | BR-007 — Preparación operativa | Backup/restore probado, RPO/RTO definidos, runbook de incidentes, aislamiento real de entornos. |
| P3 | BR-008 — Analítica de producto | Las barras semanales en `Home.tsx` son solo presentación; no deben usarse como fuente de reporting financiero real. |

Adicional, fuera de la tabla de hallazgos pero real y visible en el propio repo:

- **Dos árboles de código en paralelo.** `apps/web` y el resto de `client/`/`server/`/`shared/`
  ya viven versionados en la raíz (MySQL, sin `apps/api`/`apps/worker`/`apps/reconciliation`
  propios), mientras que `lira-api`/`lira-worker`/`lira-reconciliation` en Railway siguen
  desplegando desde `lira-p2p-honduras-hardened-v2.zip` (Postgres, con `apps/api`, `apps/worker`,
  `apps/reconciliation` reales). Tarde o temprano hay que unificarlos en un solo árbol versionado
  — ahora mismo el ZIP es la fuente de verdad de lo que realmente corre en producción para
  api/worker/reconciliation, y el árbol raíz lo es solo para `lira-web`.
- **Backoff fijo, no exponencial.** El retry de outbox y el umbral de reconciliación usan
  ventanas fijas leídas de variables de entorno, no backoff exponencial por evento (eso
  requeriría una columna `nextAttemptAt` — aceptable para sandbox, revisar antes de un piloto
  real).

### Fase 2 — Cumplimiento (fuera del código, no lo resuelve ningún commit)

- Clasificación regulatoria de Lira en Honduras (¿qué tipo de entidad, bajo qué supervisión?).
- KYC/AML: proceso, evidencia, y probablemente un proveedor externo de verificación de identidad.
- Acuerdo formal con un proveedor de pagos/banco autorizado en Honduras — sin esto, BR-001 no
  tiene a qué conectarse en el mundo real, por bien construido que esté el adaptador.
- Protección al consumidor y gestión de reclamos según la normativa aplicable.

### Fase 3 — Validación independiente (nadie la hace desde dentro del proyecto)

- Pentest externo.
- Simulacro de recuperación ante desastres (DR) y de conciliación con datos reales.
- Pruebas de concurrencia contra la base de datos real bajo carga, no solo el script de
  verificación de hoy (que corre secuencial, no en paralelo).
- Re-auditoría de preparación bancaria (`audit-report.md`) contra un release congelado, en un
  entorno de staging aislado — no contra código en desarrollo activo.

## Orden recomendado de aquí en adelante

1. **Unificar los dos árboles de código** (raíz vs. ZIP) antes de seguir añadiendo lógica en
   paralelo a ambos — cada nueva feature construida solo en el ZIP profundiza la divergencia.
2. **BR-002 (identidad propia)** — es la dependencia más peligrosa hoy: todo lo demás asume que
   la autenticación es confiable, pero hoy delega en infraestructura de otra plataforma.
3. **BR-001 (proveedor real, aunque sea su sandbox oficial)** — sin esto, BR-004 nunca se puede
   probar contra fallos reales, solo contra el simulador.
4. **BR-003 (fulfilment de solicitudes de pago)**.
5. **BR-006/BR-007 (observabilidad y operación)** — se vuelven urgentes en cuanto haya usuarios
   reales, aunque sean de un piloto cerrado.
6. **Fases 2 y 3 en paralelo, no después** — la clasificación regulatoria y el acuerdo con
   proveedor toman tiempo de calendario independiente del código; arrancarlas ahora no compite
   con el trabajo de ingeniería.

## Lo que este roadmap NO promete

No hay fecha. No hay estimación de esfuerzo por punto — cada uno de BR-001/002/003 es, por sí
solo, un proyecto con su propia superficie de pruebas e integración externa. Este documento
ordena la secuencia y nombra las dependencias reales entre fases; no sustituye una planificación
de producto con fechas, que depende de decisiones (proveedor elegido, alcance regulatorio) que
todavía no se han tomado.
