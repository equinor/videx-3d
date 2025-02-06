import { useCallback, useContext } from 'react'
import { GeneratorsContext } from '../contexts/GeneratorsContext'

/**
 * Access a generator function from within a component.
 * 
 * @example
 * const generator = useGenerator(generatorKey)
 *
 * @remarks
 * The generator is an async function that process and returns data required
 * by your components, such as geometry for a mesh.
 * 
 * @example
 * 
 * const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
 * 
 * useEffect(() => {
 *   if (generator) {
 *     generator(id).then(response => {
 *       if (response) {
 *         const bufferGeometry = unpackBufferGeometry(response)
 *         setGeometry(prev => {
 *           if (prev) prev.dispose()
 *           return bufferGeometry
 *         })
 *       } else {
 *         setGeometry(null)
 *       }
 *     })
 *   }
 * }, [generator, id])
 * 
 * if (!geometry) return null
 * 
 * return (
 *  <mesh geometry={geometry}>
 *    <meshBasicMaterial />
 *  </mesh>
 * )
 * 
 * @see [Generators](/docs/documents/generators.html)
 * 
 * @group Hooks
 */
export const useGenerator = <T,>(generator: string) => {
  const registry = useContext(GeneratorsContext)
  const callback = useCallback((...args: any[]) => registry!.invoke<T>(generator, ...args), [generator, registry]) as ((...args: any[]) => Promise<T>)

  return registry ? callback : () => Promise.resolve(null)
}