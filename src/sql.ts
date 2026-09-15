/** Matches literals/comments before parameters, so their contents stay untouched. */
const tokens = /'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|:(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)/g;

export function bindParameters(sql: string, parameters: Record<string, unknown>): [string, unknown[]] {
  const values: unknown[] = [];
  const query = sql.replace(tokens, (token, spread: string | undefined, name: string | undefined) => {
    if (!name) return token;
    if (!Object.hasOwn(parameters, name)) throw new Error(`Missing SQL parameter: ${name}`);
    const value = parameters[name];
    const bind = (item: unknown) => {
      if (item === undefined) throw new Error(`Undefined SQL parameter: ${name}`);
      values.push(item);
      return `:p${values.length - 1}`;
    };
    if (!spread) return typeof value === 'function' ? value() : bind(value);
    if (!Array.isArray(value)) throw new Error(`Spread parameter ${name} must be an array`);
    if (!value.length) throw new Error(`Spread parameter ${name} cannot be empty`);
    return value.map(bind).join(', ');
  });
  return [query, values];
}

export function escapeIdentifier(name: string): string {
  if (!name || /[`\x00-\x1f\x7f]/.test(name)) throw new Error(`Invalid ArcadeDB identifier: ${JSON.stringify(name)}`);
  return '`' + name + '`';
}

/** Translate TypeORM's single-entity SQL; raw query() SQL is left untouched. */
export function translateOrmSql(sql: string): string {
  const parts = sql.match(/'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|\s+|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g) ?? [];
  const significant = parts.map((_, i) => i).filter(i => !/^\s+$|^--|^\/\*/.test(parts[i]));
  const aliases: string[] = [];
  for (let i = 0; i < significant.length; i++) {
    const index = significant[i];
    if (parts[index].toUpperCase() === 'CURRENT_TIMESTAMP') parts[index] = 'sysdate()';
    if (parts[index].toUpperCase() === 'JOIN') throw new Error('ArcadeDB ORM joins are not supported; use native graph SQL');
    if (parts[index].toUpperCase() !== 'FROM') continue;
    const aliasIndex = significant[i + 2];
    if (parts[significant[i + 1]]?.startsWith('`') && parts[aliasIndex]?.startsWith('`')) {
      aliases.push(parts[aliasIndex]);
      parts[aliasIndex] = '';
    }
  }
  if (aliases.length > 1) throw new Error('ArcadeDB ORM subquery aliases are not supported; use native SQL');
  if (aliases.length) {
    for (let i = 0; i < significant.length - 1; i++) {
      if (parts[significant[i]] === aliases[0] && parts[significant[i + 1]] === '.') {
        parts[significant[i]] = '';
        parts[significant[i + 1]] = '';
      }
    }
  }
  return parts.join('')
    .replace(/\bLIMIT (\d+) OFFSET (\d+)\s*$/i, 'SKIP $2 LIMIT $1')
    .replace(/\bOFFSET (\d+)\s*$/i, 'SKIP $1');
}
