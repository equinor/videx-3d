# Data
The following table gives an overview of the data sets which are predefined in this library. The default [generators](./generators.md) depends on these data sets and structures. Components typically don't depend on data directly, but rather geometry provided by generators. If you are unable to map your own data to these structures, you'll need to create your own generators. You can use the source code of the default generators as a starting point if this is the case.

Data type declarations can be found in `src/sdk/data/types/`

| Key | Type | Description |
|--|--|--|
| position-logs | PositionLog | MSL normalized position log values containing delta easting, tvd MSL, delta northing, md MSL. For optimalization purposes this is stored as a `Float32Array` with a stride of 4, i.e.: [east_0, tvd_0, north_0, md_0, east_1, tvd_1, north_1, md_1, ...] |
| wellbore-headers | WellboreHeader | Contains meta data for the wellbores. Additional user data can be put in the `properties` property. |
| casings | Casing | Contains meta data and MD MSL depths for casings |
| completion-tools | CompletionTool | Contains meta data and MD MSL depths for completion tools |
| perforations | PerforationInterval | Contains meta data and MD MSL depth from perforation intervals |
| picks | Pick | Contains meta data and MD MSL depths for picks |
| surface-meta | SurfaceMeta | Contains meta data about horizons/surface grids |
| surface-values | Float32Array | Contains grid elevation data for surfaces |
| strat-columns | StratColumn | Contains stratigraphy column meta and unit definitions |

## Store
The `Store` interface is an abstraction added to separate data dependencies from components and generators. You can see this as an adaptor between the implementations in this library and the data layer of your project.

The reason we don't pass data directly to the components is to allow data to be fetched and processed by web workers, allowing to conserve memory and CPU resources from the main thread.

The store can be conceptualized as a dictionary of _data sets_. Where each data set in turn is a dictionary of _data records_. How you implementat this interface will depend heavily on your project. The `Store` interface simply defines async functions for getting and setting data. You will need to make sure that the expected data is being fetched and mapped to the correct types. This is going to be the hard part!

We may add a sample implementation for green field projects at a later stage. To get you started, you may have a look at the source code for the mock store used in the Storybook examples. 

## DataProvider
This component provides the `Store` interface implementation as a context. The `GeneratorsProvider` and `useData` hook depends on it.

```tsx

const App = () => {
  // if not using web workers
  const store = useMemo<Store>(() => new StoreImpl(), [])

  return (
    <DataProvider store={store}>
      { ... }
    </DataProvider>
  )
}
```

## useData
A hook that may be used if a component needs data directly from the store, without the need of processing:

```tsx
  const MyComponent = () => {
    const store = useData()

    const [wellboreHeaders, setWellboreHeaders] = useState<WellboreHeader[]>([])
    
    useEffect(() => {
      const headers = store.all<WellboreHeader>('wellbore-headers').then(response => {
        if (response && Array.isArray(response)) {
          setWellboreHeaders(response)
        }
      })
    }, [])

    return (
      <></>
    )
  }
```