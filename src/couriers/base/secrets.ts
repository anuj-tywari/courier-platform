
const SECRET_MASK = "••••••••";

function getPath(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPath(obj: any, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  if (target && typeof target === "object") target[last] = value;
}
export function maskSecrets<T>(config: T, secretPaths: string[]): T {
  const masked = JSON.parse(JSON.stringify(config));
  for (const path of secretPaths) {
    if (getPath(masked, path)) setPath(masked, path, SECRET_MASK);
  }
  return masked;
}
export function preserveSecrets<T>(incoming: T, existing: T | null | undefined, secretPaths: string[]): T {
  if (!existing) return incoming;
  const merged = JSON.parse(JSON.stringify(incoming));
  for (const path of secretPaths) {
    if (getPath(merged, path) === SECRET_MASK) setPath(merged, path, getPath(existing, path));
  }
  return merged;
}
