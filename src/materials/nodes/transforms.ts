import { cos, Fn, oneMinus, sin, vec3 } from 'three/tsl'
import { Node } from 'three/webgpu'

export const rotateVec3 = /*@__PURE__*/ Fn<Node>(([v, a, angle]) => {
  const c = cos(angle)
  const s = sin(angle)
  const t = oneMinus(c)
  const tx = t.mul(a.x)
  const ty = t.mul(a.y)

  return vec3(
    tx
      .mul(a.x)
      .add(c)
      .mul(v.x)
      .add(tx.mul(a.y).sub(s.mul(a.z)).mul(v.y))
      .add(tx.mul(a.z).add(s.mul(a.y)).mul(v.z)),
    tx
      .mul(a.y)
      .add(s.mul(a.z))
      .mul(v.x)
      .add(ty.mul(a.y).add(c).mul(v.y))
      .add(ty.mul(a.z).sub(s.mul(a.x)).mul(v.z)),
    tx
      .mul(a.z)
      .sub(s.mul(a.y))
      .mul(v.x)
      .add(ty.mul(a.z).add(s.mul(a.x)).mul(v.y))
      .add(t.mul(a.z).mul(a.z).add(c).mul(v.z)),
  )
})
