// WaterlooWorks stores postings with HTML codes like &#8226; for a bullet.
// Numeric codes all decode; these are the named ones postings actually use.
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  bull: '•', middot: '·', hellip: '...', ndash: '-', mdash: '-', minus: '-',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷',
  eacute: 'é', Eacute: 'É', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç',
  ocirc: 'ô', ouml: 'ö', uuml: 'ü', auml: 'ä', iuml: 'ï', euro: '€', pound: '£', cent: '¢',
  rarr: '→', larr: '←', check: '✓', ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '', zwnj: '', shy: '',
};

function codePointText(n, fallback) {
  if (!Number.isFinite(n) || n < 1 || n > 0x10ffff) return fallback;
  if (n === 160) return ' ';
  return String.fromCodePoint(n);
}

/** Pure: turns every HTML code in posting text (&#8226;, &bull;, &#x2022;, &amp;) into the character it stands for. */
export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => codePointText(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec) => codePointText(parseInt(dec, 10), m))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m);
}
