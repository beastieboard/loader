

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}


export function isEmptyObject(obj: Object) {
  for (let k in obj) {                      
    if (obj.hasOwnProperty(k)) return false;
  }                                         
  return true;                              
}                                           


export function makeLater<T=any>() {
  let resolve: any, reject: any
  let p = new Promise<T>((_res, _rej) => {
    resolve = _res
    reject = _rej
  })
  return { p, resolve, reject }
}
