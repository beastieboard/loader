

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}


export function isEmptyObject(obj: Object) {
  for (let k in obj) {                      
    if (obj.hasOwnProperty(k)) return false;
  }                                         
  return true;                              
}                                           

