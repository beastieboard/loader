"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Loader_instances, _a, _Loader_guts;
Object.defineProperty(exports, "__esModule", { value: true });
exports.anyLoader = exports.eventSubscriber = exports.shallowCopy = exports.shallowCompare = exports.runLoader = exports.useLoader = exports.Loader = exports.loaderCache = void 0;
const useOnce = async (...args) => {
    let loader = args.length == 2 ? new Loader({ id: args[1], run: args[0] }) : Loader.from(args[0]);
    return await loader.once();
};
useOnce.schedule = () => { };
useOnce.key = () => { };
useOnce.zustand = (store) => store.getState();
useOnce.subscribe = () => undefined;
useOnce.cleanup = () => { };
exports.loaderCache = {};
class Loader {
    constructor(params) {
        _Loader_instances.add(this);
        this.nextSubId = 0;
        this.subscribers = {};
        this.subscriptions = {};
        this.cleanup = [];
        this.id = params.id;
        this.run = params.run;
        this.unloadDelayMS = params.unloadDelayMS || 0;
        for (let name of ['go', 'subscribe', 'getState']) {
            let method = this[name];
            this[name] = (...args) => {
                let that = exports.loaderCache[this.id] || this;
                return method.apply(that, args);
            };
        }
    }
    subscribe(listener, reason = "") {
        if (this.unloadTimeout) {
            clearTimeout(this.unloadTimeout);
            this.unloadTimeout = null;
        }
        let subId = this.nextSubId++;
        this.subscribers[subId] = listener;
        if (!exports.loaderCache[this.id]) {
            exports.loaderCache[this.id] = this;
        }
        this.go("CACHED", `subscribe() (start process) by ${reason}`);
        return () => {
            delete this.subscribers[subId];
            this.checkStop();
        };
    }
    getState() {
        return this.last?.val;
    }
    async once() {
        return await this.run(useOnce, this.getState());
    }
    async trigger() {
        return await this.go("TRIGGER");
    }
    async go(mode = "CACHED", _reason = "") {
        if (!exports.loaderCache[this.id]) {
            exports.loaderCache[this.id] = this;
        }
        /*
         * Happy path
         */
        if (mode != "TRIGGER" && this.last) {
            return this.last.val;
        }
        /*
         * Piggyback?
         */
        if (this.request) {
            // If already running, just wait for the result of the active request
            let val = await this.request;
            if (mode != "TRIGGER") {
                return val;
            }
            // If trigger and there is a request, it's likely not the same request as before,
            // which means that another run has started since we were triggered. Piggyback
            // onto it.
            if (this.request) {
                return await this.request;
            }
        }
        // Sanity?
        if (this.request)
            throw "already have request";
        // MAKE time
        clearTimeout(this.runTimeout);
        this.runTimeout = null;
        // We need to do a funny little dance here; If we assign `this.request = await this._go()`,
        // it can cause a loop if a bunch of sync calls trigger again before this.request
        // is actually assigned (because for it to be assigned, something has to yield).
        // So, use an intermediary promise:
        let { resolve, reject, p } = makeLater();
        this.request = p;
        let guts = __classPrivateFieldGet(this, _Loader_instances, "m", _Loader_guts).call(this);
        let val;
        try {
            while (this.cleanup.length) {
                this.cleanup.pop()();
            }
            val = await this.run(guts.use, this.getState());
        }
        catch (e) {
            reject(e);
            throw e;
        }
        finally {
            this.request = undefined;
        }
        resolve(val);
        guts.propagate(val);
        return val;
    }
    checkStop() {
        if (!(0, utils_1.isEmptyObject)(this.subscribers)) {
            return;
        }
        let unload = () => {
            if ((0, utils_1.isEmptyObject)(this.subscribers) && !this.request) {
                while (this.cleanup.length) {
                    this.cleanup.pop()();
                }
                delete exports.loaderCache[this.id];
                for (let [k, v] of Object.entries(this.subscriptions)) {
                    delete this.subscriptions[k];
                    v.unsub();
                }
                this.subscriptions = {};
                this.last = undefined;
            }
        };
        if (this.unloadDelayMS) {
            if (!this.unloadTimeout) {
                this.unloadTimeout = setTimeout(unload, this.unloadDelayMS);
            }
        }
        else {
            unload();
        }
    }
    static from(arg) {
        return arg instanceof _a ? arg : new _a(arg);
    }
}
exports.Loader = Loader;
_a = Loader, _Loader_instances = new WeakSet(), _Loader_guts = function _Loader_guts() {
    let unusedDeps = new Set(Object.keys(this.subscriptions));
    let subscribeCalls = new Set();
    let schedule = 0;
    let cacheKey;
    const checkSubscribe = (id, subscribable, selector, defer = false) => {
        if (Array.isArray(id)) {
            id = JSON.stringify(id.map(objectId));
        }
        if (this.subscriptions[id]) {
            unusedDeps.delete(id);
        }
        else {
            if (subscribeCalls.has(id)) {
                throw `Loader(${this.id}) duplicate subscriber: ${id}`;
            }
            subscribeCalls.add(id);
            if (selector && typeof selector != 'function') {
                console.log('selector is weird', this.id, id, selector);
            }
            let sub = this.subscriptions[id] = {
                listener: undefined,
                last: undefined,
                unsub: undefined,
                defer
            };
            sub.listener = (val) => {
                val = selector ? selector(val) : val;
                let isUpdated = !shallowCompare(val, sub.last?.val);
                sub.last = { val }; // shallowCopy(val)
                if (isUpdated && !sub.defer) {
                    this.go("TRIGGER", `new input from ${id}`);
                }
                sub.defer = false;
            };
            Object.defineProperty(sub.listener, "name", { value: `Loader:${this.id}` });
            // first update the key before calling subscribe so we can cache the result
            sub.unsub = subscribable.subscribe(sub.listener, this.id);
        }
        return this.subscriptions[id];
    };
    const use = async (...args) => {
        let loader;
        if (args.length == 2) {
            let id = `!loader-${args[1]}`;
            loader = new _a({ id, run: args[0] });
        }
        else {
            loader = _a.from(args[0]);
        }
        let sub = checkSubscribe(loader.id, loader, undefined, true);
        let out = await loader.go();
        if (sub.defer)
            sub.listener(out); // prime
        return out;
    };
    use.schedule = (ms) => { schedule = ms; };
    use.key = (k) => { cacheKey = k; };
    use.zustand = (...args) => {
        let [id, store, selector] = args;
        if (args.length == 1) {
            store = args[0];
            id = `!zustand-${_objectId(store)}`;
        }
        checkSubscribe(id, store, selector);
        let state = store.getState();
        return selector ? selector(state) : state;
    };
    use.subscribe = (id, subscribe, selector) => {
        id = `!subscribe-${id}`;
        return checkSubscribe(id, { subscribe }, selector).last?.val;
    };
    use.cleanup = (cleanup) => this.cleanup.push(cleanup);
    //use.eventListener = (target: Eventable, eventKey: string, selector?: any) => {
    //  return use.subscribe(
    //    `${objectId(target)}-${eventKey}`,
    //    (listener) => {
    //      target.addEventListener(eventKey, listener)
    //      return () => target.removeEventListener(eventKey, listener)
    //    },
    //    selector
    //  ) as any
    //}
    //
    let propagate = (val) => {
        if (cacheKey === undefined) {
            cacheKey = val;
        }
        // Dispatch subscribers
        if (!this.last || !shallowCompare(cacheKey, this.last.cacheKey)) {
            this.last = { val, cacheKey };
            for (let k in this.subscribers) {
                this.subscribers[k](val);
            }
        }
        // Unsubscribe from unused
        for (let id of unusedDeps) {
            if (this.subscriptions[id]) {
                this.subscriptions[id].unsub();
                delete this.subscriptions[id];
            }
        }
        // Schedule
        if (schedule && !(0, utils_1.isEmptyObject)(this.subscribers)) {
            this.runTimeout = setTimeout(() => this.go("TRIGGER", 'scheduled'), schedule);
        }
        this.checkStop();
    };
    return { unusedDeps, subscribeCalls, schedule, cacheKey, propagate, use };
};
const react_1 = require("react");
const utils_1 = require("./utils");
const randomLoaderID = () => `loader-${Math.random()}`;
function useLoader(arg) {
    if (typeof arg == 'function') {
        arg = (0, react_1.useMemo)(() => ({ id: randomLoaderID(), run: arg }), []);
    }
    let loader = arg instanceof Loader ? arg : new Loader(arg);
    // we wrap the object in an array so that React doesn't mistake it for something it's not
    let [r, setR] = (0, react_1.useState)(() => [loader.getState()]);
    (0, react_1.useEffect)(() => {
        if (r !== loader.getState()) {
            setR([loader.getState()]);
        }
        return loader.subscribe((r) => setR([r]));
    }, [loader.id]);
    return r[0];
}
exports.useLoader = useLoader;
async function runLoader(arg) {
    if (typeof arg == 'function') {
        arg = { id: randomLoaderID(), run: arg };
    }
    let loader = arg instanceof Loader ? arg : new Loader(arg);
    return await new Promise((resolve) => {
        let unsub = loader.subscribe((r) => {
            unsub();
            resolve(r);
        });
    });
}
exports.runLoader = runLoader;
function makeLater() {
    let resolve, reject;
    let p = new Promise((_res, _rej) => {
        resolve = _res;
        reject = _rej;
    });
    return { p, resolve, reject };
}
/*
 * Compare to check if should propagate
 */
