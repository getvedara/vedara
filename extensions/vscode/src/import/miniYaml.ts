/**
 * Dependency-free parser for the YAML subset used by Continue's config.yaml: block mappings,
 * block sequences (including `- key: value` items), flow sequences/maps of scalars, quoted and
 * plain scalars, comments, and block scalars (`|` / `>`). Anchors, aliases, tags and multi-document
 * streams are not supported; the extension is packaged without runtime dependencies.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  /** Original line number, for error messages. */
  no: number;
}

export class YamlParseError extends Error {
  constructor(message: string, line: number) {
    super(`YAML line ${line}: ${message}`);
    this.name = 'YamlParseError';
  }
}

function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote && raw[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Index of the `:` separating a mapping key from its value, or -1. */
function keySeparator(text: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if ((ch === '"' || ch === "'") && i === 0) {
      quote = ch;
    } else if (ch === ':' && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\t')) {
      return i;
    } else if (ch === '[' || ch === '{') {
      if (i === 0) return -1;
    }
  }
  return -1;
}

export function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    return splitFlow(s.slice(1, -1)).map(parseScalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj: { [key: string]: YamlValue } = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const idx = keySeparator(part);
      if (idx > 0) obj[String(parseScalar(part.slice(0, idx)))] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseYaml(source: string): YamlValue {
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  const lines: Line[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.includes('\t') && /^\t/.test(raw)) throw new YamlParseError('tabs are not allowed for indentation', i + 1);
    const text = stripComment(raw).replace(/\s+$/, '');
    if (text.trim() === '' || text.trim() === '---' || text.trim() === '...') {
      // Keep blank lines inside block scalars by recording them with sentinel indent.
      lines.push({ indent: -1, text: '', no: i + 1 });
      continue;
    }
    const indent = text.length - text.trimStart().length;
    lines.push({ indent, text: text.trimStart(), no: i + 1 });
  }

  let pos = 0;
  const skipBlank = () => {
    while (pos < lines.length && lines[pos].indent === -1) pos++;
  };

  function parseBlockScalar(style: string, parentIndent: number): string {
    const collected: string[] = [];
    let blockIndent = -1;
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent === -1) {
        collected.push('');
        pos++;
        continue;
      }
      if (line.indent <= parentIndent) break;
      if (blockIndent === -1) blockIndent = line.indent;
      collected.push(' '.repeat(line.indent - blockIndent) + line.text);
      pos++;
    }
    while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
    const keep = style.includes('-') ? '' : '\n';
    return (style.startsWith('>') ? collected.join(' ') : collected.join('\n')) + (collected.length ? keep : '');
  }

  function parseValueAfterKey(rest: string, indent: number): YamlValue {
    const trimmed = rest.trim();
    if (/^[|>][-+]?$/.test(trimmed)) {
      pos++;
      return parseBlockScalar(trimmed, indent);
    }
    if (trimmed !== '') {
      pos++;
      return parseScalar(trimmed);
    }
    pos++;
    skipBlank();
    if (pos >= lines.length) return null;
    const next = lines[pos];
    if (next.indent > indent) return parseNode(next.indent);
    // `key:` followed by a sequence at the same indent is valid YAML.
    if (next.indent === indent && next.text.startsWith('- ')) return parseSequence(indent);
    return null;
  }

  function parseMapping(indent: number, first?: { key: string; rest: string }): { [key: string]: YamlValue } {
    const obj: { [key: string]: YamlValue } = {};
    if (first) {
      obj[first.key] = parseValueAfterKey(first.rest, indent);
    }
    while (true) {
      skipBlank();
      if (pos >= lines.length) break;
      const line = lines[pos];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new YamlParseError('unexpected indentation', line.no);
      if (line.text.startsWith('- ')) break;
      const idx = keySeparator(line.text);
      if (idx <= 0) throw new YamlParseError(`expected "key: value", got "${line.text}"`, line.no);
      const key = String(parseScalar(line.text.slice(0, idx)));
      obj[key] = parseValueAfterKey(line.text.slice(idx + 1), indent);
    }
    return obj;
  }

  function parseSequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    while (true) {
      skipBlank();
      if (pos >= lines.length) break;
      const line = lines[pos];
      if (line.indent !== indent || !(line.text === '-' || line.text.startsWith('- '))) break;

      const content = line.text === '-' ? '' : line.text.slice(2);
      const contentIndent = indent + 2 + (content.length - content.trimStart().length);
      const body = content.trim();

      if (body === '') {
        pos++;
        skipBlank();
        items.push(pos < lines.length && lines[pos].indent > indent ? parseNode(lines[pos].indent) : null);
        continue;
      }

      const idx = keySeparator(body);
      if (body.startsWith('- ')) {
        // Nested sequence on the same line: "- - a"
        lines[pos] = { indent: contentIndent, text: body, no: line.no };
        items.push(parseSequence(contentIndent));
      } else if (idx > 0) {
        const key = String(parseScalar(body.slice(0, idx)));
        items.push(parseMapping(contentIndent, { key, rest: body.slice(idx + 1) }));
      } else if (/^[|>][-+]?$/.test(body)) {
        pos++;
        items.push(parseBlockScalar(body, indent));
      } else {
        pos++;
        items.push(parseScalar(body));
      }
    }
    return items;
  }

  function parseNode(indent: number): YamlValue {
    skipBlank();
    const line = lines[pos];
    if (line.text === '-' || line.text.startsWith('- ')) return parseSequence(indent);
    if (keySeparator(line.text) > 0) return parseMapping(indent);
    pos++;
    return parseScalar(line.text);
  }

  skipBlank();
  if (pos >= lines.length) return null;
  const root = parseNode(lines[pos].indent);
  skipBlank();
  if (pos < lines.length) {
    throw new YamlParseError('unexpected content after document', lines[pos].no);
  }
  return root;
}
