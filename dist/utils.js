"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmptyObject = exports.sleep = void 0;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
exports.sleep = sleep;
function isEmptyObject(obj) {
    for (let k in obj) {
        if (obj.hasOwnProperty(k))
            return false;
    }
    return true;
}
exports.isEmptyObject = isEmptyObject;