function shallowCompare(prev, obj) {
    if (prev === obj)
        return true;
    if (typeof obj != 'object' || typeof prev != 'object')
        return false;
    if (Array.isArray(obj)) {
        return prev.length == obj.length && obj.every((val, idx) => val === prev[idx]);
    }
    if (Object.keys(obj).length != Object.keys(prev).length)
        return false;
    for (let k in obj)
        if (obj[k] !== prev[k])
            return false;
    return true;
}
exports.shallowCompare = shallowCompare;
/*
 * Copy to ensure changes to mutable objects arent missed
 */
function shallowCopy(val) {
    if (typeof val != 'object') {
        return val;
    }
    if (Array.isArray(val)) {
        return val.slice(0);
    }
    return { ...val };
}
exports.shallowCopy = shallowCopy;
/*
 * Utility function for an addEventListener interface, i.e.:
 *
 * use.subscribe('resize', eventSubscriber(window, 'resize'))
 */
function eventSubscriber(target, type) {
    return (listener) => {
        target.addEventListener(type, listener);
        return () => target.removeEventListener(type, listener);
    };
}
exports.eventSubscriber = eventSubscriber;
const _objectId = (() => {
    let currentId = 0;
    const map = new WeakMap();
    return (obj) => {
        if (!map.has(obj)) {
            map.set(obj, currentId++);
        }
        return map.get(obj);
    };
})();
const objectId = (obj) => {
    if (typeof obj != 'object' && typeof obj != 'function') {
        return String(obj);
    }
    return String(_objectId(obj));
};
exports.anyLoader = new Loader({ id: "void", async run() { } });
