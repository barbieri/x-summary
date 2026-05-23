/** Pretty-print JSON for human review of machine-readable artifacts. */
export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
