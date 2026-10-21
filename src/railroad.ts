import type { Node } from './parse';

/** Hand-rolled railroad diagram renderer → SVG string. */

type Box = {
  width: number;
  height: number;
  /** y of the main rail relative to top of box */
  rail: number;
  draw: (x: number, y: number) => string;
};

const PAD = 10;
const TERM_H = 28;
const TERM_PAD_X = 10;
const GAP = 16;
const RAIL = '#3d4f5f';
const RAIL_W = 2;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function measure(text: string): number {
  // monospace estimate ~7.4px per char at 13px
  return Math.max(18, text.length * 7.8 + TERM_PAD_X * 2);
}

function rail(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${RAIL}" stroke-width="${RAIL_W}" stroke-linecap="round"/>`;
}

function terminal(text: string, kind: 'lit' | 'meta' | 'special'): Box {
  const w = measure(text);
  const h = TERM_H;
  const fill =
    kind === 'lit' ? '#1a2330'
    : kind === 'meta' ? '#132a2a'
    : '#2a1f14';
  const stroke =
    kind === 'lit' ? '#3d4f5f'
    : kind === 'meta' ? '#2dd4bf'
    : '#fbbf24';
  const fg =
    kind === 'lit' ? '#e2e8f0'
    : kind === 'meta' ? '#5eead4'
    : '#fcd34d';
  const rx = kind === 'lit' ? 6 : h / 2;
  return {
    width: w,
    height: h,
    rail: h / 2,
    draw: (x, y) => `
      <g class="rr-term rr-${kind}" data-label="${esc(text)}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${x + w / 2}" y="${y + h / 2 + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${fg}">${esc(text)}</text>
      </g>`,
  };
}

function sequence(items: Box[]): Box {
  if (items.length === 0) {
    return {
      width: 20,
      height: 10,
      rail: 5,
      draw: (x, y) => rail(x, y + 5, x + 20, y + 5),
    };
  }
  if (items.length === 1) return items[0];
  const width = items.reduce((a, b) => a + b.width, 0) + GAP * (items.length - 1);
  const railY = Math.max(...items.map((b) => b.rail));
  const height = Math.max(...items.map((b) => b.height - b.rail + railY));
  return {
    width,
    height,
    rail: railY,
    draw: (x, y) => {
      let parts = '';
      let cx = x;
      items.forEach((box, idx) => {
        const by = y + railY - box.rail;
        parts += box.draw(cx, by);
        if (idx < items.length - 1) {
          const from = cx + box.width;
          const to = from + GAP;
          parts += rail(from, y + railY, to, y + railY);
          cx = to;
        } else {
          cx += box.width;
        }
      });
      return parts;
    },
  };
}

function choice(options: Box[]): Box {
  if (options.length === 1) return options[0];
  const innerW = Math.max(...options.map((o) => o.width));
  const vGap = 12;
  const heights = options.map((o) => o.height);
  const totalH = heights.reduce((a, b) => a + b, 0) + vGap * (options.length - 1);
  // pick middle-ish option as through-rail
  const mid = Math.floor((options.length - 1) / 2);
  let railOffset = 0;
  for (let i = 0; i < mid; i++) railOffset += heights[i] + vGap;
  railOffset += options[mid].rail;

  const wing = 18;
  const width = innerW + wing * 2 + 8;
  return {
    width,
    height: totalH,
    rail: railOffset,
    draw: (x, y) => {
      let parts = '';
      const leftX = x;
      const rightX = x + width;
      const railY = y + railOffset;
      // entry / exit stubs
      parts += rail(leftX, railY, leftX + 6, railY);
      parts += rail(rightX - 6, railY, rightX, railY);

      let cy = y;
      options.forEach((box, idx) => {
        const by = cy;
        const boxRail = by + box.rail;
        const bx = x + wing + 4 + (innerW - box.width) / 2;
        // curves from left hub to option and option to right hub
        const lx = leftX + 6;
        const rx = rightX - 6;
        const c1x = lx + wing * 0.7;
        const c2x = rx - wing * 0.7;
        parts += `<path d="M${lx} ${railY} C${c1x} ${railY}, ${c1x} ${boxRail}, ${bx} ${boxRail}" fill="none" stroke="${RAIL}" stroke-width="${RAIL_W}"/>`;
        parts += `<path d="M${bx + box.width} ${boxRail} C${c2x} ${boxRail}, ${c2x} ${railY}, ${rx} ${railY}" fill="none" stroke="${RAIL}" stroke-width="${RAIL_W}"/>`;
        parts += box.draw(bx, by);
        cy += box.height + (idx < options.length - 1 ? vGap : 0);
      });
      return parts;
    },
  };
}

function wrapRepeat(body: Box, label: string): Box {
  const padX = 22;
  const padTop = 18;
  const padBot = 10;
  const width = body.width + padX * 2;
  const height = body.height + padTop + padBot;
  const railY = padTop + body.rail;
  return {
    width,
    height,
    rail: railY,
    draw: (x, y) => {
      const bx = x + padX;
      const by = y + padTop;
      const ry = y + railY;
      let parts = '';
      parts += rail(x, ry, bx, ry);
      parts += rail(bx + body.width, ry, x + width, ry);
      parts += body.draw(bx, by);
      // loop below
      const loopY = y + height - 4;
      parts += `<path d="M${bx} ${ry} Q${bx - 12} ${ry}, ${bx - 12} ${ry + 10} L${bx - 12} ${loopY - 10} Q${bx - 12} ${loopY}, ${bx} ${loopY} L${bx + body.width} ${loopY} Q${bx + body.width + 12} ${loopY}, ${bx + body.width + 12} ${loopY - 10} L${bx + body.width + 12} ${ry + 10} Q${bx + body.width + 12} ${ry}, ${bx + body.width} ${ry}" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.85"/>`;
      // arrow on loop
      parts += `<polygon points="${bx + body.width / 2 - 4},${loopY} ${bx + body.width / 2 + 4},${loopY} ${bx + body.width / 2},${loopY + 5}" fill="#fbbf24"/>`;
      parts += `<text x="${bx + body.width / 2}" y="${y + 12}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#fbbf24">${esc(label)}</text>`;
      return parts;
    },
  };
}

