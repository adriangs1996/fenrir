export function toOriginUrl(origin: string): string {
  return origin.endsWith("/") ? origin : `${origin}/`;
}

export function scriptLiteral<T>(value: T): string {
  return JSON.stringify(value);
}
