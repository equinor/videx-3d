
export type KeyType = (string | number)

/**
 * This interface includes the methods which are required in a data store
 * implementation. 
 * 
 * It expects data to be organized as dictionaries of
 * data sets and data records, where data set refers to a specific data type 
 * (i.e. 'wellbore-headers') and records to a specific item in the set
 * indexed by a key (i.e. wellbore id)
 * 
 * get: retrieve a single record from the specified data set with the specified key
 * all: retrieve all records from the specified data set
 * query: retrieve all records from the specified data set matching the query partial values
 * set: set a single record into the specified data set with the specified key
 * 
 * Example of using query to retrieve all wellbore headers for a specific well:
 * @example
 * const wellbores = await mystore.query<WellboreHeader>('wellbore-headers', { well: 'NO 16/2' })
 */
export interface Store {
  // get a single record by key from a data set
  get: <T>(dataType: string, key: KeyType) => Promise<T | null>
  // add a single record to a data set with the specified key
  set: <T>(dataType: string, key: KeyType, value: T) => Promise<boolean>
  // get all records from a data set
  all: <T>(dataType: string) => Promise<T[] | null>
  // get records matching the query partial object from a data set
  query: <T>(dataType: string, query: Partial<T>) => Promise<T[]>
}

/**
 * Read-only version of the Store interface. Omitting the set method.
 */
export type ReadonlyStore = Pick<Store, 'get' | 'all' | 'query'>

