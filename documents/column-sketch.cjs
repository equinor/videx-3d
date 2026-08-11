/* Cross-sections of the stratigraphic column model (chunks.md §14.4).
   Regenerate with: node documents/column-sketch.cjs  → documents/column-sketch.svg */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- the model
// Depths are POSITIVE DOWN, metres, as everywhere else in the chunk code.
//
//   thickness(x) = drape + fill * max(0, dPrev(x) - datum)
//   dNext(x)     = dPrev(x) - thickness(x)
//
// drape blankets the topography; fill levels it toward `datum`. Where the
// previous surface is already shallower than `datum` the fill term is zero, so
// the unit pinches out over a high.
const deposit = (prev, { drape = 0, fill = 0, datum = 0 }) =>
  prev.map(d => d - (drape + fill * Math.max(0, d - datum)));

/** Erode: everything shallower than `surface` is gone. Two ways to say so. */
const erode = (column, surfaceOf, mode) =>
  column.map(layer =>
    layer.map((d, i) => {
      const e = surfaceOf(i);
      if (d >= e) return d;
      // 'clip'  — the horizon is pushed onto the unconformity: zero thickness,
      //           present in the data, a geological pinch-out.
      // 'mask'  — the horizon does not exist there: NO DATA, which is what an
      //           interpreter actually delivers, and what a survey edge also
      //           looks like. The pipeline cannot tell them apart.
      return mode === 'clip' ? e : null;
    }),
  );

// ⭐ A fault, as it exists in GRID data: a height field cannot hold a
// discontinuity, so the throw arrives as a steep RAMP a few cells wide — which
// is what an interpreted surface actually looks like across a fault plane.
// `ramp` is therefore a property of the source gridding, not of the geology.
//
//   offset(x) = throw * smoothstep((x - at) / ramp + 0.5)
//   d' = d - offset(x) * activity     (activity: 1 = fully faulted, 0 = post-fault)
const faultOffset = (x, { at, throw: thr, ramp }) => {
  const t = Math.min(1, Math.max(0, (x - at) / ramp + 0.5));
  return thr * (t * t * (3 - 2 * t));
};

/**
 * @param activity per layer (shallowest first): the share of the throw it took.
 *   All 1 = the fault moved after every unit was laid down. Decreasing upward =
 *   a GROWTH fault, still moving while deposition continued.
 */
const rampFault = (column, spec, activity) =>
  column.map((layer, k) =>
    layer.map((d, i) =>
      d === null ? null : d - faultOffset(XS[i], spec) * (activity?.[k] ?? 1),
    ),
  );

const W = 1180;
const PAD_L = 62;
const PAD_R = 24;
const PANEL_H = 320;

const X0 = 0;
const X1 = 10000;
const STEP = 25;
const XS = [];
for (let x = X0; x <= X1; x += STEP) XS.push(x);

// A structural high with some roughness — the thing deposition buries.
const basement = XS.map(
  x =>
    3000 -
    520 * Math.exp(-(((x - 4200) / 1700) ** 2)) -
    120 * Math.sin(x / 780) -
    60 * Math.sin(x / 310 + 1.2),
);

const PALETTE = [
  '#4e79a7',
  '#59a14f',
  '#edc949',
  '#e15759',
  '#b07aa1',
  '#76b7b2',
  '#ff9da7',
  '#9c755f',
  '#8cd17d',
  '#a0cbe8',
];

const D0 = 1150;
const D1 = 3150;

const px = r => x => PAD_L + ((x - X0) / (X1 - X0)) * (W - PAD_L - PAD_R);
const py = r => d => r.top + ((d - D0) / (D1 - D0)) * r.h;

/** Draw a column as filled bands, top-down. `column[0]` is the shallowest. */
function bands(column, r, names) {
  const X = px(r);
  const Y = py(r);
  let s = '';
  for (let i = 0; i + 1 < column.length; i++) {
    const top = column[i];
    const bottom = column[i + 1];
    // Split into runs where BOTH bounding surfaces exist — a masked stretch
    // leaves a genuine hole, which is the point of the 'mask' variant.
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const fwd = run.map(k => `${X(XS[k])},${Y(top[k])}`).join(' L');
        const back = [...run]
          .reverse()
          .map(k => `${X(XS[k])},${Y(bottom[k])}`)
          .join(' L');
        s += `<path d="M${fwd} L${back} Z" fill="${PALETTE[i % PALETTE.length]}" fill-opacity="0.85" stroke="#00000030"/>`;
      }
      run = [];
    };
    for (let k = 0; k < top.length; k++) {
      if (top[k] === null || bottom[k] === null) flush();
      else run.push(k);
    }
    flush();
  }
  // surface lines on top, so terminations read clearly
  for (const layer of column) {
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        s += `<path d="M${run.map(k => `${X(XS[k])},${Y(layer[k])}`).join(' L')}" fill="none" stroke="#00000055" stroke-width="1"/>`;
      }
      run = [];
    };
    for (let k = 0; k < layer.length; k++) {
      if (layer[k] === null) flush();
      else run.push(k);
    }
    flush();
  }
  if (names) {
    names.forEach(({ at, text, layer, colour }) => {
      const k = Math.round((at - X0) / STEP);
      const d = column[layer][k];
      if (d === null) return;
      s += `<text x="${X(at)}" y="${Y(d) - 5}" class="note" fill="${colour || '#111'}">${text}</text>`;
    });
  }
  return s;
}

