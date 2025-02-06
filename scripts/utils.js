export function verify(data, ...deps) {
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i]
    if (!data[dep]) {
      throw Error('Missing dependency: ' + dep + '!')
    }
  }
}