export interface EnvEntry { key: string; value: string; before: string; assignment: string; inline: string }
export interface EnvDocument { entries: EnvEntry[]; tail: string }

/** Native dotenv assignments with comments retained for composition. */
export function envDocument(text: string): EnvDocument {
  const lines = text.split(/(?<=\n)/);
  const entries: EnvEntry[] = [];
  const keys = new Set<string>();
  let before = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) { before += line; continue; }
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(line);
    if (!match) throw new Error('Invalid native env assignment');
    const key = match[1];
    if (keys.has(key)) throw new Error(`Duplicate native env setting: ${key}`);
    keys.add(key);
    let assignment = line;
    let raw = match[2].replace(/\r?\n$/, '');
    let value: string;
    let inline = '';
    if (['"', "'", '`'].includes(raw[0])) {
      const quote = raw[0];
      const quoted = new RegExp(`^${quote}((?:\\\\${quote}|[^${quote}])*)${quote}(\\s*(?:#.*)?)$`);
      while (!quoted.test(raw) && i + 1 < lines.length) {
        assignment += lines[++i];
        raw += '\n' + lines[i].replace(/\r?\n$/, '');
      }
      const match = quoted.exec(raw);
      if (!match) throw new Error(`Invalid quoting in native env setting: ${key}`);
      value = match[1].replace(/\r\n?/g, '\n');
      if (quote === '"') value = value.replaceAll('\\n', '\n').replaceAll('\\r', '\r');
      inline = match[2];
    } else {
      const comment = raw.indexOf('#');
      value = (comment < 0 ? raw : raw.slice(0, comment)).trim();
      inline = comment < 0 ? '' : ' ' + raw.slice(comment);
    }
    entries.push({ key, value, before, assignment, inline });
    before = '';
  }
  return { entries, tail: before };
}

export function envLiteral(value: string): string {
  if (!value.includes("'") && !value.includes('\r')) return `'${value}'`;
  if (!value.includes('`') && !value.includes('\r')) return '`' + value + '`';
  if (!/[#\r\n]/.test(value) && value.trim() === value && !['"', "'", '`'].includes(value[0])) return value;
  // Dotenv interprets these escapes itself. Its native quoting semantics, including
  // retained backslashes before quotes, are not replaced by an AMS codec.
  return '"' + value.replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n') + '"';
}

export function parseNativeEnv(text: string): Record<string, string> {
  return Object.fromEntries(envDocument(text).entries.map(entry => [entry.key, entry.value]));
}
