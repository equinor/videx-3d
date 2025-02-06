import { Object3D, Scene } from 'three'

export function getObjectByCustomProperty(propName: string, value: any, scene: Scene) {
  const traverse = (obj: Object3D) : Object3D | null => {
    if (obj.userData[propName] && obj.userData[propName] === value) {
      return obj
    }

    if (obj.children && obj.children.length) {
      for (let i = 0; i < obj.children.length; i++) {
        const found = traverse(obj.children[i])
        if (found) {
          return found
        }
      }
    }

    return null
  }

  return traverse(scene)
}