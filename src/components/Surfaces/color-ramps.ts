import {
  interpolateHcl,
  piecewise,
} from 'd3-interpolate'

export type RampFunction = (ctx: CanvasRenderingContext2D, y: number) => void

export function createColorRamps(
  ramps: RampFunction[],
  width: number
): HTMLCanvasElement {
  const n = ramps.length

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = n

  canvas.style.imageRendering = '-moz-crisp-edges'
  canvas.style.imageRendering = 'pixelated'
  const context = canvas.getContext('2d')

  if (context) {
    for (let i = 0; i < ramps.length; i++) {
      ramps[i](context, i)
    }
  }
  return canvas
}

function ramp(color: (t: number) => string, n?: number): RampFunction {
  
  return (ctx, y) => {
    const samples = n !== undefined ? n : ctx.canvas.width
    const w = ctx.canvas.width / (samples - 1)

    for (let i = 0; i < samples; ++i) {
      ctx.fillStyle = color(i / (samples - 1))
      ctx.fillRect(i * w, y, w + 1, 1)
    }
  }
}

const interpolator = (palette: string[]) => (t: number) => piecewise(interpolateHcl, palette)(Math.min(Math.max(0, t), 1))
const rainbow = interpolator(["#5d198e", "#2319a1", "#185db6", "#16c1ca", "#14e083", "#19ef20", "#88f427", "#f5f835", "#fca245", "#ff5555"])
const jet = interpolator(["#000083", "#001e97", "#003caa", "#0163bb", "#028acc", "#03b1dd", "#04d8ee", "#05ffff", "#37ffcc", "#69ff99", "#9bff66", "#cdff33", "#ffff00", "#fecc00", "#fd9900", "#fc6600", "#fb3300", "#fa0000", "#bd0000", "#800000"])
const portland = interpolator(["#0c3383", "#0c448e", "#0b5599", "#0b66a4", "#0a77af", "#0a88ba", "#3897a0", "#67a686", "#95b56c", "#c4c452", "#f2d338", "#f2c238", "#f2b138", "#f2a038", "#f28f38", "#ed7833", "#e8622e", "#e34b28", "#de3523", "#d91e1e"])
const earth = interpolator(["#000082", "#005a9b", "#00b4b4", "#14c36e", "#28d228", "#58d72b", "#87dc2d", "#b7e130", "#e6e632", "#c1b128", "#9d7b1e", "#784614", "#895d31", "#9a744f", "#ab8b6c", "#bca38a", "#ccbaa7", "#ddd1c4", "#eee8e2", "#ffffff"])
const plasma = interpolator(["#0d0887", "#2c0694", "#4b03a1", "#5c03a3", "#6c03a6", "#7d03a8", "#93139f", "#a82296", "#b42e8c", "#bf3a83", "#cb4679", "#d8596b", "#e56b5d", "#ef804f", "#f89441", "#faa439", "#fbb330", "#fdc328", "#f7de25", "#f0f921"])
const salinity = interpolator(["#2a186c", "#262587", "#2132a2", "#1b3f9c", "#154d97", "#0f5a91", "#1c688d", "#287689", "#2e7f88", "#358988", "#3b9287", "#45a183", "#4faf7e", "#64bd73", "#78cb68", "#90d167", "#a9d765", "#c1dd64", "#dfe67f", "#fdef9a"])
const seismic = interpolator(["#ffe700","#ffdf00","#ffd600","#ffce00","#ffc500","#ffbc00","#ffb400","#ffab00","#ffa200","#ff9a00","#ff9100","#ff8900","#ff8000","#ff7700","#ff6f00","#ff6600","#ff5e00","#ff5500","#f55400","#ea5200","#e05100","#d55000","#cb4e00","#c04d00","#b64b00","#ab4a00","#a14900","#964700","#8c4600","#925213","#975d25","#9d6938","#a2744a","#a8805d","#ad8b6f","#b39782","#b8a294","#beaea7","#c3b9b9","#b7aeae","#aaa2a2","#9e9797","#918b8b","#858080","#787474","#6c6969","#5f5d5d","#535252","#464646","#404057","#393968","#333378","#2d2d89","#26269a","#2020ab","#1919bc","#1313cd","#0d0ddd","#0606ee","#0000ff","#000cff","#0018ff","#0024ff","#0030ff","#003cff","#0048ff","#0054ff","#0060ff","#006cff","#0078ff","#0084ff","#0090ff","#009cff","#00a8ff","#00b4ff","#00c0ff","#00ccff","#00d8ff","#00e4ff","#00f0ff"])
const seismic2 = interpolator(["#00004c", "#000092", "#0000db", "#3131ff", "#9999ff", "#fdfdff", "#ff9999", "#ff3535", "#e60000", "#b30000", "#800000"])
const spectrum = interpolator(["#ffffff", "#FFFFBD","#FFFF71","#FFFF24","#FFE300","#FF9100","#F90600","#DB2400","#C03F00","#A45B00","#6D9200","#3AD500","#00FF00","#00EA1E","#00C03F","#009F60","#00AF87","#00CCB3","#00ECD9","#03FBFF","#19F0FF","#2ED1FF","#44BBFF","#4F9EFF","#3870FF","#2143FF","#0B15FF","#180CFF","#4623FF","#7038FF","#A150FF","#BA45FF","#D12EFF","#E817FF","#FF00FF","#CD00D7","#9900AE","#660085","#300059","#0B003C"])
const gray = interpolator(['#000', '#fff'])

export const colorRamps = [
  ramp((t) => rainbow(1 - t)),
  ramp((t) => jet(1 - t)),
  ramp((t) => portland(1 - t)),
  ramp((t) => earth(1 - t)),
  ramp((t) => plasma(1 - t)),
  ramp((t) => salinity(1- t)),
  ramp((t) => seismic(1 - t)),
  ramp((t) => seismic2(1 - t)),
  ramp((t) => spectrum(1 - t)),
  ramp((t) => gray(1 - t))
]

//ramp((t) => `hsl(${(1 - t) * 360},100%,50%)`),