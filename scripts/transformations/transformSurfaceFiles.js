import fs from 'node:fs'
import { rimrafSync } from 'rimraf'

function parseIrapbin(buffer, nullValue = -1, refDepth = null) {
  const view = new DataView(buffer)

  const header = {
    ny: view.getInt32(8, false),
    xori: view.getFloat32(12, false),
    xmax: view.getFloat32(16, false),
    yori: view.getFloat32(20, false),
    ymax: view.getFloat32(24, false),
    xinc: view.getFloat32(28, false),
    yinc: view.getFloat32(32, false),
    nx: view.getInt32(44, false),
    rot: view.getFloat32(48, false),
  }

  const maxValue = 1e30 // largest positive number
  const eplison = 1e-30 // smallest number

  const data = new Array(header.nx * header.ny)

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
      row = header.ny - Math.floor(n / header.nx) - 1
      idx = row * header.nx + col
      data[idx] =
        val < eplison || val > maxValue
          ? nullValue
          : refDepth
          ? refDepth - val
          : val
      n++
    }
    pos += batchSize + 4
  }

  return data
}

/**
 * Surface values are transformed from irapbin files located in
 * [source path]/surfaces/[surfaceId].irapbin
 */
export function transformSurfaceFiles(meta, inPath, outPath) {
  const destPath = outPath + 'surfaces'
  console.info('Processing surface files...')
  console.info('> preparing destination path')
  if (fs.existsSync(destPath)) {
    rimrafSync(destPath)
  }
  fs.mkdirSync(destPath)

  let n = 0
  Object.keys(meta).forEach((surfaceId) => {
    const sourceFile = `${inPath}surfaces/${surfaceId}.irapbin`
    const refDepth = meta[surfaceId].max
    try {
      console.info(`> reading source: ${sourceFile}`)
      const irapbin = fs.readFileSync(sourceFile)
      const values = parseIrapbin(irapbin.buffer, -1, refDepth)
      const target = destPath + `/${surfaceId}.json`
      console.info(`> writing target: ${target}`)
      fs.writeFileSync(target, JSON.stringify(values))
      n++
    } catch (err) {
      console.warn(err)
    }
  })

  console.info(`${n} surface files transformed!`)
}
