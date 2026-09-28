type OperationalValue = string | number | boolean | null | undefined;

function normalizeFields(fields: Record<string, OperationalValue>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

export function operationalLog(
  service: "lira-api" | "lira-worker" | "lira-reconciliation",
  event: string,
  fields: Record<string, OperationalValue> = {},
  level: "info" | "warn" | "error" = "info",
) {
  const payload = {
    timestamp: new Date().toISOString(),
    service,
    event,
    ...normalizeFields(fields),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorClass(error: unknown) {
  if (error instanceof Error && error.name) return error.name;
  return "UnknownError";
}
