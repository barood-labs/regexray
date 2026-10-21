/** Parse a regex pattern into a railroad-friendly AST. */

export type Node =
  | { type: 'literal'; text: string; start: number; end: number }
  | { type: 'dot'; start: number; end: number }
  | { type: 'anchor'; text: string; start: number; end: number }
  | { type: 'escape'; text: string; label: string; start: number; end: number }
  | { type: 'charset'; negated: boolean; parts: string; start: number; end: number }
  | { type: 'backref'; text: string; start: number; end: number }
  | { type: 'seq'; items: Node[] }
  | { type: 'alt'; options: Node[] }
  | { type: 'group'; kind: 'capture' | 'noncapture' | 'lookahead' | 'negLookahead' | 'lookbehind' | 'negLookbehind' | 'named'; name?: string; body: Node; start: number; end: number }
  | { type: 'repeat'; min: number; max: number | null; lazy: boolean; body: Node; start: number; end: number }
  | { type: 'empty' };

export type ParseResult =
  | { ok: true; ast: Node }
  | { ok: false; error: string; index: number };

class Parser {
  src: string;
  i = 0;
  constructor(src: string) {
    this.src = src;
  }

  peek(n = 0) {
    return this.src[this.i + n];
  }
  eat(ch?: string) {
    if (ch !== undefined && this.peek() !== ch) return false;
    this.i++;
    return true;
  }
  eof() {
    return this.i >= this.src.length;
  }

  parse(): ParseResult {
    try {
      const ast = this.parseAlt();
      if (!this.eof()) {
        return { ok: false, error: `Unexpected "${this.peek()}"`, index: this.i };
      }
      return { ok: true, ast };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = /^@(\d+):(.*)$/.exec(msg);
      if (m) return { ok: false, error: m[2].trim(), index: Number(m[1]) };
      return { ok: false, error: msg, index: this.i };
    }
  }

  fail(msg: string): never {
    throw new Error(`@${this.i}:${msg}`);
  }

  parseAlt(): Node {
    const options: Node[] = [this.parseSeq()];
    while (this.peek() === '|') {
      this.eat('|');
      options.push(this.parseSeq());
    }
    if (options.length === 1) return options[0];
    return { type: 'alt', options };
  }