function wrapGroup(body: Box, label: string, color: string): Box {
  const padX = 14;
  const padY = 16;
  const width = body.width + padX * 2;
  const height = body.height + padY * 2;
  const railY = padY + body.rail;
  return {
    width,
    height,
    rail: railY,
    draw: (x, y) => {
      let parts = '';
      parts += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="rgba(56,189,248,0.04)" stroke="${color}" stroke-width="1.25" stroke-dasharray="5 3"/>`;
      parts += `<text x="${x + 10}" y="${y + 12}" font-family="${FONT}" font-size="10" fill="${color}">${esc(label)}</text>`;
      parts += rail(x, y + railY, x + padX, y + railY);
      parts += rail(x + padX + body.width, y + railY, x + width, y + railY);
      parts += body.draw(x + padX, y + padY);
      return parts;
    },
  };
}

function compile(node: Node): Box {
  switch (node.type) {
    case 'empty':
      return {
        width: 16,
        height: 10,
        rail: 5,
        draw: (x, y) => rail(x, y + 5, x + 16, y + 5),
      };
    case 'literal':
      return terminal(node.text, 'lit');
    case 'dot':
      return terminal('any', 'meta');
    case 'anchor':
      return terminal(node.text, 'special');
    case 'escape':
      return terminal(node.label, 'meta');
    case 'backref':
      return terminal(node.text, 'special');
    case 'charset': {
      const label = (node.negated ? '[^' : '[') + (node.parts.length > 14 ? node.parts.slice(0, 12) + '…' : node.parts) + ']';
      return terminal(label, 'meta');
    }
    case 'seq':
      return sequence(node.items.map(compile));
    case 'alt':
      return choice(node.options.map(compile));
    case 'repeat': {
      const body = compile(node.body);
      let label = '';
      if (node.min === 0 && node.max === null) label = '0+';
      else if (node.min === 1 && node.max === null) label = '1+';
      else if (node.min === 0 && node.max === 1) label = 'optional';
      else if (node.max === null) label = `${node.min}+`;
      else if (node.min === node.max) label = `×${node.min}`;
      else label = `${node.min}…${node.max}`;
      if (node.lazy) label += ' lazy';
      // optional as a choice with skip
      if (node.min === 0 && node.max === 1) {
        const skip: Box = {
          width: 40,
          height: 16,
          rail: 8,
          draw: (x, y) => {
            const ry = y + 8;
            return (
              rail(x, ry, x + 40, ry) +
              `<text x="${x + 20}" y="${y + 4}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#94a3b8">skip</text>`
            );
          },
        };
        return choice([skip, body]);
      }
      if (node.min === 0 && node.max === null) {
        // optional loop = skip OR body with loop
        const looped = wrapRepeat(body, '0+');
        const skip: Box = {
          width: 40,
          height: 16,
          rail: 8,
          draw: (x, y) => rail(x, y + 8, x + 40, y + 8),
        };
        return choice([skip, looped]);
      }
      return wrapRepeat(body, label);
    }
    case 'group': {
      const body = compile(node.body);
      const colors: Record<string, string> = {
        capture: '#38bdf8',
        named: '#38bdf8',
        noncapture: '#64748b',
        lookahead: '#fbbf24',
        negLookahead: '#fb7185',
        lookbehind: '#fbbf24',
        negLookbehind: '#fb7185',
      };
      const labels: Record<string, string> = {
        capture: 'group',
        named: `〈${node.name}〉`,
        noncapture: 'non-capture',
        lookahead: 'lookahead',
        negLookahead: 'not followed by',
        lookbehind: 'lookbehind',
        negLookbehind: 'not preceded by',
      };
      return wrapGroup(body, labels[node.kind], colors[node.kind]);
    }
  }
}

export type RailroadSvg = {
  svg: string;
  width: number;
  height: number;
};

export function renderRailroad(ast: Node): RailroadSvg {
  const box = compile(ast);
  const width = box.width + PAD * 2 + 24;
  const height = box.height + PAD * 2;
  const startX = PAD;
  const railY = PAD + box.rail;

  // start / end capsules
  const caps = `
    <circle cx="${startX}" cy="${railY}" r="5" fill="#5eead4"/>
    <circle cx="${startX}" cy="${railY}" r="9" fill="none" stroke="#5eead4" stroke-width="1.5" opacity="0.5"/>
    <circle cx="${width - PAD}" cy="${railY}" r="5" fill="#5eead4"/>
    <circle cx="${width - PAD}" cy="${railY}" r="9" fill="none" stroke="#5eead4" stroke-width="1.5" opacity="0.5"/>
  `;

  const content =
    rail(startX + 9, railY, startX + 12, railY) +
    box.draw(startX + 12, PAD) +
    rail(startX + 12 + box.width, railY, width - PAD - 9, railY) +
    caps;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Railroad diagram">
  <rect width="100%" height="100%" fill="#0b0f14"/>
  <g class="rr-root">${content}</g>
  <style>
    .rr-term text { font-variant-ligatures: none; }
    .rr-root { animation: rr-fade 0.45s ease both; }
    @keyframes rr-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  </style>
</svg>`;

  return { svg, width, height };
}
