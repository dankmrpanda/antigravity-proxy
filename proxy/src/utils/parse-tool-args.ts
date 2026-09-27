export function parseToolArgs(raw: string | object | null | undefined, strict = false): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = raw === null || raw === undefined || raw === ''
      ? {} : typeof raw === 'object' ? raw : JSON.parse(raw);
  } catch {
    if (strict) throw new Error('Invalid tool arguments: incomplete or malformed JSON');
    return {};
  }
  if (strict && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('Invalid tool arguments: expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}