  parseSeq(): Node {
    const items: Node[] = [];
    while (!this.eof() && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseAtomQuant());
    }
    if (items.length === 0) return { type: 'empty' };
    if (items.length === 1) return items[0];
    return { type: 'seq', items };
  }

  parseAtomQuant(): Node {
    const start = this.i;
    let body = this.parseAtom();
    // quantifiers
    while (!this.eof()) {
      const q = this.peek();
      if (q === '*' || q === '+' || q === '?' || q === '{') {
        const qStart = this.i;
        let min = 0;
        let max: number | null = null;
        if (q === '*') {
          this.eat();
          min = 0;
          max = null;
        } else if (q === '+') {
          this.eat();
          min = 1;
          max = null;
        } else if (q === '?') {
          this.eat();
          min = 0;
          max = 1;
        } else if (q === '{') {
          this.eat('{');
          const numStart = this.i;
          while (/\d/.test(this.peek() ?? '')) this.i++;
          if (this.i === numStart && this.peek() !== ',') this.fail('Expected number in quantifier');
          const first = this.i > numStart ? Number(this.src.slice(numStart, this.i)) : 0;
          if (this.peek() === ',') {
            this.eat(',');
            const n2s = this.i;
            while (/\d/.test(this.peek() ?? '')) this.i++;
            if (this.i > n2s) {
              min = first;
              max = Number(this.src.slice(n2s, this.i));
            } else {
              min = first;
              max = null;
            }
          } else {
            min = first;
            max = first;
          }
          if (!this.eat('}')) this.fail('Expected } to close quantifier');
        }
        let lazy = false;
        if (this.peek() === '?') {
          this.eat('?');
          lazy = true;
        }
        body = {
          type: 'repeat',
          min,
          max,
          lazy,
          body,
          start: qStart,
          end: this.i,
        };
        // only one quantifier stack per atom in practice — but `a+?` handled; don't allow `a++`
        break;
      } else break;
    }
    void start;
    return body;
  }

  parseAtom(): Node {
    const ch = this.peek();
    if (ch === undefined) this.fail('Unexpected end of pattern');

    if (ch === '(') return this.parseGroup();
    if (ch === '[') return this.parseClass();
    if (ch === '.') {
      const start = this.i;
      this.eat();
      return { type: 'dot', start, end: this.i };
    }
    if (ch === '^' || ch === '$') {
      const start = this.i;
      this.eat();
      return { type: 'anchor', text: ch, start, end: this.i };
    }
    if (ch === '\\') return this.parseEscape();
    if (ch === ')' || ch === '|' || ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      this.fail(`Unexpected "${ch}"`);
    }
    // literal run (single char — keep atoms fine-grained for diagram)
    const start = this.i;
    this.eat();
    return { type: 'literal', text: ch, start, end: this.i };
  }

  parseGroup(): Node {
    const start = this.i;
    this.eat('(');
    let kind: Extract<Node, { type: 'group' }>['kind'] = 'capture';
    let name: string | undefined;
    if (this.peek() === '?') {
      this.eat('?');
      if (this.peek() === ':') {
        this.eat(':');
        kind = 'noncapture';
      } else if (this.peek() === '=') {
        this.eat('=');
        kind = 'lookahead';
      } else if (this.peek() === '!') {
        this.eat('!');
        kind = 'negLookahead';
      } else if (this.src.startsWith('<=', this.i)) {
        this.i += 2;
        kind = 'lookbehind';
      } else if (this.src.startsWith('<!', this.i)) {
        this.i += 2;
        kind = 'negLookbehind';
      } else if (this.peek() === '<') {
        this.eat('<');
        const ns = this.i;
        while (!this.eof() && this.peek() !== '>') this.i++;
        if (!this.eat('>')) this.fail('Unclosed named group');
        name = this.src.slice(ns, this.i - 1);
        kind = 'named';
      } else {
        this.fail('Unsupported group modifier');
      }
    }
    const body = this.parseAlt();
    if (!this.eat(')')) this.fail('Unclosed group');
    return { type: 'group', kind, name, body, start, end: this.i };
  }

  parseClass(): Node {
    const start = this.i;
    this.eat('[');
    let negated = false;
    if (this.peek() === '^') {
      this.eat('^');
      negated = true;
    }
    let parts = '';
    while (!this.eof() && this.peek() !== ']') {
      if (this.peek() === '\\') {
        parts += this.src[this.i] + (this.src[this.i + 1] ?? '');
        this.i += 2;
        continue;
      }
      parts += this.peek();
      this.i++;
    }
    if (!this.eat(']')) this.fail('Unclosed character class');
    return { type: 'charset', negated, parts, start, end: this.i };
  }

  parseEscape(): Node {
    const start = this.i;
    this.eat('\\');
    const next = this.peek();
    if (next === undefined) this.fail('Dangling backslash');

    // unicode property
    if ((next === 'p' || next === 'P') && this.src[this.i + 1] === '{') {
      this.i++;
      this.eat('{');
      const ns = this.i;
      while (!this.eof() && this.peek() !== '}') this.i++;
      if (!this.eat('}')) this.fail('Unclosed unicode property');
      const name = this.src.slice(ns, this.i - 1);
      const text = this.src.slice(start, this.i);
      return {
        type: 'escape',
        text,
        label: next === 'P' ? `¬\\p{${name}}` : `\\p{${name}}`,
        start,
        end: this.i,
      };
    }
    if (next === 'x') {
      this.i++;
      const hex = this.src.slice(this.i, this.i + 2);
      this.i += 2;
      return { type: 'escape', text: this.src.slice(start, this.i), label: `\\x${hex}`, start, end: this.i };
    }
    if (next === 'u') {
      this.i++;
      if (this.peek() === '{') {
        this.eat('{');
        const ns = this.i;
        while (!this.eof() && this.peek() !== '}') this.i++;
        if (!this.eat('}')) this.fail('Unclosed \\u{…}');
        const hex = this.src.slice(ns, this.i - 1);
        return { type: 'escape', text: this.src.slice(start, this.i), label: `\\u{${hex}}`, start, end: this.i };
      }
      const hex = this.src.slice(this.i, this.i + 4);
      this.i += 4;
      return { type: 'escape', text: this.src.slice(start, this.i), label: `\\u${hex}`, start, end: this.i };
    }
    if (next === 'k' && this.src[this.i + 1] === '<') {
      this.i++;
      this.eat('<');
      const ns = this.i;
      while (!this.eof() && this.peek() !== '>') this.i++;
      if (!this.eat('>')) this.fail('Unclosed named backref');
      const text = this.src.slice(start, this.i);
      return { type: 'backref', text, start, end: this.i };
    }
    if (/[1-9]/.test(next)) {
      this.i++;
      while (/\d/.test(this.peek() ?? '')) this.i++;
      const text = this.src.slice(start, this.i);
      return { type: 'backref', text, start, end: this.i };
    }
    if (next === 'b' || next === 'B') {
      this.i++;
      return { type: 'anchor', text: `\\${next}`, start, end: this.i };
    }
    this.i++;
    const text = this.src.slice(start, this.i);
    const labels: Record<string, string> = {
      d: '\\d', D: '\\D', w: '\\w', W: '\\W', s: '\\s', S: '\\S',
      n: '\\n', r: '\\r', t: '\\t',
    };
    return { type: 'escape', text, label: labels[next] ?? text, start, end: this.i };
  }
}

export function parsePattern(pattern: string): ParseResult {
  if (pattern === '') return { ok: true, ast: { type: 'empty' } };
  return new Parser(pattern).parse();
}

/** Collapse adjacent literals in a seq for prettier diagrams. */
export function coalesceLiterals(node: Node): Node {
  switch (node.type) {
    case 'seq': {
      const items: Node[] = [];
      for (const it of node.items.map(coalesceLiterals)) {
        const prev = items[items.length - 1];
        if (it.type === 'literal' && prev?.type === 'literal') {
          items[items.length - 1] = {
            type: 'literal',
            text: prev.text + it.text,
            start: prev.start,
            end: it.end,
          };
        } else items.push(it);
      }
      if (items.length === 1) return items[0];
      return { type: 'seq', items };
    }
    case 'alt':
      return { type: 'alt', options: node.options.map(coalesceLiterals) };
    case 'group':
      return { ...node, body: coalesceLiterals(node.body) };
    case 'repeat':
      return { ...node, body: coalesceLiterals(node.body) };
    default:
      return node;
  }
}
