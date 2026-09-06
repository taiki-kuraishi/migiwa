// One JSON line per event for Workers Logs (spec §9). Never pass a payload in.
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

// Shared by every catch block that only has an `unknown` error to describe.
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
