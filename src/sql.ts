/** Matches literals/comments before parameters, so their contents stay untouched. */
const tokens =
  /'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|:(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)/g;

export function bindParameters(
  sql: string,
  parameters: Record<string, unknown>,
): [string, unknown[]] {
  const values: unknown[] = [];
  const query = sql.replace(
    tokens,
    (token, spread: string | undefined, name: string | undefined) => {
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
    },
  );
  return [query, values];
}

export function escapeIdentifier(name: string): string {
  if (!name || /[`\p{Cc}]/u.test(name))
    throw new Error(`Invalid ArcadeDB identifier: ${JSON.stringify(name)}`);
  return '`' + name + '`';
}

/** Translate TypeORM's single-entity SQL; raw query() SQL is left untouched. */
export function translateOrmSql(sql: string): string {
  // TypeORM's exists()/getExists() wrapper uses SQL EXISTS, absent in ArcadeDB SQL.
  // Its only observable result is whether the inner query produces at least one row.
  const exists = sql.match(
    /^SELECT 1 AS `row_exists` FROM \(SELECT 1 AS dummy_column\) `dummy_table` WHERE EXISTS \(([\s\S]+)\) LIMIT 1$/,
  );
  if (exists) return translateOrmSql(`${exists[1]} LIMIT 1`);
  const parts =
    sql.match(
      /'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|\s+|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g,
    ) ?? [];
  const significant = parts.map((_, i) => i).filter((i) => !/^\s+$|^--|^\/\*/.test(parts[i]));
  const aliases: string[] = [];
  for (let i = 0; i < significant.length; i++) {
    const index = significant[i];
    if (parts[index].toUpperCase() === 'CURRENT_TIMESTAMP') parts[index] = 'sysdate()';
    if (parts[index].toUpperCase() === 'JOIN')
      throw new Error('ArcadeDB ORM joins are not supported; use native graph SQL');
    const next = parts[significant[i + 1]];
    if (
      ['@>', '<@', '&&'].includes(parts[index] + next) ||
      (parts[index].toUpperCase() === 'ANY' && next === '(')
    )
      throw new Error(
        'PostgreSQL array/JSON operators and ANY are not supported; use native ArcadeDB predicates',
      );
    if (parts[index].toUpperCase() !== 'FROM') continue;
    const aliasIndex = significant[i + 2];
    if (parts[significant[i + 1]]?.startsWith('`') && parts[aliasIndex]?.startsWith('`')) {
      aliases.push(parts[aliasIndex]);
      parts[aliasIndex] = '';
    }
  }
  if (aliases.length > 1)
    throw new Error('ArcadeDB ORM subquery aliases are not supported; use native SQL');
  if (aliases.length) {
    for (let i = 0; i < significant.length - 1; i++) {
      if (parts[significant[i]] === aliases[0] && parts[significant[i + 1]] === '.') {
        parts[significant[i]] = '';
        parts[significant[i + 1]] = '';
      }
    }
  }
  return rewriteFunctionsAndHaving(
    parts
      .join('')
      .replace(/\bLIMIT (\d+) OFFSET (\d+)\s*$/i, 'SKIP $2 LIMIT $1')
      .replace(/\bOFFSET (\d+)\s*$/i, 'SKIP $1'),
  );
}

function rewriteFunctionsAndHaving(sql: string): string {
  // Quoted literals/identifiers and parameters remain atomic during dialect rewrites.
  const words: string[] =
    sql.match(
      /'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|:[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|>=|<=|<>|!=|\|\||[^\s]/g,
    ) ?? [];
  const render = (tokens: string[]) =>
    tokens
      .filter(Boolean)
      .map((word) => (word.startsWith('--') ? word + '\n' : word))
      .join(' ');
  const stack: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '(') stack.push(i);
    if (words[i] !== ')') continue;
    const open = stack.pop();
    if (open !== undefined && /^(UPPER|LOWER)$/i.test(words[open - 1] ?? '')) {
      const method = words[open - 1].toUpperCase() === 'UPPER' ? 'toUpperCase' : 'toLowerCase';
      words[open - 1] = '';
      words[i] += `.${method}()`;
    }
  }
  // Preserve existing whitespace except when a rewrite is needed.
  const changedFunctions = words.includes('');
  const positions: number[] = [];
  let depth = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '(') depth++;
    if (words[i].startsWith(')')) depth--;
    if (!depth) positions.push(i);
  }
  const having = positions.find((i) => words[i].toUpperCase() === 'HAVING');
  if (having === undefined) return changedFunctions ? render(words) : sql;
  const from = positions.find((i) => words[i].toUpperCase() === 'FROM');
  if (from === undefined) throw new Error('HAVING requires a SELECT query');
  const tail =
    positions.find(
      (i) => i > having && ['ORDER', 'SKIP', 'LIMIT'].includes(words[i].toUpperCase()),
    ) ?? words.length;
  const selections: { expression: string[]; alias: string }[] = [];
  let start = 1;
  for (const end of [...positions.filter((i) => i < from && words[i] === ','), from]) {
    const projection = words.slice(start, end);
    const as = projection.map((word) => word.toUpperCase()).lastIndexOf('AS');
    if (as > 0 && projection[as + 1])
      selections.push({ expression: projection.slice(0, as), alias: projection[as + 1] });
    start = end + 1;
  }
  const predicate = words.slice(having + 1, tail);
  for (const { expression, alias } of selections.sort(
    (a, b) => b.expression.length - a.expression.length,
  )) {
    for (let i = 0; i <= predicate.length - expression.length; i++) {
      if (
        expression.every((word, j) =>
          /^[A-Za-z_]/.test(word)
            ? word.toUpperCase() === predicate[i + j]?.toUpperCase()
            : word === predicate[i + j],
        )
      )
        predicate.splice(i, expression.length, alias);
    }
  }
  if (
    predicate.some((word, i) => /^(sum|count|avg|min|max)$/i.test(word) && predicate[i + 1] === '(')
  )
    throw new Error('HAVING aggregates must also be selected with an alias');
  return `SELECT FROM (${render(words.slice(0, having))}) WHERE ${render(predicate)} ${render(words.slice(tail))}`.trim();
}