function panel(top, title, subtitle, draw) {
  const r = { top: top + 56, h: PANEL_H - 96 };
  let s = `<text x="${PAD_L}" y="${top + 24}" class="h">${title}</text>`;
  s += `<text x="${PAD_L}" y="${top + 43}" class="sub">${subtitle}</text>`;
  s += draw(r);
  // depth axis
  const Y = py(r);
  for (const d of [1500, 2000, 2500, 3000]) {
    s += `<line x1="${PAD_L - 6}" y1="${Y(d)}" x2="${PAD_L}" y2="${Y(d)}" stroke="#999"/>`;
    s += `<text x="${PAD_L - 10}" y="${Y(d) + 4}" class="axis" text-anchor="end">${d}</text>`;
  }
  return s;
}

let body = '';
let top = 16;

// ---------------------------------------------------------------- A: drape
{
  const col = [basement];
  for (let i = 0; i < 4; i++) col.unshift(deposit(col[0], { drape: 170 }));
  body += panel(
    top,
    'A — drape (fill = 0): constant thickness, structure carried upward',
    'thickness = drape. Every surface is a copy of the one below it, so the structural high survives to the top.',
    r => bands(col, r),
  );
  top += PANEL_H;
}

// ---------------------------------------------------------------- B: fill
{
  const col = [basement];
  col.unshift(deposit(col[0], { fill: 1, datum: 2600 }));
  col.unshift(deposit(col[0], { drape: 60, fill: 0.6, datum: 2350 }));
  body += panel(
    top,
    'B — fill toward a datum: the unit floods the lows and PINCHES OUT over the high',
    'thickness = fill · max(0, dPrev − datum). Where the surface below is already shallower than the datum the term is zero — a real zero-thickness termination, not a missing one.',
    r => {
      const Y = py(r);
      const X = px(r);
      let s = `<line x1="${X(X0)}" y1="${Y(2600)}" x2="${X(X1)}" y2="${Y(2600)}" class="datum"/>`;
      s += `<text x="${X(X1)}" y="${Y(2600) - 6}" class="note" text-anchor="end" fill="#8a6d3b">datum 2600 m</text>`;
      s += bands(col, r, [
        {
          at: 4200,
          layer: 2,
          text: '▲ pinch-out over the high',
          colour: '#111',
        },
      ]);
      return s;
    },
  );
  top += PANEL_H;
}

// ------------------------------------------------------------ C: a column
const column = (() => {
  const col = [basement];
  const units = [
    { fill: 1, datum: 2700 },
    { drape: 40, fill: 0.8, datum: 2500 },
    { drape: 120, fill: 0.3, datum: 2400 },
    { drape: 60, fill: 0.9, datum: 2200 },
    { drape: 150 },
    { drape: 40, fill: 0.7, datum: 1900 },
    { drape: 110, fill: 0.2, datum: 1800 },
  ];
  for (const u of units) col.unshift(deposit(col[0], u));
  return col;
})();

{
  body += panel(
    top,
    'C — a column: repeated deposition progressively flattens the structure',
    'Seven units, mixed drape/fill/datum. This is the shape a real column has, and every surface is EXACTLY related to its neighbours — so a crossing downstream is a pipeline bug, never data noise.',
    r => bands(column, r),
  );
  top += PANEL_H;
}

// ------------------------------------------------------- D/E: unconformity
const unconformity = i => {
  const x = XS[i];
  return 2050 + 260 * Math.exp(-(((x - 4200) / 2600) ** 2)) - 0.028 * x;
};

