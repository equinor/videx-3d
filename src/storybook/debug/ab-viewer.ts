/**
 * A full-screen A/B viewer for two captures of the same view (Storybook only): A, B, flicker at
 * 2 Hz, a wipe (A left, B right), the difference ×8 (red to yellow), a zoom to the 64² block
 * that differs most, and how much differs. Pixels are compared as 8-bit sRGB, as shown.
 */
export type AbImage = { width: number; height: number; pixels: Uint8ClampedArray };

export type AbStats = {
  /** share of pixels whose largest channel difference exceeds 1/255, and 4/255 */
  changed1: number;
  changed4: number;
  /** mean and largest channel difference (of 255) */
  mean: number;
  max: number;
  /** the 64² block that differs most: its top-left pixel */
  block: [number, number];
};

const BLOCK = 64;
const GAIN = 8;

/** How `a` and `b` differ, and a heat map of it. */
function abDifference(
  a: AbImage,
  b: AbImage,
): { stats: AbStats; heat: Uint8ClampedArray } {
  const { width: w, height: h } = a;
  const diff = new Float32Array(w * h);
  const heat = new Uint8ClampedArray(w * h * 4);
  let sum = 0;
  let max = 0;
  let n1 = 0;
  let n4 = 0;
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(
      Math.abs(a.pixels[4 * i] - b.pixels[4 * i]),
      Math.abs(a.pixels[4 * i + 1] - b.pixels[4 * i + 1]),
      Math.abs(a.pixels[4 * i + 2] - b.pixels[4 * i + 2]),
    );
    diff[i] = d;
    sum += d;
    max = Math.max(max, d);
    if (d > 1) n1++;
    if (d > 4) n4++;
    const t = Math.min((d * GAIN) / 255, 1);
    heat[4 * i] = 255 * Math.min(1, t * 2);
    heat[4 * i + 1] = 255 * Math.max(0, t * 2 - 1);
    heat[4 * i + 3] = 255;
  }
  let best = -1;
  let block: [number, number] = [0, 0];
  for (let y = 0; y + BLOCK <= h; y += 16)
    for (let x = 0; x + BLOCK <= w; x += 16) {
      let s = 0;
      for (let yy = y; yy < y + BLOCK; yy += 4)
        for (let xx = x; xx < x + BLOCK; xx += 4) s += diff[yy * w + xx];
      if (s > best) {
        best = s;
        block = [x, y];
      }
    }
  return {
    stats: {
      changed1: n1 / (w * h),
      changed4: n4 / (w * h),
      mean: sum / (w * h),
      max,
      block,
    },
    heat,
  };
}

function urlOf(width: number, height: number, pixels: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      0,
      0,
    );
  return canvas.toDataURL('image/png');
}

/** Show `a` and `b` (labelled) in the viewer, over the page; closed with its button. */
export function showAb(
  a: AbImage,
  b: AbImage,
  labels: { a: string; b: string; title: string },
): AbStats {
  document.getElementById('ab-viewer')?.remove();
  const { width: w, height: h } = a;
  const { stats, heat } = abDifference(a, b);
  const root = document.createElement('div');
  root.id = 'ab-viewer';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100002',
    background: '#000',
    display: 'flex',
    flexDirection: 'column',
    font: '13px sans-serif',
    color: '#ddd',
  });
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    padding: '6px',
    background: '#16181c',
    flexWrap: 'wrap',
  });
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'relative',
    flex: '1',
    overflow: 'hidden',
  });
  const image = (src: string) => {
    const img = document.createElement('img');
    img.src = src;
    Object.assign(img.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      imageRendering: 'pixelated',
      transformOrigin: '0 0',
    });
    stage.appendChild(img);
    return img;
  };
  const imageA = image(urlOf(w, h, a.pixels));
  const imageB = image(urlOf(w, h, b.pixels));
  const imageD = image(urlOf(w, h, heat));
  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'absolute',
    left: '12px',
    bottom: '12px',
    font: 'bold 28px sans-serif',
    color: '#fff',
    textShadow: '0 0 6px #000',
    zIndex: '2',
  });
  stage.appendChild(label);

  let mode: 'A' | 'B' | 'wipe' | 'diff' = 'A';
  let timer = 0;
  let wipe = 0.5;
  let zoomed = false;
  const show = () => {
    imageA.style.display = mode === 'B' || mode === 'diff' ? 'none' : '';
    imageB.style.display = mode === 'A' || mode === 'diff' ? 'none' : '';
    imageD.style.display = mode === 'diff' ? '' : 'none';
    imageB.style.clipPath = mode === 'wipe' ? `inset(0 0 0 ${wipe * 100}%)` : '';
    label.textContent =
      mode === 'A'
        ? `A — ${labels.a}`
        : mode === 'B'
          ? `B — ${labels.b}`
          : mode === 'diff'
            ? `difference ×${GAIN} (red → yellow)`
            : `wipe: left A (${labels.a}) | right B (${labels.b})`;
  };
  const zoom = (on: boolean) => {
    zoomed = on;
    // The images are fitted (contain): scale so the block fills the stage, shifted to it.
    const fit = Math.min(stage.clientWidth / w, stage.clientHeight / h);
    const scale = Math.min(stage.clientWidth, stage.clientHeight) / BLOCK / fit;
    const [x, y] = stats.block;
    for (const img of [imageA, imageB, imageD])
      img.style.transform = on
        ? `scale(${scale}) translate(${-(x / w) * 100}%, ${-(y / h) * 100}%)`
        : '';
  };
  const button = (text: string, click: () => void) => {
    const element = document.createElement('button');
    element.textContent = text;
    element.style.fontSize = '13px';
    element.onclick = click;
    bar.appendChild(element);
  };
  const stop = () => window.clearInterval(timer);
  const title = document.createElement('b');
  title.textContent = labels.title;
  bar.appendChild(title);
  button(`A: ${labels.a}`, () => {
    stop();
    mode = 'A';
    show();
  });
  button(`B: ${labels.b}`, () => {
    stop();
    mode = 'B';
    show();
  });
  button('flicker 2 Hz', () => {
    stop();
    timer = window.setInterval(() => {
      mode = mode === 'A' ? 'B' : 'A';
      show();
    }, 500);
  });
  button('wipe', () => {
    stop();
    mode = 'wipe';
    show();
  });
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = '0.5';
  slider.oninput = () => {
    wipe = Number(slider.value);
    if (mode === 'wipe') show();
  };
  bar.appendChild(slider);
  button(`difference ×${GAIN}`, () => {
    stop();
    mode = 'diff';
    show();
  });
  button('zoom to largest difference', () => zoom(!zoomed));
  button('close', () => {
    stop();
    root.remove();
  });
  const numbers = document.createElement('span');
  numbers.textContent =
    `changed: ${(100 * stats.changed1).toFixed(1)} % of pixels by >1/255, ` +
    `${(100 * stats.changed4).toFixed(2)} % by >4/255; mean ${stats.mean.toFixed(2)}/255, max ${stats.max}/255`;
  bar.appendChild(numbers);
  root.appendChild(bar);
  root.appendChild(stage);
  document.body.appendChild(root);
  show();
  return stats;
}
