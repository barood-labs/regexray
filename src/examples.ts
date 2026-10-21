export type Example = {
  id: string;
  label: string;
  pattern: string;
  flags: string;
  test: string;
  blurb: string;
};

export const EXAMPLES: Example[] = [
  {
    id: 'email',
    label: 'Email',
    pattern: '^[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}$',
    flags: 'm',
    test: 'hello@barood.labs\nbad@@mail\nme@x.io',
    blurb: 'A practical (not RFC-perfect) email address.',
  },
  {
    id: 'url',
    label: 'URL',
    pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*',
    flags: 'g',
    test: 'Visit https://barood-labs.github.io/regexray and http://example.com/a?b=1',
    blurb: 'HTTP(S) URLs in free text.',
  },
  {
    id: 'date',
    label: 'ISO date',
    pattern: '\\b(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])\\b',
    flags: 'g',
    test: 'Shipped 2026-10-21, not 2026-13-40 or 26-10-21.',
    blurb: 'YYYY-MM-DD with basic month/day checks.',
  },
  {
    id: 'hex',
    label: 'Hex color',
    pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b',
    flags: 'g',
    test: 'palette: #0b0f14 #5eead4 #fb4 #notahex',
    blurb: '3- or 6-digit CSS hex colors.',
  },
  {
    id: 'ipv4',
    label: 'IPv4',
    pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b',
    flags: 'g',
    test: 'dns 8.8.8.8 · gateway 192.168.1.1 · bad 999.1.1.1',
    blurb: 'Dotted IPv4, 0–255 per octet.',
  },
  {
    id: 'slug',
    label: 'Slug',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    flags: 'm',
    test: 'regex-ray\nRegexRay\n--bad--\nmossloop',
    blurb: 'URL-safe lowercase slugs.',
  },
  {
    id: 'password',
    label: 'Password',
    pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{8,}$',
    flags: 'm',
    test: 'weak\nBetter1!\nNoSpecial1\nGood#Pass9',
    blurb: '8+ chars with lower, upper, digit, symbol (lookaheads).',
  },
  {
    id: 'csv',
    label: 'CSV field',
    pattern: '(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))',
    flags: 'g',
    test: 'a,"b,c","say ""hi""",d',
    blurb: 'Quoted/unquoted CSV fields.',
  },
];
