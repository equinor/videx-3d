import _filter from 'lodash.filter'
import { KeyType, ReadonlyStore } from '../../src/sdk'
import picks from './mock-data/picks-mocks'
import stratColumns from './mock-data/stratcolumn-mocks'
import wellboreHeaders from './mock-data/wellbore-mocks'

export class TestStore implements ReadonlyStore {
  data: Record<string, any> = {
    'wellbore-headers': wellboreHeaders,
    'strat-columns': stratColumns,
    'picks': picks,
  }

  async get<T>(dataType: string, key: KeyType) {
    if (!this.data[dataType] || !this.data[dataType][key]) return null
    return this.data[dataType][key] as T
  }

  async all<T>(dataType: string) {
    if (!this.data[dataType]) return null
    return Object.values(this.data[dataType]) as T[]
  }

  async query<T>(dataType: string, query: Partial<T>) {
    if (query) {
      const data = await this.all<T>(dataType)
      return (data ? _filter(data, query) : []) as T[]
    }
    return await this.all<T>(dataType) || []
  }
}