for (const mode of ['clip', 'mask']) {
  const eroded = erode(column, unconformity, mode);
  // deposition resumes above the unconformity: an ANGULAR unconformity
  const above = [];
  let prev = XS.map((_, i) => unconformity(i));
  above.push(prev);
  for (const u of [{ drape: 90, fill: 0.8, datum: 1700 }, { drape: 130 }]) {
    prev = deposit(prev, u);
    above.unshift(prev);
  }

  body += panel(
    top,
    mode === 'clip'
      ? 'D — erosion, encoded as CLIP: truncated horizons are pushed onto the unconformity'
      : 'E — the same erosion, encoded as MASK: truncated horizons simply have no data there',
    mode === 'clip'
      ? 'Zero thickness, still present in the data. The collapse drops them, terminations follow the contour — a geological pinch-out.'
      : '⚠️ This is what an interpreter actually delivers — and it is INDISTINGUISHABLE from a survey edge, which is exactly why §10.1.5 wants the three cases to look different. The seal would taper these back.',
    r => {
      const Y = py(r);
      const X = px(r);
      let s = bands(eroded, r);
      s += bands([...above], r);
      s += `<path d="M${XS.map((x, i) => `${X(x)},${Y(unconformity(i))}`).join(' L')}" fill="none" stroke="#c00" stroke-width="2" stroke-dasharray="7 4"/>`;
      s += `<text x="${X(600)}" y="${Y(unconformity(24)) - 8}" class="note" fill="#c00">unconformity</text>`;
      return s;
    },
  );
  top += PANEL_H;
}

// ------------------------------------------------------------- F: faulting
// A fault is a DISPLACEMENT of one block, so the honest way to evaluate it is to
// restore each output point and read the undeformed column there.
//
//   plane:        x_f(d) = x0 + (d - d0) / tan(dip)     (hanging wall is x > x_f)
//   hanging wall: d(x) = dUndeformed(x - heave) + throw
//   footwall:     d(x) = dUndeformed(x)
//
// A candidate only counts if it lands back on the side it was taken from, which
// is what makes the two interesting cases fall out instead of being special-cased:
// NEITHER side valid = the fault GAP (a band of genuine no-data, width = heave);
// BOTH valid = a repeated section, which a height field CANNOT hold — detect and
// report it rather than silently keeping one of the two answers.
function faultColumn(col, { x0, d0, dip, throw: t }) {
  const tan = Math.tan((dip * Math.PI) / 180);
  const heave = t / tan;
  const xf = d => x0 + (d - d0) / tan;
  const sample = (layer, x) => {
    const k = (x - X0) / STEP;
    if (k < 0 || k > layer.length - 1) return null;
    const lo = Math.floor(k);
    const hi = Math.min(lo + 1, layer.length - 1);
    if (layer[lo] === null || layer[hi] === null) return null;
    return layer[lo] + (layer[hi] - layer[lo]) * (k - lo);
  };
  let repeated = 0;
  const repeatedAt = new Set();
  const out = col.map(layer =>
    XS.map((x, i) => {
      const foot = sample(layer, x);
      const hangRestored = sample(layer, x - heave);
      const hang = hangRestored === null ? null : hangRestored + t;
      const footOk = foot !== null && x < xf(foot);
      const hangOk = hang !== null && x > xf(hang);
      if (footOk && hangOk) {
        repeated++;
        repeatedAt.add(i);
      }
      if (hangOk) return hang;
      if (footOk) return foot;
      return null; // the fault gap
    }),
  );
  return { out, heave, xf, repeated, repeatedAt };
}

{
  const fault = { x0: 6200, d0: 2200, dip: 62, throw: 380 };
  const { out, xf, repeated } = faultColumn(column, fault);
  body += panel(
    top,
    'F — a normal fault: one block drops along the plane, so units are JUXTAPOSED across it',
    `The hanging wall (right) is displaced down-dip, which leaves the left block standing relatively HIGH — an old unit on the left now sits beside a younger one on the right. Restoring each point through the displacement gives the fault GAP for free (the white sliver: structural no-data, width = heave). Repeated-section nodes: ${repeated}.`,
    r => {
      const Y = py(r);
      const X = px(r);
      let s = bands(out, r);
      const trace = [];
      for (let d = D0; d <= D1; d += 25) trace.push(`${X(xf(d))},${Y(d)}`);
      s += `<path d="M${trace.join(' L')}" fill="none" stroke="#c00" stroke-width="2"/>`;
      s += `<text x="${X(xf(D1)) + 8}" y="${Y(D1) - 8}" class="note" fill="#c00">fault plane</text>`;
      s += `<text x="${X(1200)}" y="${Y(1300)}" class="note">footwall — stands relatively high</text>`;
      s += `<text x="${X(7000)}" y="${Y(1300)}" class="note">hanging wall — dropped by the throw</text>`;
      return s;
    },
  );
  top += PANEL_H;
}

