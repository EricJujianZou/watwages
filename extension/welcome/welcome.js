// The button leaves a note before going to the Full Cycle board. A student
// who is logged out signs in and lands on the dashboard, and the content
// script reads the note there and sends them on to Full Cycle.
const cta = document.querySelector(".cta");
cta.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.storage.local.set({ wmjTourPending: Date.now() }).finally(() => { location.href = cta.href; });
});

// The goose from watwages.ugmi.ca. It talks and flaps while the money falls,
// and again whenever it is clicked.
const gooseBtn = document.querySelector(".goose-btn");
gooseBtn.innerHTML = '<svg class="goose" viewBox="0 0 230 250" aria-hidden="true">' +
  '<defs><filter id="wob" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter></defs>' +
  '<g filter="url(#wob)" stroke="var(--goose-line)" stroke-linecap="round" stroke-linejoin="round">' +
    '<g fill="none" stroke-width="5"><path d="M122 206 L118 236 M108 238 L130 238"/><path d="M150 204 L154 234 M144 237 L166 236"/></g>' +
    '<g class="gbody">' +
      '<path d="M202 150 L226 138 L216 168 Z" fill="var(--goose-black)" stroke-width="4"/>' +
      '<path d="M72 170 C 70 136 118 122 162 132 C 198 140 216 162 208 188 C 200 214 150 222 112 215 C 86 209 74 194 72 170 Z" fill="var(--goose-body)" stroke-width="4.5"/>' +
      '<path d="M168 200 C 184 200 200 194 208 186 C 206 204 190 212 170 209 Z" fill="var(--goose-white)" stroke-width="3"/>' +
      '<path d="M84 186 C 92 204 110 212 126 212" fill="none" stroke="var(--goose-white)" stroke-width="5" opacity=".7"/>' +
      '<g class="wing"><path d="M112 160 C 132 140 172 142 194 162 C 180 186 140 192 116 180 Z" fill="var(--goose-wing)" stroke-width="3.5"/>' +
      '<path d="M140 168 C 152 174 166 174 178 168 M132 176 C 146 182 160 182 170 178" fill="none" stroke-width="2.5"/></g>' +
      '<g class="gneck">' +
        '<path d="M74 172 C 66 142 58 112 60 80 L 86 78 C 86 108 94 140 106 162 Z" fill="var(--goose-black)" stroke-width="4"/>' +
        '<ellipse cx="68" cy="62" rx="27" ry="20" fill="var(--goose-black)" stroke-width="4"/>' +
        '<path d="M70 60 C 82 56 94 66 90 80 C 80 82 70 74 70 60 Z" fill="var(--goose-white)" stroke-width="2.5"/>' +
        '<g class="upper"><path d="M46 58 C 36 55 24 57 14 63 C 26 65 38 65 46 64 Z" fill="#3a3350" stroke-width="3"/></g>' +
        '<g class="jaw"><path d="M46 65 C 38 66 26 66 16 65 C 26 71 38 73 47 70 Z" fill="#3a3350" stroke-width="3"/></g>' +
        '<g class="eye"><circle cx="55" cy="55" r="6" fill="#fff" stroke="none"/><circle cx="54" cy="55" r="3" fill="var(--goose-line)" stroke="none"/></g>' +
      '</g>' +
    '</g>' +
  '</g></svg>';
const goose = gooseBtn.querySelector(".goose");
let quiet;
const talk = (ms) => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  goose.classList.add("talk");
  clearTimeout(quiet);
  quiet = setTimeout(() => goose.classList.remove("talk"), ms);
};
talk(3600);
gooseBtn.addEventListener("click", () => talk(1800));

// Dollar bills fall from above the page and flutter down, then the canvas is removed.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.querySelector(".money"), x = c.getContext("2d");
  const dpr = devicePixelRatio || 1;
  const size = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); addEventListener("resize", size);

  // Each bill is drawn once to its own canvas and then stamped every frame.
  const BW = 120, BH = 54;
  const bill = document.createElement("canvas");
  bill.width = BW * dpr; bill.height = BH * dpr;
  const b = bill.getContext("2d");
  b.scale(dpr, dpr);
  b.fillStyle = "#8fbf73"; b.fillRect(0, 0, BW, BH);
  b.strokeStyle = "#3f6b2e"; b.lineWidth = 2; b.strokeRect(1, 1, BW - 2, BH - 2);
  b.lineWidth = 1; b.strokeRect(6, 6, BW - 12, BH - 12);
  b.fillStyle = "#b5d79e";
  b.beginPath(); b.ellipse(BW / 2, BH / 2, 17, 19, 0, 0, Math.PI * 2); b.fill(); b.stroke();
  b.fillStyle = "#2f5422";
  b.font = "700 24px Figtree, system-ui, sans-serif";
  b.textAlign = "center"; b.textBaseline = "middle";
  b.fillText("$", BW / 2, BH / 2 + 1);
  b.font = "700 11px Figtree, system-ui, sans-serif";
  for (const [cx, cy] of [[16, 15], [BW - 16, 15], [16, BH - 14], [BW - 16, BH - 14]]) b.fillText("1", cx, cy);

  const bills = Array.from({ length: 110 }, () => {
    const s = 0.45 + Math.random() * 0.35;
    return { x: Math.random() * innerWidth, y: -BH - Math.random() * innerHeight * 2.2,
      vy: 6 + Math.random() * 4, s, phase: Math.random() * 6.3,
      sway: 0.6 + Math.random() * 1.2, spin: 1.5 + Math.random() * 2.5,
      tilt: (Math.random() - 0.5) * 0.8 };
  });
  const t0 = performance.now();
  const tick = (t) => {
    const age = t - t0, sec = age / 1000;
    x.clearRect(0, 0, innerWidth, innerHeight);
    x.globalAlpha = Math.max(0, 1 - Math.max(0, age - 3800) / 900);
    for (const m of bills) {
      m.y += m.vy;
      m.x += Math.sin(sec * 2.2 + m.phase) * m.sway;
      x.save(); x.translate(m.x, m.y);
      x.rotate(m.tilt + Math.sin(sec * 1.6 + m.phase) * 0.5);
      x.scale(m.s, m.s * Math.cos(sec * m.spin + m.phase));
      x.drawImage(bill, -BW / 2, -BH / 2, BW, BH);
      x.restore();
    }
    if (age < 4700) requestAnimationFrame(tick); else c.remove();
  };
  // Wait for Figtree so the "$" on the bills is drawn in the page font.
  document.fonts.load("700 24px Figtree").finally(() => requestAnimationFrame(tick));
})();
