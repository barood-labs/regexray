/** Tokenize a JS regex pattern into explained pieces (no execution). */

export type TokenKind =
  | 'literal'
  | 'escape'
  | 'dot'
  | 'anchor'
  | 'quantifier'
  | 'classOpen'
  | 'classClose'
  | 'classRange'
  | 'classNegate'
  | 'classEscape'
  | 'classLiteral'
  | 'groupOpen'
  | 'groupClose'
  | 'alternation'
  | 'assertion'
  | 'backref'
  | 'flagHint'
  | 'unknown';

export type Token = {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  explain: string;
  /** Optional color token class for the UI. */
  tone?: 'teal' | 'gold' | 'violet' | 'rose' | 'sky' | 'muted';
};

const ESCAPE_MEANING: Record<string, string> = {
  d: 'Any digit (0–9)',
  D: 'Any non-digit',
  w: 'Word character: letter, digit, or underscore',
  W: 'Non-word character',
  s: 'Whitespace (space, tab, newline, …)',
  S: 'Non-whitespace',
  b: 'Word boundary',
  B: 'Not a word boundary',
  n: 'Newline',
  r: 'Carriage return',
  t: 'Tab',
  f: 'Form feed',
  v: 'Vertical tab',
  '0': 'NUL character',
};

function escExplain(ch: string): string {
  if (ESCAPE_MEANING[ch]) return ESCAPE_MEANING[ch];
  if (ch === '\\') return 'A literal backslash';
  if (/[.*+?^${}()|[\]\\]/.test(ch)) return `A literal ${ch}`;
  return `Escaped character "${ch}"`;
}

function readUnicodeProp(src: string, i: number): { text: string; end: number; explain: string } | null {
  // \p{…} or \P{…}
  if (src[i] !== 'p' && src[i] !== 'P') return null;
  const neg = src[i] === 'P';
  if (src[i + 1] !== '{') return null;
  let j = i + 2;
  while (j < src.length && src[j] !== '}') j++;
  if (j >= src.length) return null;
  const name = src.slice(i + 2, j);
  return {
    text: `\\${src[i]}{${name}}`,
    end: j + 1,
    explain: neg
      ? `Unicode property — not in "${name}"`
      : `Unicode property — in "${name}"`,
  };
}