{
  // The same fault run the other way: the hanging wall rides UP the plane.
  const fault = { x0: 6200, d0: 2200, dip: 62, throw: -380 };
  const { out, xf, repeated, repeatedAt } = faultColumn(column, fault);
  const cols = [...repeatedAt].sort((a, b) => a - b);
  body += panel(
    top,
    'G — the same fault reversed: a height field CANNOT hold this, and the test says so',
    `Riding the block UP the plane makes the two blocks OVERLAP: ${repeated} nodes have two valid answers (a repeated section, ${cols.length ? `${(XS[cols[0]] / 1000).toFixed(1)}–${(XS[cols[cols.length - 1]] / 1000).toFixed(1)} km` : ''}). One depth per position cannot express it, and picking either answer silently draws a lie. ⇒ generate it, DETECT it, refuse it — never smooth it.`,
    r => {
      const Y = py(r);
      const X = px(r);
      let s = '';
      if (cols.length) {
        const a = X(XS[cols[0]]);
        const b = X(XS[cols[cols.length - 1]]);
        s += `<rect x="${a}" y="${r.top}" width="${Math.max(2, b - a)}" height="${r.h}" fill="#c00" fill-opacity="0.12"/>`;
        s += `<text x="${(a + b) / 2}" y="${r.top + 12}" class="note" text-anchor="middle" fill="#c00">repeated section</text>`;
      }
      s += bands(out, r);
      const trace = [];
      for (let d = D0; d <= D1; d += 25) trace.push(`${X(xf(d))},${Y(d)}`);
      s += `<path d="M${trace.join(' L')}" fill="none" stroke="#c00" stroke-width="2"/>`;
      return s;
    },
  );
  top += PANEL_H;
}

const FAULT = { at: 6100, throw: 280, ramp: 300 };

/** Deposit `units` on top of `base`, returning the new surfaces shallowest-first. */
const depositOn = (base, units) => {
  const out = [];
  let prev = base;
  for (const u of units) {
    prev = deposit(prev, u);
    out.unshift(prev);
  }
  return out;
};

for (const kind of ['post', 'growth']) {
  // 'post'   — the fault moved after everything was deposited: one throw for all.
  // 'growth' — it moved WHILE deposition continued, so each unit took less of the
  //            throw than the one below it, and the units are thicker on the
  //            downthrown side.
  const activity =
    kind === 'post'
      ? column.map(() => 1)
      : column.map((_, k) => Math.min(1, (k + 1) / column.length));
  const faulted = rampFault(column, FAULT, activity);
  // the faulted top is the floor these sit on, so the section stays continuous
  const above = [
    ...depositOn(faulted[0], [
      { drape: 40, fill: 0.9, datum: 1650 },
      { drape: 120 },
    ]),
    faulted[0],
  ];

  body += panel(
    top,
    kind === 'post'
      ? 'H — the same fault as the SOURCE DATA holds it: the plane is covered, the throw is a ramp'
      : 'I — a growth fault: still moving during deposition, so each unit takes less throw than the one below',
    kind === 'post'
      ? 'A grid cannot hold the gap in F, so whoever mapped these surfaces carried them ACROSS the fault plane — the throw arrives as a steep flexure, offset(x) = throw · smoothstep((x − at)/ramp). ⭐ `ramp` is a property of the GRIDDING, not of the geology: narrow it and the surface approaches vertical, which is what stresses the tessellation. Juxtaposition survives; the structural no-data does not.'
      : 'The same offset field with a per-unit share. Units thicken on the downthrown side and the shallowest are barely displaced — the shape in the reference section.',
    r => {
      const X = px(r);
      const Y = py(r);
      let s = bands(faulted, r);
      s += bands(above, r);
      s += `<line x1="${X(FAULT.at)}" y1="${r.top}" x2="${X(FAULT.at)}" y2="${r.top + r.h}" stroke="#c00" stroke-width="1.5" stroke-dasharray="4 4"/>`;
      s += `<text x="${X(FAULT.at) + 6}" y="${r.top + 14}" class="note" fill="#c00">fault, throw ${FAULT.throw} m over a ${FAULT.ramp} m ramp</text>`;
      // ⭐ the point of the whole panel: at ONE depth, different units either side
      const probe = 2250;
      s += `<line x1="${X(X0)}" y1="${Y(probe)}" x2="${X(X1)}" y2="${Y(probe)}" stroke="#111" stroke-width="1" stroke-dasharray="2 3"/>`;
      s += `<text x="${X(X0) + 8}" y="${Y(probe) - 6}" class="note">one depth, two different units — juxtaposition</text>`;
      return s;
    },
  );
  top += PANEL_H;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${top + 16}" viewBox="0 0 ${W} ${top + 16}" font-family="Segoe UI, system-ui, sans-serif">
<style>
  .h { font-size: 15px; font-weight: 600; fill: #111; }
  .sub { font-size: 11.5px; fill: #666; }
  .note { font-size: 11px; }
  .axis { font-size: 10px; fill: #888; }
  .datum { stroke: #8a6d3b; stroke-width: 1.5; stroke-dasharray: 5 4; }
</style>
<rect width="100%" height="100%" fill="#fff"/>
${body}
</svg>`;
const out = path.join(__dirname, 'column-sketch.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${out}`);
