import { edgeOfRectangle } from '../src/sdk/utils/trigonometry'

describe('trigonometry', () => {
  test('should be able to find coordinates of closest edge given a rectangle dimensions and an angle', () => {
    let edge = edgeOfRectangle([100, 50], Math.PI) 
    expect(edge[0]).toBeCloseTo(-50)
    expect(edge[1]).toBeCloseTo(0)

    edge = edgeOfRectangle([100, 50], Math.PI / 2) 
    expect(edge[0]).toBeCloseTo(0)
    expect(edge[1]).toBeCloseTo(-25)

    edge = edgeOfRectangle([100, 50], -Math.PI * 2) 
    expect(edge[0]).toBeCloseTo(50)
    expect(edge[1]).toBeCloseTo(0)

    edge = edgeOfRectangle([100, 50], Math.PI * 2) 
    expect(edge[0]).toBeCloseTo(50)
    expect(edge[1]).toBeCloseTo(0)

    edge = edgeOfRectangle([100, 50], -Math.PI / 2) 
    expect(edge[0]).toBeCloseTo(0)
    expect(edge[1]).toBeCloseTo(25)
  })
})