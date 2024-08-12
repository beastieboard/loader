export function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
export function isEmptyObject(obj) {
    for (let k in obj) {
        if (obj.hasOwnProperty(k))
            return false;
    }
    return true;
}
export function makeLater() {
    let resolve, reject;
    let p = new Promise((_res, _rej) => {
        resolve = _res;
        reject = _rej;
    });
    return { p, resolve, reject };
}
