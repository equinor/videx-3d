import { createFormationIntervals, getFormationMarkers, getUnitPicks, mergeFormationIntervals } from '../src/sdk/data/helpers/picks-helpers'
import { TestStore } from './mocks/test-store'


describe("picks-helper", () => {
  const store = new TestStore()

  test('getUnitPicks', async () => {
    let picks = await getUnitPicks('a', 'a', store, false, 100)
    expect(picks?.unmatched.length).toBe(1)
    expect(picks?.unmatched[0].pickIdentifier).toBe("Seabed")
    expect(picks?.matched.length).toBe(10)

    picks = await getUnitPicks('b', 'a', store, false, 900)
    expect(picks?.unmatched.length).toBe(0)
    expect(picks?.matched.length).toBe(12)

    picks = await getUnitPicks('b', 'a', store, false, 100)
    expect(picks?.unmatched.length).toBe(0)
    expect(picks?.matched.length).toBe(12)
    
    picks = await getUnitPicks('b', 'a', store, true, 100)
    expect(picks?.unmatched.length).toBe(1)
    expect(picks?.matched.length).toBe(19)

    picks = await getUnitPicks('c', 'a', store, false, 100)
    expect(picks?.unmatched.length).toBe(1)
    expect(picks?.unmatched[0].pickIdentifier).toBe("Termination")
    expect(picks?.matched.length).toBe(10)
    
    picks = await getUnitPicks('c', 'a', store, true, 100)
    expect(picks?.unmatched.length).toBe(2)
    expect(picks?.matched.length).toBe(25)

    picks = await getUnitPicks('c', 'a', store, true, 1000)
    expect(picks?.unmatched.length).toBe(1)
    expect(picks?.matched.length).toBe(18)
  })

  test('createFormationIntervals', async () => {
    const unitPicks = await getUnitPicks('c', 'a', store, true, 0)
    expect(unitPicks).not.toBeNull()
    const intervals = createFormationIntervals(unitPicks!.matched)
    expect(intervals.length).toBe(11)
  })

  test('mergeFormationIntervals', async () => {
    const unitPicks = await getUnitPicks('c', 'a', store, true, 0)
    expect(unitPicks).not.toBeNull()
    const intervals = createFormationIntervals(unitPicks!.matched)
    const merged = mergeFormationIntervals(intervals)
    expect(merged.length).toBe(10)
    expect(merged[0].unit.name).toBe('D')
    expect(merged[0].mdMslTop).toBe(100)
    expect(merged[0].mdMslBottom).toBe(400)
    expect(merged[1].unit.name).toBe('E')
    expect(merged[1].mdMslTop).toBe(400)
    expect(merged[1].mdMslBottom).toBe(500)
    expect(merged[2].unit.name).toBe('B')
    expect(merged[2].mdMslTop).toBe(500)
    expect(merged[2].mdMslBottom).toBe(900)
    expect(merged[3].unit.name).toBe('F')
    expect(merged[3].mdMslTop).toBe(900)
    expect(merged[3].mdMslBottom).toBe(2000)
    expect(merged[4].unit.name).toBe('G')
    expect(merged[4].mdMslTop).toBe(2000)
    expect(merged[4].mdMslBottom).toBe(2550)
    expect(merged[5].unit.name).toBe('H')
    expect(merged[5].mdMslTop).toBe(2550)
    expect(merged[5].mdMslBottom).toBe(2900)
    expect(merged[6].unit.name).toBe('I')
    expect(merged[6].mdMslTop).toBe(2900)
    expect(merged[6].mdMslBottom).toBe(3000)
    expect(merged[7].unit.name).toBe('J')
    expect(merged[7].mdMslTop).toBe(3000)
    expect(merged[7].mdMslBottom).toBe(3200)
    expect(merged[8].unit.name).toBe('K')
    expect(merged[8].mdMslTop).toBe(3200)
    expect(merged[8].mdMslBottom).toBe(3500)
    expect(merged[9].unit.name).toBe('J')
    expect(merged[9].mdMslTop).toBe(3500)
    expect(merged[9].mdMslBottom).toBe(3600)
  })

  test('getFormationMarkers', async () => {
    const unitPicks = await getUnitPicks('c', 'a', store, true, 0)
    expect(unitPicks).not.toBeNull()
    const intervals = createFormationIntervals(unitPicks!.matched)
    const markers = getFormationMarkers(intervals)

    expect(markers.length).toBe(10)
  })
})