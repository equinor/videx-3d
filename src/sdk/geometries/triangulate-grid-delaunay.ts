import { Delatin } from './delatin'


export function triangulateGridDelaunay(grid: Float32Array, columns: number, scaleX = 1, scaleY = 1, nullValue: number = -1, maxError: number = 5) {
  const width = columns
  const height = grid.length / width
  console.time('delatin')
  const d = new Delatin(grid, width, nullValue)
  d.run(maxError)
  d.removeInvalidTriangles()
  console.timeEnd('delatin')

  const positions = new Float32Array(d.coords.length * 1.5)
  const uvs = new Float32Array(d.coords.length)

  for (let i = 0, j = 0; i < d.coords.length; i += 2) {
    uvs[i] = (d.coords[i] / (width - 1))
    uvs[i + 1] = 1 - (d.coords[i + 1] / (height - 1))
    j = i * 1.5
    positions[j] = d.coords[i] * scaleX
    positions[j + 1] = d.heightAt(d.coords[i], d.coords[i + 1])
    positions[j + 2] = d.coords[i + 1] * scaleY
  }

  const indices = new Uint32Array(d.triangles)


  console.log(d.triangles.length / 3)
  return {positions, uvs, indices }
}