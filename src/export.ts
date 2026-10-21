/** Export helpers — PNG via canvas, Markdown as fenced block. */

export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const w = Number(root.getAttribute('width') || 800);
  const h = Number(root.getAttribute('height') || 200);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
    );
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG image load failed'));
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toMarkdown(pattern: string, flags: string, test: string): string {
  const flagPart = flags ? flags : '';
  return [
    `## RegexRay`,
    '',
    '```',
    `/${pattern}/${flagPart}`,
    '```',
    '',
    test
      ? ['**Test string**', '', '```', test, '```', ''].join('\n')
      : '',
    `_Diagram shared from [RegexRay](${typeof location !== 'undefined' ? location.origin + location.pathname : 'https://barood-labs.github.io/regexray/'}) — a free no-tricks tool by [barood-labs](https://github.com/barood-labs)._`,
    '',
  ].join('\n');
}
