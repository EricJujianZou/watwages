// CSS for the overlay's shadow root, ported from the approved design
// (approved-design.html). Selectors that targeted :root and body now target
// :host and a .app wrapper, since the overlay owns its own shadow tree
// instead of the whole document. Removed entirely: the "Showing fit for"
// pill (.fitfor) and the ROI breakdown card (.roibox), per the product
// changes in docs/build-contract-v2.md. Added: a quiet loading skeleton for
// cells whose pay or ROI has not been read yet, and a small results-bar
// progress line.

export const OVERLAY_CSS = `
:host{
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: block;
  color-scheme: light;
  --env:#E6E2D8; --env-warm:rgba(255,236,196,.55); --env-cool:rgba(190,204,222,.5);
  --ink:#15171C; --ink2:#4A4F5B; --ink3:#61666F;
  --plate:rgba(251,250,247,.96); --plate-solid:#FBFAF7; --plate-edge:rgba(22,24,29,.08);
  --row:rgba(253,252,250,.9); --row-hover:#FFFFFF; --row-back:rgba(253,252,250,.62);
  --glass:rgba(252,251,248,.6); --glass-strong:rgba(252,251,248,.84); --blur:28px;
  --rim:rgba(255,255,255,.8); --line:rgba(22,24,29,.1); --line2:rgba(22,24,29,.16);
  --gold:#F5C518; --gold-ink:#15171C; --gold-deep:#A87C00; --gold-tint:rgba(245,197,24,.18);
  --urgent:#B4380F; --urgent-bg:rgba(180,56,15,.1); --soon:#855600; --soon-bg:rgba(200,150,10,.16);
  --ok:#1F6B45; --ok-bg:rgba(31,107,69,.1); --blue:#2B4C9B; --blue-bg:rgba(43,76,155,.1);
  --tip:#15171C; --tip-ink:#F2F0EB; --tip-ink2:#B9BCC4;
  --sh2:0 2px 6px rgba(20,22,30,.08), 0 16px 36px rgba(20,22,30,.16);
  --sh3:0 4px 12px rgba(20,22,30,.1), 0 40px 90px rgba(20,22,30,.28);
  --ease:cubic-bezier(.2,.8,.2,1);
  --font:"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark){
  :host(:not([data-theme="light"])){
    --env:#17181C; --env-warm:rgba(120,96,40,.28); --env-cool:rgba(40,60,100,.32);
    --ink:#F2F0EB; --ink2:#C0C3CA; --ink3:#A3A7B0;
    --plate:rgba(32,34,40,.96); --plate-solid:#202228; --plate-edge:rgba(255,255,255,.08);
    --row:rgba(38,40,47,.88); --row-hover:#30333B; --row-back:rgba(38,40,47,.55);
    --glass:rgba(44,46,54,.55); --glass-strong:rgba(44,46,54,.82);
    --rim:rgba(255,255,255,.16); --line:rgba(255,255,255,.1); --line2:rgba(255,255,255,.18);
    --gold-deep:#F2C230; --gold-tint:rgba(242,194,48,.16);
    --urgent:#FF9468; --urgent-bg:rgba(255,120,70,.14); --soon:#F2C15B; --soon-bg:rgba(242,193,91,.14);
    --ok:#7FD3A4; --ok-bg:rgba(127,211,164,.12); --blue:#9DB4F5; --blue-bg:rgba(157,180,245,.14);
    --tip:#F2F0EB; --tip-ink:#15171C; --tip-ink2:#4A4F5B;
    --sh2:0 2px 6px rgba(0,0,0,.3), 0 16px 36px rgba(0,0,0,.4);
    --sh3:0 4px 12px rgba(0,0,0,.35), 0 40px 90px rgba(0,0,0,.55);
    color-scheme: dark;
  }
}
:host([data-theme="dark"]){
  --env:#17181C; --env-warm:rgba(120,96,40,.28); --env-cool:rgba(40,60,100,.32);
  --ink:#F2F0EB; --ink2:#C0C3CA; --ink3:#A3A7B0;
  --plate:rgba(32,34,40,.96); --plate-solid:#202228; --plate-edge:rgba(255,255,255,.08);
  --row:rgba(38,40,47,.88); --row-hover:#30333B; --row-back:rgba(38,40,47,.55);
  --glass:rgba(44,46,54,.55); --glass-strong:rgba(44,46,54,.82);
  --rim:rgba(255,255,255,.16); --line:rgba(255,255,255,.1); --line2:rgba(255,255,255,.18);
  --gold-deep:#F2C230; --gold-tint:rgba(242,194,48,.16);
  --urgent:#FF9468; --urgent-bg:rgba(255,120,70,.14); --soon:#F2C15B; --soon-bg:rgba(242,193,91,.14);
  --ok:#7FD3A4; --ok-bg:rgba(127,211,164,.12); --blue:#9DB4F5; --blue-bg:rgba(157,180,245,.14);
  --tip:#F2F0EB; --tip-ink:#15171C; --tip-ink2:#4A4F5B;
  --sh2:0 2px 6px rgba(0,0,0,.3), 0 16px 36px rgba(0,0,0,.4);
  --sh3:0 4px 12px rgba(0,0,0,.35), 0 40px 90px rgba(0,0,0,.55);
  color-scheme: dark;
}
@media (prefers-reduced-transparency: reduce){ :host{ --glass:var(--env); --glass-strong:var(--env); --blur:0px; } }

*{box-sizing:border-box}
.app{
  position:absolute; inset:0; overflow:auto; min-height:100%;
  margin:0; font-family:var(--font); color:var(--ink); font-size:15px; line-height:1.45;
  background-color:var(--env);
  background-image:radial-gradient(1100px 700px at 8% -10%, var(--env-warm), transparent 70%),radial-gradient(900px 700px at 105% 110%, var(--env-cool), transparent 70%);
  background-attachment:local; padding-inline:16px;
}
::selection{background:var(--gold); color:var(--gold-ink)}
:focus-visible{outline:2px solid var(--ink); outline-offset:2px; box-shadow:0 0 0 5px rgba(245,197,24,.55); border-radius:8px}
button,input,select{font:inherit; color:inherit}
button{cursor:pointer}
a{color:inherit}
.num{font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
svg.i{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
*{scrollbar-width:thin; scrollbar-color:var(--line2) transparent}
.glass{background:var(--glass); -webkit-backdrop-filter:blur(var(--blur)) saturate(170%); backdrop-filter:blur(var(--blur)) saturate(170%); box-shadow:inset 0 1px 0 var(--rim), 0 0 0 1px var(--line), var(--sh2)}

.frame{display:grid; grid-template-columns:72px minmax(0,1fr); gap:20px; padding-block:18px 48px; max-width:1720px; margin:0 auto}

/* Rail */
.rail{position:sticky; top:18px; height:calc(100vh - 36px); z-index:30}
.rail-inner{position:absolute; inset:0 auto 0 0; width:72px; border-radius:36px; padding:12px 10px; display:flex; flex-direction:column; gap:4px; overflow:hidden; transition:width .32s var(--ease)}
.rail:hover .rail-inner,.rail:focus-within .rail-inner{width:280px; background:var(--glass-strong)}
.rail .mark{display:flex; align-items:center; gap:12px; padding:6px 7px 14px; font-weight:700; white-space:nowrap}
.rail .mark b{display:grid; place-items:center; width:38px; height:38px; border-radius:12px; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.14); flex:none}
.rail .mark b img{width:28px; height:28px; display:block}
.rail a{display:flex; align-items:center; gap:14px; padding:10px 13px; border-radius:14px; text-decoration:none; white-space:nowrap; font-weight:500; color:var(--ink2); font-size:14px}
.rail a:hover{background:var(--line); color:var(--ink)}
.rail a.on{background:var(--ink); color:var(--env)}
.rail .lbl{opacity:0; transition:opacity .2s}
.rail:hover .lbl,.rail:focus-within .lbl{opacity:1}
.rail .spacer{flex:1}

/* Top */
.top{display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:4px 4px 14px}
.top h1{font-size:28px; line-height:1.1; letter-spacing:-.02em; margin:0; font-weight:700}
.views{display:inline-flex; padding:4px; border-radius:999px; gap:2px; max-width:100%; overflow-x:auto; scrollbar-width:none}
.views button{border:0; background:none; padding:8px 14px; border-radius:999px; font-weight:600; font-size:14px; color:var(--ink2); white-space:nowrap; display:inline-flex; gap:6px; align-items:center}
.views button:hover{color:var(--ink)}
.views button[aria-pressed="true"]{background:var(--plate); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.14)}
.views .n{font-size:12px; font-weight:600; color:var(--ink3)}
.top .right{margin-left:auto; display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap; min-width:0; max-width:100%}
.orig{border:0; border-radius:999px; padding:13px 16px; line-height:16px; font-size:13px; font-weight:600; color:var(--ink)}
.orig:hover{background:var(--row-hover)}
.theme{display:inline-flex; align-items:center; gap:8px; border:0; border-radius:999px; padding:8px 14px 8px 10px; font-size:13px; font-weight:600; color:var(--ink)}
.theme .knob{display:grid; place-items:center; width:26px; height:26px; border-radius:50%; background:var(--plate); box-shadow:0 1px 3px rgba(0,0,0,.18)}
.theme .knob svg{width:16px; height:16px}

/* Workspace: results on the left, posting panel on the right */
.work{display:grid; grid-template-columns:minmax(0,1fr) 0px; gap:0; align-items:start; transition:grid-template-columns .42s var(--ease), gap .42s var(--ease)}
.app.open .work{grid-template-columns:minmax(0,1fr) min(540px,42vw); gap:18px}
.results{min-width:0; display:grid; gap:14px}

/* Filters */
.filters{position:sticky; top:12px; z-index:20; border-radius:22px; padding:8px; display:flex; flex-direction:column; gap:8px}
.frow{display:flex; gap:8px; align-items:center; min-width:0; flex-wrap:wrap}
.search{flex:1 1 260px; min-width:0; display:flex; align-items:center; gap:10px; background:var(--plate); border-radius:14px; padding:0 14px; box-shadow:inset 0 0 0 1px var(--plate-edge)}
.search input{flex:1; min-width:0; border:0; background:none; padding:12px 0; font-size:15px; outline:none}
.search input::placeholder{color:var(--ink3)}
.search kbd{font:600 11px var(--font); color:var(--ink3); border:1px solid var(--line2); border-radius:6px; padding:2px 6px}
.btn{display:inline-flex; align-items:center; gap:8px; border:0; border-radius:12px; padding:10px 14px; font-weight:600; font-size:14px; background:var(--plate); box-shadow:inset 0 0 0 1px var(--plate-edge); white-space:nowrap; text-decoration:none; color:var(--ink)}
.btn:hover{background:var(--row-hover)}
.btn[hidden]{display:none}
.btn.dark{background:var(--ink); color:var(--env); box-shadow:none}
.btn.gold{background:var(--gold); color:#15171C; box-shadow:inset 0 -1px 0 rgba(0,0,0,.15)}
.btn.gold:hover{background:#FFD23A}
.btn.gold:disabled{opacity:.7; cursor:default}
.btn.ghost{background:none; box-shadow:none}
.btn.ghost:hover{background:var(--line)}
.btn .count{background:var(--gold); color:#15171C; border-radius:999px; font-size:11.5px; padding:1px 7px}
.chip{display:inline-flex; align-items:center; gap:6px; border:0; border-radius:999px; padding:7px 12px 7px 14px; font-size:13.5px; font-weight:600; color:var(--ink); background:var(--plate); box-shadow:inset 0 0 0 1px var(--plate-edge); white-space:nowrap}
.chip svg.i{width:15px; height:15px; color:var(--ink3)}
.chip:hover{background:var(--row-hover)}
.chip.on{background:var(--ink); color:var(--env)}
.chip.on svg.i{color:inherit}
.chip .val{font-weight:500; opacity:.85}
.chip.pill{padding:7px 14px}
.chip.pill.on{background:var(--gold); color:#15171C}
.chip.pill.on svg.i{color:#15171C}
.fsep{width:1px; align-self:stretch; background:var(--line2); margin:4px 2px}
.clearall{font-size:13px; font-weight:600; border:0; background:none; color:var(--ink2); text-decoration:underline; text-underline-offset:3px; white-space:nowrap; padding:6px 8px}

/* Results window */
.window{border-radius:18px; padding:6px}
.wbar{display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:10px 12px 8px 14px}
.wbar .count{font-weight:700; font-size:16px}
.wbar .count span{font-weight:500; color:var(--ink2); font-size:14px}
.wbar .prog{font-size:12.5px; color:var(--ink3); white-space:nowrap}
.progbar{height:3px; margin:0 14px 4px; border-radius:3px; background:var(--line); overflow:hidden}
.progbar[hidden]{display:none}
.progbar span{display:block; height:100%; width:0; border-radius:3px; background:var(--gold); transition:width .3s ease-out}
.progbar.indet span{width:30%; animation:wmj-indet 1.2s ease-in-out infinite}
@keyframes wmj-indet{from{transform:translateX(-100%)} to{transform:translateX(340%)}}
@media (prefers-reduced-motion: reduce){.progbar.indet span{animation:none; width:100%; opacity:.5}}
.wbar .hint{margin-left:auto; font-size:12.5px; color:var(--ink3); display:flex; align-items:center; gap:6px}
.wbar kbd{font:600 11px var(--font); border:1px solid var(--line2); border-radius:5px; padding:1px 5px; display:inline-grid; place-items:center; min-width:20px; height:20px}
.wbar kbd svg{width:12px;height:12px}
table.res{width:100%; table-layout:fixed; border-collapse:separate; border-spacing:0 3px; font-size:14px}
table.res th{text-align:left; font-weight:600; font-size:12.5px; color:var(--ink2); padding:8px 10px; white-space:nowrap; vertical-align:bottom}
table.res th .hd{display:inline-flex; align-items:center; gap:4px}
table.res th button.sort{border:0; background:none; font:inherit; color:inherit; display:inline-flex; align-items:center; gap:2px; padding:4px 6px; margin:-4px -6px; border-radius:8px}
table.res th button.sort:hover{background:var(--line); color:var(--ink)}
table.res th .ar{opacity:.3; width:14px; height:14px}
table.res th[aria-sort] .ar{opacity:1}
table.res th.c-n{text-align:right}
table.res th.c-n .hd{flex-direction:row-reverse}
.info{display:inline-grid; place-items:center; width:22px; height:22px; border:0; border-radius:50%; background:none; color:var(--ink3); padding:0}
.info:hover,.info[aria-expanded="true"]{color:var(--ink); background:var(--line)}
.info svg{width:16px; height:16px}
table.res td{padding:0 10px; height:48px; background:var(--row); vertical-align:middle; border-top:1px solid var(--plate-edge); border-bottom:1px solid var(--plate-edge); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; transition:background .2s, opacity .3s}
table.res td:first-child{border-radius:12px 0 0 12px; border-left:1px solid var(--plate-edge); padding-left:14px}
table.res td:last-child{border-radius:0 12px 12px 0; border-right:1px solid var(--plate-edge)}
table.res tbody tr{cursor:pointer; transition:transform .2s var(--ease), filter .2s var(--ease), opacity .3s}
table.res tbody tr:hover{transform:translateY(-1px); filter:drop-shadow(0 6px 14px rgba(20,22,30,.12))}
table.res tbody tr:hover td{background:var(--row-hover)}
table.res tbody tr:focus-visible{outline:none}
table.res tbody tr:focus-visible td{background:var(--row-hover); box-shadow:inset 0 2px 0 var(--gold), inset 0 -2px 0 var(--gold)}
/* Spatial: with a posting open, the other rows sink back and the open one stays lifted */
.app.open table.res tbody tr:not(.sel) td{background:var(--row-back)}
.app.open table.res tbody tr:not(.sel){opacity:.78}
.app.open table.res tbody tr:not(.sel):hover{opacity:1}
table.res tbody tr.sel{transform:translateY(-1px) scale(1.006); filter:drop-shadow(0 10px 22px rgba(20,22,30,.18)); position:relative; z-index:2}
table.res tbody tr.sel td{background:var(--row-hover); box-shadow:inset 0 2px 0 var(--gold), inset 0 -2px 0 var(--gold)}
table.res tbody tr.sel td:first-child{box-shadow:inset 2px 0 0 var(--gold), inset 0 2px 0 var(--gold), inset 0 -2px 0 var(--gold)}
table.res tbody tr.sel td:last-child{box-shadow:inset -2px 0 0 var(--gold), inset 0 2px 0 var(--gold), inset 0 -2px 0 var(--gold)}
col.c-title{width:auto} col.c-org{width:22%} col.c-roi{width:88px} col.c-pay{width:104px} col.c-loc{width:17%} col.c-int{width:52px} col.c-tab{width:48px}
.t{font-weight:600}
.tagnew{font-size:10.5px; font-weight:700; letter-spacing:.02em; color:var(--blue); background:var(--blue-bg); padding:1px 6px; border-radius:6px; margin-right:7px; vertical-align:1px}
td.viewed .t{font-weight:500; color:var(--ink2)}
.org{color:var(--ink2)}
td.c-n{text-align:right}
.roi{display:inline-flex; align-items:center; gap:8px; font-weight:700}
.roi .bar{width:28px; height:5px; border-radius:3px; background:var(--line); overflow:hidden}
.roi .bar i{display:block; height:100%; background:var(--ink2); border-radius:3px}
.roi.top .bar i{background:var(--gold-deep)}
.roi.top b{background:var(--gold-tint); padding:1px 6px; border-radius:6px; margin:-1px -6px}
.pay{font-weight:600}
.pay.none{font-weight:500; color:var(--ink3)}
.loc small{color:var(--ink3); font-size:12.5px; margin-left:6px}
table.res td.ic{padding:0 4px; text-align:center; overflow:visible; text-overflow:clip}
.ib{display:inline-grid; place-items:center; width:32px; height:32px; border:0; border-radius:10px; background:none; color:var(--ink3); text-decoration:none}
.ib:hover{background:var(--line); color:var(--ink)}
.ib.on{color:var(--gold-deep)}
.ib.on svg{fill:var(--gold)}
.ib:disabled{opacity:.4; cursor:default}
.empty{padding:48px 20px; text-align:center; color:var(--ink2)}
.empty b{display:block; color:var(--ink); font-size:17px; margin-bottom:6px}

/* Quiet loading placeholder for cells not read yet */
.skel{display:inline-block; height:12px; border-radius:6px; background:var(--line2); width:44px; vertical-align:middle}
@media (prefers-reduced-motion: no-preference){ .skel{ animation:skelpulse 1.6s ease-in-out infinite } }
@keyframes skelpulse{ 0%,100%{opacity:.55} 50%{opacity:1} }

/* Popovers and the ROI tooltip */
.pop{position:fixed; z-index:80; min-width:250px; max-width:min(360px, calc(100vw - 24px)); border-radius:18px; padding:8px; display:none}
.pop.show{display:block; animation:popIn .2s var(--ease)}
@keyframes popIn{from{opacity:0; transform:translateY(-6px) scale(.98)}}
.pop .plate{background:var(--plate); border-radius:12px; padding:8px; max-height:60vh; overflow:auto}
.pop h4{margin:4px 8px 8px; font-size:13px; color:var(--ink2); font-weight:600}
.opt{display:flex; align-items:center; gap:10px; width:100%; border:0; background:none; text-align:left; padding:8px 10px; border-radius:9px; font-size:14px}
.opt:hover{background:var(--line)}
.opt .box{width:18px; height:18px; border-radius:6px; box-shadow:inset 0 0 0 1.5px var(--ink3); display:grid; place-items:center; flex:none}
.opt[aria-checked="true"] .box{background:var(--ink); box-shadow:none; color:var(--env)}
.opt .box svg{width:12px; height:12px; stroke-width:3; opacity:0}
.opt[aria-checked="true"] .box svg{opacity:1}
.opt .n{margin-left:auto; color:var(--ink3); font-size:12.5px}
.opt small{display:block; color:var(--ink3); font-size:12.5px}
.field{display:grid; gap:6px; padding:8px 10px}
.field label{font-size:13px; font-weight:600; color:var(--ink2)}
.field input,.field select{border:0; border-radius:10px; padding:9px 12px; background:var(--env); box-shadow:inset 0 0 0 1px var(--line2); font-size:14px}
.popfoot{display:flex; gap:8px; justify-content:flex-end; padding:8px 4px 2px}
.tip{position:fixed; z-index:90; width:min(340px, calc(100vw - 24px)); background:var(--tip); color:var(--tip-ink); border-radius:14px; padding:12px 14px; font-size:13.5px; line-height:1.5; box-shadow:var(--sh3); display:none; pointer-events:none}
.tip.show{display:block; animation:popIn .16s var(--ease)}

/* Posting panel */
.panel{position:sticky; top:12px; height:calc(100vh - 24px); width:min(540px,42vw); border-radius:26px; padding:7px; display:flex; flex-direction:column; opacity:0; transform:translateX(40px) scale(.98); pointer-events:none; transition:opacity .34s var(--ease), transform .42s var(--ease); z-index:25}
.app.open .panel{opacity:1; transform:none; pointer-events:auto}
.panel .plate{flex:1; min-height:0; background:var(--plate); border-radius:20px; display:flex; flex-direction:column; overflow:hidden}
.ptop{display:flex; align-items:center; gap:4px; padding:10px 10px 0 18px}
.ptop .pos{font-size:12.5px; color:var(--ink3); margin-right:auto}
.pscroll{flex:1; overflow:auto; padding:6px 22px 24px}
.phead .idl{display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12.5px; color:var(--ink3); margin:6px 0 8px}
.phead h2{font-size:24px; line-height:1.15; letter-spacing:-.015em; margin:0 0 6px; text-wrap:balance}
.phead h2:focus{outline:none; box-shadow:none}
.phead .who{font-size:15px; color:var(--ink2)}
.pill{display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; background:var(--line); color:var(--ink2)}
.pill.urgent{background:var(--urgent-bg); color:var(--urgent)}
.pill.soon{background:var(--soon-bg); color:var(--soon)}
.pill.new{background:var(--blue-bg); color:var(--blue)}
.pacts{display:flex; gap:8px; flex-wrap:wrap; margin:14px 0 4px}
.tabs{display:flex; gap:2px; border-bottom:1px solid var(--line); margin:16px 0 18px; position:sticky; top:-6px; background:var(--plate-solid); z-index:3}
.tabs button{position:relative; border:0; background:none; padding:10px 12px 11px; font-weight:600; color:var(--ink3); font-size:14.5px; display:flex; gap:7px; align-items:center}
.tabs button:hover{color:var(--ink)}
.tabs button[aria-selected="true"]{color:var(--ink)}
.tabs button[aria-selected="true"]::after{content:""; position:absolute; left:8px; right:8px; bottom:-1px; height:3px; background:var(--gold); border-radius:3px 3px 0 0}
.tabs .sc{font-size:12px; background:var(--line); border-radius:999px; padding:1px 7px; color:var(--ink2)}
.facts{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--line); border-radius:14px; overflow:hidden; margin:0 0 18px; box-shadow:0 0 0 1px var(--line)}
.fact{background:var(--plate-solid); padding:12px 14px}
.fact dt{font-size:12px; font-weight:600; color:var(--ink3); margin-bottom:4px}
.fact dd{margin:0; font-size:18px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums}
.fact dd small{display:block; font-size:12.5px; font-weight:500; color:var(--ink2); margin-top:3px; line-height:1.35}
.fact dd.none{font-size:15px; color:var(--ink2)}
.fact.roifact{background:var(--gold-tint)}
.fact.roifact dd{font-size:28px}
.sec{margin:0 0 20px}
.sec h3{font-size:15px; margin:0 0 8px}
.prose{font-size:14.5px; line-height:1.55; max-width:66ch}
.prose p{margin:0 0 8px}
.prose ul{margin:0; padding-left:20px; display:grid; gap:4px}
.fields{display:grid; grid-template-columns:minmax(120px,38%) 1fr; gap:8px 14px; margin:0; font-size:14px}
.fields dt{color:var(--ink3); font-weight:500}
.fields dd{margin:0}
.docs,.skills,.discs{display:flex; flex-wrap:wrap; gap:6px}
.docs span,.skills span{font-size:13px; font-weight:600; padding:3px 10px; border-radius:999px; background:var(--line)}
.docs span.flag{background:var(--gold-tint)}
.skills span.more{background:none; box-shadow:inset 0 0 0 1px var(--line2); font-weight:500; color:var(--ink2)}
.discs span{font-size:13px; padding:3px 10px; border-radius:999px; box-shadow:inset 0 0 0 1px var(--line2)}
.discs span.you{background:var(--ok-bg); color:var(--ok); box-shadow:none; font-weight:600}
.cols{display:flex; align-items:flex-end; gap:6px; height:120px; padding:0 0 0 28px; position:relative; margin:8px 0 4px}
.cols .ax{position:absolute; left:0; font-size:11px; color:var(--ink3); font-variant-numeric:tabular-nums}
.cols .ax.top{top:0} .cols .ax.bot{bottom:0}
.cols .gl{position:absolute; left:26px; right:0; top:6px; border-top:1px dashed var(--line2)}
.cols i{flex:1; background:var(--ink2); border-radius:4px 4px 0 0; min-height:2px; position:relative}
.cols i.you{background:var(--gold-deep); min-height:0}
.xl{display:flex; gap:6px; padding-left:28px; font-size:11px; color:var(--ink3)}
.xl span{flex:1; text-align:center; white-space:nowrap}
.rating{display:flex; gap:14px; align-items:center; padding:12px 14px; border-radius:14px; box-shadow:inset 0 0 0 1px var(--line); margin-top:14px}
.rating b{font-size:26px; font-variant-numeric:tabular-nums}
.rating span{font-size:13.5px; color:var(--ink2)}

.toast{position:fixed; left:50%; bottom:24px; transform:translate(-50%, 20px); z-index:95; border-radius:14px; padding:12px 18px; font-size:14px; font-weight:500; opacity:0; pointer-events:none; transition:opacity .25s, transform .25s var(--ease); background:var(--glass-strong)}
.toast.show{opacity:1; transform:translate(-50%,0)}

@media (max-width:1100px){
  col.c-org{width:24%} col.c-loc{width:0} th.c-loc,td.c-loc{display:none}
}
@media (max-width:900px){
  .frame{grid-template-columns:minmax(0,1fr)}
  .rail{display:none}
  .app.open .work{grid-template-columns:minmax(0,1fr) 0px; gap:0}
  .panel{position:fixed; top:8px; bottom:8px; right:8px; left:8px; width:auto; height:auto; transform:translateX(60px)}
}
@media (max-width:640px){
  col.c-org{width:0} th.c-org,td.c-org{display:none}
  col.c-roi{width:64px} col.c-pay{width:78px}
  .top h1{font-size:22px}
  .wbar .hint span.txt{display:none}
}
@media (prefers-reduced-motion: reduce){ *,*::before,*::after{transition:none!important; animation:none!important} }
`;
