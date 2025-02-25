/**
 * Parses irabin surface/horizon binary files and return the header information and elevation data 
 */
export async function parseIrapbin(blob: Blob, nullValue = -1, refDepth: number | null = null) {
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)

  const header = ({
    ny: view.getInt32(8, false),
    xori: view.getFloat32(12, false),
    xmax: view.getFloat32(16, false),
    yori: view.getFloat32(20, false),
    ymax: view.getFloat32(24, false),
    xinc: view.getFloat32(28, false),
    yinc: view.getFloat32(32, false),
    nx: view.getInt32(44, false),
    rot: view.getFloat32(48, false),
  })

  const maxValue = 1e+30 // largest positive number
  const eplison = 1e-30 // smallest number
  
  const data = new Float32Array(header.nx * header.ny)
  
  let val, batchSize, col, row, idx
  let n = 0
  let pos = 100 // start of data

  while (pos < view.byteLength) {
    batchSize = view.getInt32(pos)
    pos += 4
    // read batch
    for (let i = 0; i < batchSize; i += 4) {
      val = view.getFloat32(pos + i, false)
      col = n % header.nx
      row = header.ny - Math.floor(n / header.nx)
      idx = (row - 1) * header.nx + col
      data[idx] = val < eplison || val > maxValue ? nullValue : (refDepth ? refDepth - val : val)
      n++
    }
    pos += (batchSize + 4)
  }

  return  { header, data }
}