
export function getPath(obj: unknown, dotPath: string): unknown {
  return dotPath
    .split(".")
    .reduce<unknown>((acc, key) => (acc != null && typeof acc === "object" ? (acc as any)[key] : undefined), obj);
}

const WHOLE_TOKEN = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const INLINE_TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function renderTemplate(template: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof template === "string") {
    const wholeMatch = template.match(WHOLE_TOKEN);
    if (wholeMatch) return getPath(ctx, wholeMatch[1]);
    return template.replace(INLINE_TOKEN, (_, path) => {
      const value = getPath(ctx, path);
      return value == null ? "" : String(value);
    });
  }
  if (Array.isArray(template)) return template.map((item) => renderTemplate(item, ctx));
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) out[key] = renderTemplate(value, ctx);
    return out;
  }
  return template;
}
