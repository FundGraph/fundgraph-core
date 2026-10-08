export interface SimpleToml {
  sections: Record<string, Record<string, unknown>>;
  arrays: Record<string, Array<Record<string, unknown>>>;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && value[index - 1] !== '\\') quote = !quote;
    if (!quote && (character === '[' || character === '{')) depth += 1;
    if (!quote && (character === ']' || character === '}')) depth -= 1;
    if (!quote && depth === 0 && character === ',') {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function parseTomlValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  if (value.startsWith('[') && value.endsWith(']')) return splitTopLevel(value.slice(1, -1)).map(parseTomlValue);
  if (value.startsWith('{') && value.endsWith('}')) {
    const result: Record<string, unknown> = {};
    for (const pair of splitTopLevel(value.slice(1, -1))) {
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      result[pair.slice(0, separator).trim()] = parseTomlValue(pair.slice(separator + 1));
    }
    return result;
  }
  if (value === 'true' || value === 'false') return value === 'true';
  return value;
}

export function parseSimpleToml(source: string): SimpleToml {
  const sections: Record<string, Record<string, unknown>> = { '': {} };
  const arrays: Record<string, Array<Record<string, unknown>>> = {};
  let currentSection = '';
  let currentArray: Record<string, unknown> | undefined;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const arrayHeader = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayHeader) {
      currentSection = arrayHeader[1]!.trim();
      arrays[currentSection] ??= [];
      currentArray = {};
      arrays[currentSection]!.push(currentArray);
      continue;
    }
    const sectionHeader = line.match(/^\[([^\]]+)\]$/);
    if (sectionHeader) {
      currentSection = sectionHeader[1]!.trim();
      sections[currentSection] ??= {};
      currentArray = undefined;
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Malformed TOML line: ${rawLine}`);
    const key = line.slice(0, separator).trim();
    const value = parseTomlValue(line.slice(separator + 1));
    if (currentArray) currentArray[key] = value;
    else sections[currentSection]![key] = value;
  }
  return { sections, arrays };
}

