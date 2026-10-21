# RegexRay

**See your regex.** Live railroad diagram + match highlighting + plain-English explanations — 100% in your browser.

No account. No tracking. No server. Works offline after the first load.

## Features (v0.1)

- Paste a JS regex + flags → animated railroad / syntax diagram
- Live test-string matching with group highlighting (runs in a Web Worker; times out runaway backtracking)
- Plain-English explanation of every token
- Example gallery (email, URL, ISO date, hex color, IPv4, slug, password, CSV)
- URL-hash permalinks (share a pattern with no backend)
- Export diagram as PNG, or copy as Markdown
- Dark, screenshot-ready UI

## Develop

```bash
npm install
npm run dev
```

## Build (GitHub Pages)

```bash
npm run build
# dist/ is static — deploy as-is (base: ./)
```

## QA

```bash
npm run build && npm run preview &
npm run qa
```

## License

MIT © barood-labs

A free no-tricks tool by [barood-labs](https://github.com/barood-labs). Also try [No-Tricks Tools](https://barood-labs.github.io/notricks-tools/) and [Mossloop](https://barood-labs.github.io/mossloop/).
