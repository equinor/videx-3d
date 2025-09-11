# Generators

Generators are special factory functions that can be used by components to externalize data fetching and processing. 

The following table gives an overview of the generators required for each component. The generator function needs to be added to the `GeneratorRegistry` with the generator key listed here for the component to work!

The generator keys are exported as variables, named according to the generator key column, and can be imported from `videx-3d`.

The generator functions can be imported from `videx-3d/generators` (default implementations).

**Note:** The default generators have data dependencies. Please see [data docs](./data.md) for more information.

| Component | Key | Default generator function | Data dependencies |
|--|--|--|--|
| **BasicTrajectory** | basicTrajectory | generateBasicTrajectory | - position-logs |
| **CasingAnnotations** | casingToolAnnotations | generateCasingAnnotations | - position-logs<br/>- casings |
| **Casings** | casings | generateCasings | - position-logs<br/>- casings |
| **CompletionAnnotations** | completionToolAnnotations | generateCompletionToolAnnotations | - position-logs<br/>- completion-tools |
| **CompletionTools** | completionTools | generateCompletionTools | - position-logs<br/>- completion-tools |
| **WellboreFormationColumn** | wellboreFormationColumn | generateWellboreFormationColumnGeometries | - position-logs<br/>- formations |
| **DepthMarkers** | depthMarkers | generateDepthMarkers | - position-logs |
| **Perforations** | perforationSymbols | generatePerforations | - position-logs<br/>- perforations |
| **Perimeter** | perimeterGeometry | generatePerimeterGeometry | - position-logs |
| **FormationMarkers** | formationSymbols | generateFormationMarkers | - position-logs<br/>- formations |
| **Shoes** | shoeSymbols | generateShoes | - position-logs<br/>- casings |
| **Surface** | surfaceGeometry | generateSurfaceGeometry | - surface-meta<br/>- surface-values |
| **Surface** | surfaceTextures | generateSurfaceTextureData | - surface-meta<br/>- surface-values |
| **TubeTrajectory** | tubeTrajectory | generateTubeTrajectory | - position-logs |
| **WellboreBounds** | wellboreBounds | calculateWellboreBounds | - position-logs |
| **WellboreLabel** | wellboreLabel | generateWellboreLabel | - position-logs<br/>- wellbore-headers |

## Generator function
A generator function is simply an async function that will have a all the read methods from the `store` interface available in its scope (accessed using the `this` keyword):

```ts
export async function myGeneratorFunction(this: ReadonlyStore, id: string) {
  // get data
  const data = await this.get('data-set', id)

  // use the data to generate geometry or whatever is required by the component

  // return processed data 
}
```
Have a look in the [source code](https://github.com/equinor/videx-3d/tree/main/src/generators) to see examples of how generator functions can be implemented.

Note that if the generators are run in a web worker context, you need to be aware of how data is moved from one thread to another (see [The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)).

As data is serialized and copied when passed across threads, you should take advantage of data types that are [_transferable_](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). This can be done using the [`transfer`](https://github.com/GoogleChromeLabs/comlink?tab=readme-ov-file#comlinktransfervalue-transferables-and-comlinkproxyvalue) function with `comlink` in the return statement:

```ts
return transfer(data, [buffers])
```

## GeneratorRegistry
The `GeneratorRegistry` class is used to inject the generator functions you need in your project. It is a simple key-value store that maps a generator function to a key:

```ts
const registry = new GeneratorRegistry()

// add the generators required
registry.add(basicTrajectory, generateBasicTrajectory)
...

// if you want to run the generators in a web worker, use comlink to expose the
// instance as an endpoint
expose(registry)

```

## GeneratorsProvider
Components access the generator registry with the `useGenerator` hook (see below). This hook uses the context provided by the `GeneratorsProvider`, which must be added as a child of the `DataProvider`:

```tsx
<>
  <DataProvider store={store}>
    <GeneratorsProvider registry={registry}>
      { /* components */ } 
    </GeneratorsProvider>
  </DataProvider>
</>
```

## useGenerator
A component can request a generator function using the React hook `useGenerator<TReturnType>({key})`. This will return an async function that can be used within the component to  invoke the registered generator function.

In typescript, add the return type expected using the generic.