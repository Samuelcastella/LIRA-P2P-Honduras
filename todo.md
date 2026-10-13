# LIRA — Seguimiento de productos personales

| Estado | Entrega |
| --- | --- |
| En progreso | Metas de ahorro con reserva contable, idempotencia, PIN+OTP y journals internos balanceados. |
| En progreso | Tarjeta sandbox sin PAN ni integración de pagos, con congelación auditada. |
| En progreso | Perfil y abono de nómina estrictamente de demostración, limitado al rol administrador. |
| En progreso | Migración canónica PostgreSQL `004_personal_finance_sandbox.sql`; debe aplicarse en el entorno PostgreSQL canónico, no en la base MySQL/TiDB de WebDev. |
| Pendiente | Pruebas de integración PostgreSQL para concurrencia, idempotencia y políticas RLS/roles. |
| Pendiente | Proveedor de dinero real, tarjeta real, ACH/depósito bancario, KYC, entrega OTP externa, WebAuthn y autorizaciones de producción. |
