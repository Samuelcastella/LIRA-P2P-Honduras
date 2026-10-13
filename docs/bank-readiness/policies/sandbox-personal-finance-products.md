# Productos personales simulados — LIRA Sandbox

## Alcance

Esta política cubre tres utilidades inspiradas en experiencias de billeteras personales, implementadas **exclusivamente dentro del sandbox LIRA**:

1. Metas de ahorro con cuenta de reserva contable.
2. Tarjeta sandbox con congelación o reactivación de estado.
3. Perfil y abono de nómina de demostración.

No habilitan transferencias bancarias, depósito directo real, emisión de tarjeta, cargo a tarjeta, ACH, PAN, número de cuenta, token de procesador ni dinero real.

## Metas de ahorro

- Cada meta tiene una cuenta `reserve` distinta en `financial_accounts`; el saldo se deriva de `ledger_entries` y no existe una columna de saldo editable.
- Aportar y retirar fondos crea un `journal_transaction` inmutable con un débito y un crédito en HNL.
- Cada movimiento usa una llave de idempotencia por usuario y guarda el hash de la solicitud. Reusar la misma llave con otro importe o meta se rechaza.
- El movimiento requiere una verificación de propósito `savings_contribution`: PIN y OTP de seis dígitos, con hash, expiración, límite de intentos, vínculo con sesión, dispositivo confiable y consumo atómico.
- Crear una meta no mueve fondos, pero exige un contexto de dispositivo confiable.

## Tarjeta sandbox

- Solo se conserva un identificador visual de cuatro dígitos, una etiqueta y estado `active`, `frozen` o `closed`.
- No se persiste PAN, CVV, token de red, token de emisor, fecha de expiración ni datos de una tarjeta real.
- Un usuario solo puede congelar o reactivar su propia tarjeta; el cambio requiere dispositivo confiable y se audita.
- La interfaz debe llamarla siempre **tarjeta sandbox** y no debe presentarla como medio de pago funcional.

## Nómina de demostración

- El perfil tiene un identificador de demostración y no contiene ruta bancaria, cuenta de nómina ni instrucciones de depósito.
- Solo un procedimiento `adminProcedure` puede simular un abono. El procedimiento publica un journal balanceado desde la cuenta de compensación sandbox hacia la wallet del usuario.
- Los abonos son idempotentes y contienen el administrador creador, referencia de journal y auditoría.
- La función no contacta bancos, empleadores ni proveedores externos.

## Límites y decisiones de lanzamiento

Estos controles son adecuados solo para una demostración autenticada. Permanecen fuera de alcance: onboarding/KYC, entrega de OTP fuera de banda, WebAuthn, tokenización/PCI, procesador de tarjetas, contrato de empleador, cuentas de depósito, conciliación bancaria externa, disputas, fraude de nómina y controles regulatorios.

> **Decisión:** estos productos no cambian la decisión del banco: LIRA sigue **NOT_READY** para dinero real, integración con bancos o emisión/procesamiento de tarjetas.