function readHex(src: string, i: number, n: number): { text: string; end: number; explain: string } | null {
  const hex = src.slice(i, i + n);
  if (hex.length < n || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const code = parseInt(hex, 16);
  return {
    text: hex,
    end: i + n,
    explain: `Character U+${hex.toUpperCase().padStart(4, '0')} (${code < 32 ? 'control' : String.fromCodePoint(code)})`,
  };
}

/** Tokenize a pattern string. Does not validate that the regex compiles. */
export function tokenize(pattern: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let inClass = false;
  let groupDepth = 0;

  const push = (kind: TokenKind, text: string, start: number, end: number, explain: string, tone?: Token['tone']) => {
    out.push({ kind, text, start, end, explain, tone });
  };

  while (i < pattern.length) {
    const start = i;
    const ch = pattern[i];

    if (inClass) {
      if (ch === ']' && !(out.length && out[out.length - 1].kind === 'classOpen')) {
        push('classClose', ']', i, i + 1, 'End of character class', 'violet');
        inClass = false;
        i++;
        continue;
      }
      if (ch === '^' && out.length && out[out.length - 1].kind === 'classOpen') {
        push('classNegate', '^', i, i + 1, 'Negate the class — match anything NOT listed', 'rose');
        i++;
        continue;
      }
      if (ch === '\\') {
        const next = pattern[i + 1];
        if (next === undefined) {
          push('unknown', '\\', i, i + 1, 'Dangling backslash inside character class', 'rose');
          i++;
          continue;
        }
        const up = readUnicodeProp(pattern, i + 1);
        if (up) {
          push('classEscape', '\\' + up.text.slice(1), start, up.end, up.explain, 'teal');
          i = up.end;
          continue;
        }
        if (next === 'x') {
          const hx = readHex(pattern, i + 2, 2);
          if (hx) {
            push('classEscape', `\\x${hx.text}`, start, hx.end, hx.explain, 'teal');
            i = hx.end;
            continue;
          }
        }
        if (next === 'u') {
          if (pattern[i + 2] === '{') {
            let j = i + 3;
            while (j < pattern.length && pattern[j] !== '}') j++;
            if (j < pattern.length) {
              const hex = pattern.slice(i + 3, j);
              push('classEscape', `\\u{${hex}}`, start, j + 1, `Unicode code point U+${hex.toUpperCase()}`, 'teal');
              i = j + 1;
              continue;
            }
          } else {
            const hx = readHex(pattern, i + 2, 4);
            if (hx) {
              push('classEscape', `\\u${hx.text}`, start, hx.end, hx.explain, 'teal');
              i = hx.end;
              continue;
            }
          }
        }
        push('classEscape', `\\${next}`, start, i + 2, escExplain(next), 'teal');
        i += 2;
        continue;
      }
      if (ch === '-' && out.length && out[out.length - 1].kind !== 'classOpen' && pattern[i + 1] && pattern[i + 1] !== ']') {
        push('classRange', '-', i, i + 1, 'Range — from previous character through next', 'gold');
        i++;
        continue;
      }
      push('classLiteral', ch, i, i + 1, `Character "${ch}"`, 'violet');
      i++;
      continue;
    }

    // Outside character class
    if (ch === '[') {
      push('classOpen', '[', i, i + 1, 'Start of character class — match one of the following', 'violet');
      inClass = true;
      i++;
      continue;
    }

    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) {
        push('unknown', '\\', i, i + 1, 'Dangling backslash', 'rose');
        i++;
        continue;
      }
      const up = readUnicodeProp(pattern, i + 1);
      if (up) {
        push('escape', '\\' + up.text.slice(1), start, up.end, up.explain, 'teal');
        i = up.end;
        continue;
      }
      if (next === 'x') {
        const hx = readHex(pattern, i + 2, 2);
        if (hx) {
          push('escape', `\\x${hx.text}`, start, hx.end, hx.explain, 'teal');
          i = hx.end;
          continue;
        }
      }
      if (next === 'u') {
        if (pattern[i + 2] === '{') {
          let j = i + 3;
          while (j < pattern.length && pattern[j] !== '}') j++;
          if (j < pattern.length) {
            const hex = pattern.slice(i + 3, j);
            push('escape', `\\u{${hex}}`, start, j + 1, `Unicode code point U+${hex.toUpperCase()}`, 'teal');
            i = j + 1;
            continue;
          }
        } else {
          const hx = readHex(pattern, i + 2, 4);
          if (hx) {
            push('escape', `\\u${hx.text}`, start, hx.end, hx.explain, 'teal');
            i = hx.end;
            continue;
          }
        }
      }
      if (next === 'k' && pattern[i + 2] === '<') {
        let j = i + 3;
        while (j < pattern.length && pattern[j] !== '>') j++;
        if (j < pattern.length) {
          const name = pattern.slice(i + 3, j);
          push('backref', `\\k<${name}>`, start, j + 1, `Backreference to named group "${name}"`, 'sky');
          i = j + 1;
          continue;
        }
      }
      if (/[1-9]/.test(next)) {
        let j = i + 1;
        while (j < pattern.length && /\d/.test(pattern[j])) j++;
        const num = pattern.slice(i + 1, j);
        push('backref', `\\${num}`, start, j, `Backreference to capture group ${num}`, 'sky');
        i = j;
        continue;
      }
      if (next === 'b' || next === 'B') {
        push('anchor', `\\${next}`, start, i + 2, escExplain(next), 'gold');
        i += 2;
        continue;
      }
      push('escape', `\\${next}`, start, i + 2, escExplain(next), 'teal');
      i += 2;
      continue;
    }

    if (ch === '.') {
      push('dot', '.', i, i + 1, 'Any character (except newline, unless flag s)', 'teal');
      i++;
      continue;
    }

    if (ch === '^') {
      push('anchor', '^', i, i + 1, 'Start of string (or line, with flag m)', 'gold');
      i++;
      continue;
    }
    if (ch === '$') {
      push('anchor', '$', i, i + 1, 'End of string (or line, with flag m)', 'gold');
      i++;
      continue;
    }

    if (ch === '|') {
      push('alternation', '|', i, i + 1, 'Alternation — match either the left or the right side', 'rose');
      i++;
      continue;
    }

    if (ch === '(') {
      // Look ahead for group modifiers
      if (pattern.startsWith('?:', i + 1)) {
        push('groupOpen', '(?:', i, i + 3, 'Non-capturing group', 'sky');
        groupDepth++;
        i += 3;
        continue;
      }
      if (pattern.startsWith('?=', i + 1)) {
        push('assertion', '(?=', i, i + 3, 'Positive lookahead — must be followed by…', 'gold');
        groupDepth++;
        i += 3;
        continue;
      }
      if (pattern.startsWith('?!', i + 1)) {
        push('assertion', '(?!', i, i + 3, 'Negative lookahead — must NOT be followed by…', 'gold');
        groupDepth++;
        i += 3;
        continue;
      }
      if (pattern.startsWith('?<=', i + 1)) {
        push('assertion', '(?<=', i, i + 4, 'Positive lookbehind — must be preceded by…', 'gold');
        groupDepth++;
        i += 4;
        continue;
      }
      if (pattern.startsWith('?<!', i + 1)) {
        push('assertion', '(?<!', i, i + 4, 'Negative lookbehind — must NOT be preceded by…', 'gold');
        groupDepth++;
        i += 4;
        continue;
      }
      if (pattern.startsWith('?<', i + 1)) {
        let j = i + 3;
        while (j < pattern.length && pattern[j] !== '>') j++;
        if (j < pattern.length) {
          const name = pattern.slice(i + 3, j);
          push('groupOpen', `(?<${name}>`, i, j + 1, `Named capturing group "${name}"`, 'sky');
          groupDepth++;
          i = j + 1;
          continue;
        }
      }
      push('groupOpen', '(', i, i + 1, 'Capturing group', 'sky');
      groupDepth++;
      i++;
      continue;
    }

    if (ch === ')') {
      push('groupClose', ')', i, i + 1, groupDepth > 0 ? 'End of group' : 'Unmatched closing parenthesis', 'sky');
      if (groupDepth > 0) groupDepth--;
      i++;
      continue;
    }

    if (ch === '*' || ch === '+' || ch === '?') {
      let text = ch;
      let end = i + 1;
      let explain =
        ch === '*' ? 'Repeat previous 0 or more times'
        : ch === '+' ? 'Repeat previous 1 or more times'
        : 'Previous is optional (0 or 1 time)';
      if (pattern[end] === '?') {
        text += '?';
        end++;
        explain += ' (lazy — shortest match first)';
      }
      push('quantifier', text, start, end, explain, 'gold');
      i = end;
      continue;
    }

    if (ch === '{') {
      let j = i + 1;
      while (j < pattern.length && /[\d,]/.test(pattern[j])) j++;
      if (pattern[j] === '}') {
        let text = pattern.slice(i, j + 1);
        let end = j + 1;
        const body = pattern.slice(i + 1, j);
        let explain = 'Custom quantifier';
        if (/^\d+$/.test(body)) explain = `Repeat previous exactly ${body} time${body === '1' ? '' : 's'}`;
        else if (/^\d+,$/.test(body)) explain = `Repeat previous at least ${body.slice(0, -1)} times`;
        else if (/^\d+,\d+$/.test(body)) {
          const [a, b] = body.split(',');
          explain = `Repeat previous between ${a} and ${b} times`;
        } else if (/^,\d+$/.test(body)) explain = `Repeat previous at most ${body.slice(1)} times`;
        if (pattern[end] === '?') {
          text += '?';
          end++;
          explain += ' (lazy)';
        }
        push('quantifier', text, start, end, explain, 'gold');
        i = end;
        continue;
      }
    }

    // literal run
    let j = i + 1;
    while (
      j < pattern.length &&
      !/[\\.^$|()*+?{}[\]]/.test(pattern[j])
    ) j++;
    const lit = pattern.slice(i, j);
    push(
      'literal',
      lit,
      i,
      j,
      lit.length === 1 ? `Literal character "${lit}"` : `Literal text "${lit}"`,
      'muted',
    );
    i = j;
  }

  return out;
}
