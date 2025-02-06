/**
 * Triangulates a heightmap using marching-squares algorithm.
 * This creates a dense polygon count so it's recommended to use
 * {@link triangulateGridDelaunay} instead!
 */
export type TriangleVertex = {
  x: number
  y: number
  z: number
  edge: TriangleEdge | null
}

export type TriangleEdge = {
  index: number
  tail: number
  head: number
  twin: TriangleEdge | null
  prev: TriangleEdge | null
  next: TriangleEdge | null
}

export interface GridValueTransformFunc {
  (v:number) : number | null
}

export function triangulateGrid(grid: Float32Array, columns: number, scaleX = 1, scaleY = 1, transformValue: GridValueTransformFunc = v => v) {
  console.time('triangulate')
  
  const vertices: TriangleVertex[] = []
  const edges: TriangleEdge[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const rows = grid.length / columns
  
  // re-used variables
  let a: number | null,
    b: number | null,
    c: number | null,
    d: number | null,
    v0: number,
    v1: number,
    i0: number,
    i1: number,
    i2: number,
    i3: number,
    val0: number | null,
    val1: number | null,
    val2: number | null,
    val3: number | null,
    col: number,
    row: number,
    col0: number,
    row0: number

  let edge0: TriangleEdge, edge1: TriangleEdge, edge2: TriangleEdge, prevEdge: TriangleEdge | null

  let pattern: number, prevPattern: boolean

  // book-keeping of vertices and edges 
  let vertexCount = 0, edgeCount = 0, ri = 0
  let vertexMap0: (number|null)[] = new Array(columns).fill(null)
  let vertexMap1: (number|null)[] = new Array(columns).fill(null)
  const edgeMap: (TriangleEdge|null)[] = new Array(columns - 1).fill(null)
  
  function addVertex(c: number, r: number, value: number) {
    vertices.push({ x: c * scaleX, y: value, z: r * scaleY, edge: null })
    uvs.push(c / (columns - 1), 1 - (r / (rows - 1)))
    return vertexCount++
  }

  function addFace(v0: number, v1: number, v2: number) {
    edge0 = { index: edgeCount++, tail: v0, head: v1, twin: null, prev: null, next: null }
    edge1 = { index: edgeCount++, tail: v1, head: v2, twin: null, prev: null, next: null }
    edge2 = { index: edgeCount++, tail: v2, head: v0, twin: null, prev: null, next: null }
    
    edge0.next = edge1
    edge1.next = edge2
    edge2.next = edge0

    edge0.prev = edge2
    edge1.prev = edge0
    edge2.prev = edge1

    if (!vertices[v0].edge) {
      vertices[v0].edge = edge0
    }
    if (!vertices[v1].edge) {
      vertices[v1].edge = edge1
    }
    if (!vertices[v2].edge) {
      vertices[v2].edge = edge2
    }
    
    edges.push(edge0, edge1, edge2)
    indices.push(v0, v1, v2)
  }

  // pattern specifies one of the vertex pattern below, otherwise 0:
  // (1) o  o   (2) o  o   (3) o  o   (4) o      (5)    o
  //     o  o       o             o       o  o       o  o  
  for (row = 1; row < rows - 1; row++) {
    prevPattern = false;
    // swap vertex map arrays
    const temp = vertexMap0
    vertexMap0 = vertexMap1
    vertexMap1 = temp.fill(null)
    prevEdge = null
    
    row0 = row - 1
    ri += columns
    
    for (col = 1; col < columns - 1; col++) {
      col0 = col - 1
      
      i3 = ri + col
      i2 = i3 - 1
      i1 = i3 - columns
      i0 = i1 - 1

      val0 = transformValue(grid[i0])
      val1 = transformValue(grid[i1])
      val2 = transformValue(grid[i2])
      val3 = transformValue(grid[i3])
      
      // We can only create triangle(s) if one of the following conditions is true
      if (val0 !== null && val1 !== null && val2 !== null &&  val3 !== null) {
        pattern = 1
      } else if (val0 !== null && val1 !== null &&  val2 !== null) {
        pattern = 2
      } else if (val0 !== null && val1 !== null && val3 !== null) {
        pattern = 3
      } else if (val0 !== null &&  val2 !== null && val3 !== null) {
        pattern = 4
      } else if ( val1 !== null &&  val2 !== null && val3 !== null) {
        pattern = 5
      } else {
        pattern = 0
      }

      // c and d may be added to the vertex map array, so must be initialized to null
      c = null
      d = null 
      if (pattern !== 0) {
         // add vertices and uvs
         if (!prevPattern) {
          if (pattern !== 5) {
            if (vertexMap0[col0] === null) {
              a = addVertex(col0, row0, val0!)
              vertexMap0[col0] = a
            } else {
              a = vertexMap0[col0]
            }
          }
          if (pattern !== 3) {
            c = addVertex(col0, row, val2!)
          }
          vertexMap1[col0] = c
        } else {
          a = vertexMap0[col0]
          c = vertexMap1[col0]
        }
        if (pattern !== 4) {
          if (vertexMap0[col] === null) {
            b = addVertex(col, row0, val1!)
            vertexMap0[col] = b
          } else {
            b = vertexMap0[col]
          }
        }
        if (pattern !== 2) {
          d = addVertex(col, row, val3!)
        }
        
        // add indices and edges
        if (pattern === 1) {
          // need to check values of vertices to determine the optimal diagonal
          v0 = Math.abs(vertices[a!].y - vertices[d!].y)
          v1 = Math.abs(vertices[b!].y - vertices[c!].y)
          
          if (v0 < v1) {
            addFace(a!, c!, d!)
            if (prevEdge !== null) {
              edges[edges.length - 3].twin = prevEdge
              prevEdge.twin = edges[edges.length - 3]
            }
            
            addFace(d!, b!, a!)
            if (edgeMap[col0] !== null) {
              edges[edges.length - 2].twin = edgeMap[col0]
              edgeMap[col0]!.twin = edges[edges.length - 2]
            }
            edges[edges.length - 4].twin = edges[edges.length - 1]
            edges[edges.length - 1].twin = edges[edges.length - 4]
            
            edgeMap[col0] = edges[edges.length - 5]  
            prevEdge = edges[edges.length - 3]
          } else {
            addFace(a!, c!, b!)
            if (edgeMap[col0] !== null) {
              edges[edges.length - 1].twin = edgeMap[col0]
              edgeMap[col0]!.twin = edges[edges.length - 1]
            }
            if (prevEdge !== null) {
              edges[edges.length - 3].twin = prevEdge
              prevEdge.twin = edges[edges.length - 3]
            }
            
            addFace(b!, c!, d!)
            edges[edges.length - 5].twin = edges[edges.length - 3]
            edges[edges.length - 3].twin = edges[edges.length - 5]
            
            edgeMap[col0] = edges[edges.length - 2]
            prevEdge = edges[edges.length - 1]
          }
        } 
        else if (pattern === 2) {
          addFace(a!, c!, b!)
          if (edgeMap[col0] !== null) {
            edges[edges.length - 1].twin = edgeMap[col0]
            edgeMap[col0]!.twin = edges[edges.length - 1]
          }
          if (prevEdge !== null) {
            edges[edges.length - 3].twin = prevEdge
            prevEdge.twin = edges[edges.length - 3]
          }
          edgeMap[col0] = null
          prevEdge = null
        }
        else if (pattern === 5) {
          addFace(b!, c!, d!)
          edgeMap[col0] = edges[edges.length - 2]
          prevEdge = edges[edges.length - 1]
        }
        else if (pattern === 3) {
          addFace(b!, a!, d!)
          if (edgeMap[col0] !== null) {
            edges[edges.length - 3].twin = edgeMap[col0]
            edgeMap[col0]!.twin = edges[edges.length - 3]
          }
          edgeMap[col0] = null
          prevEdge = edges[edges.length - 1]
        } 
        else { // pattern 4
          addFace(a!, c!, d!)
          if (prevEdge !== null) {
            edges[edges.length - 3].twin = prevEdge
            prevEdge.twin = edges[edges.length - 3]
          }
          edgeMap[col0] = edges[edges.length - 2]
          prevEdge = null
        }
      } else {
        edgeMap[col0] = null
        prevEdge = null
      }
      vertexMap1[col] = d
      prevPattern = !!pattern
    }
  }
  
  console.timeEnd('triangulate')
  console.log(indices.length / 3)
  return { vertices, indices, uvs, edges }
}