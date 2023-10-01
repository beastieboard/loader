import { StoreApi, UseBoundStore, create } from 'zustand'

type Listener<T> = (val: T) => void
type Subscribe<T> = (listener: Listener<T>) => Unsubscribe
type Unsubscribe = () => void


type ZustandStore<T> = UseBoundStore<StoreApi<T>>


export type UseFunc = {
  <T>(load: Loader<T>): Promise<T>
  <T,A>(load: Loader<T>, selector?: (val: T) => A): Promise<A>
  schedule: (ms: number) => void
  key: (key: any) => void
  event: <T>(id: string, subscribe: Subscribe<T>) => T
  zustand: {
    <T>(store: ZustandStore<T>): T
    <T,A>(store: ZustandStore<T>, selector?: (val: T) => A): A
  }
  memo: <T>(id: string, func: LoaderFunc<T>) => Promise<T>
  cleanup: (localId: string, cleanup: Unsubscribe) => void
  loaderCache: (filter: (id: string) => boolean) => typeof loaderCache
}


type ToLoader<T> = [name: string, load: LoaderFunc<T>] | [LoaderParams<T>] | [Loader<T>]

const useOnce: UseFunc = (loader: any) => Loader.from(loader).once()
useOnce.schedule = () => {}
useOnce.key = () => {}
useOnce.event = () => undefined as any
useOnce.zustand = <T>(store: ZustandStore<T>) => "TODO"
useOnce.memo = (_, func) => func(useOnce, undefined as any)
useOnce.cleanup = (_, cleanup) => cleanup()
useOnce.loaderCache = useLoaderCache


type LoaderFunc<T> = (use: UseFunc, prev: T) => Promise<T>

export const loaderCache: { [id: string]: Loader<any> } = {}
if (typeof window != 'undefined' && process.env.NODE_ENV == "development") {
  (window as any).loaderCache = loaderCache
}

export const loaderCacheChanged = create(() => 0)
const triggerLoaderCacheChanged = () => loaderCacheChanged.setState((n) => n+1)

function useLoaderCache(this: UseFunc, filter: (id: string) => boolean) {
  this.zustand(loaderCacheChanged)
  return Object.fromEntries(Object.entries(loaderCache).filter(([k, _]) => filter(k)))
}
 
export type LoaderParams<T> = {
  id: string
  run: LoaderFunc<T>
  unloadDelayMS?: number
}

type Subscription = {
  listener: (val: any) => void
  unsub: Unsubscribe
  last: any
}


type GoMode = (
  "CACHED"  | // Return cached value or run for first time
  "PRELOAD" | // Same as Cached but will schedule even if no listeners
  "TRIGGER"   // Run again but don't pull dependencies
)

export class Loader<T> implements Loader<T> {

  /*
   * This class is literal chainsaw juggling, due to it's degree of concurrency.
   *
   * Continue at your peril.
   */

  readonly id: string
  private nextSubId = 0
  private last: { val: T, cacheKey: any }
  private subscribers: { [id: string]: Listener<T> } = {}
  private request: Promise<{ val: T, schedule: number }>
  private subscriptions: { [id: string]: Subscription } = {}
  private eventLast: { [id: string]: any } = {}
  private runTimeout: any
  private unloadTimeout: any
  private unloadDelayMS: number

  readonly run: LoaderFunc<T>

  constructor(params: LoaderParams<T>) {

    this.id = params.id
    this.run = params.run
    this.unloadDelayMS = params.unloadDelayMS || 0

    for (let name of ['go', 'subscribe', 'getState']) {
      let method = this[name]
      this[name] = (...args: any[]) => {
        let that = loaderCache[this.id] || this
        return method.apply(that, args)
      }
    }
  }

  subscribe(listener: Listener<T>): Unsubscribe {

    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout)
      this.unloadTimeout = null
    }

    let subId = this.nextSubId++
    this.subscribers[subId] = listener

    if (!loaderCache[this.id]) {
      loaderCache[this.id] = this
      triggerLoaderCacheChanged()
    }

    this.go()

    return () => {
      delete this.subscribers[subId]
      this.checkStop()
    }
  }

  getState(): T | undefined {
    return this.last?.val
  }

  async once(): Promise<T> {
    return await this.run(useOnce, this.getState())
  }

  async trigger(): Promise<T> {
    return await this.go("TRIGGER")
  }

  async preload(): Promise<T> {
    return await this.go("PRELOAD")
  }

  async go(mode: GoMode = "CACHED"): Promise<T> {

    if (mode != "TRIGGER" && this.last) {
      return this.last.val
    }

    if (this.request) {
      let val = (await this.request).val
      if (mode == "TRIGGER") {
        if (this.request) {
          return (await this.request).val
        }
      } else {
        return val
      }
    }

    // Clear schedules
    clearTimeout(this.runTimeout)
    this.runTimeout = null

    // Go
    if (this.request) throw "already have request"
    this.request = this._go()
    let { val, schedule } = await this.request
    this.request = null

    // Schedule
    if (schedule && (mode == "PRELOAD" || !isEmptyObject(this.subscribers))) {
      this.runTimeout = window.setTimeout(() => this.go("TRIGGER"), schedule)
    }

    mode == "PRELOAD" || this.checkStop()

    return val
  }

  private async _go(): Promise<{ val: T, schedule: number }> {

    let unusedDeps = new Set(Object.keys(this.subscriptions))
    let schedule: number = 0
    let cacheKey: any

    const checkSubscribe = <B>(
      id: string,
      subscribable: Pick<Loader<B>, 'subscribe'>,
      selector: (val: B) => any,
      out: B
    ) => {
      if (!this.subscriptions[id]) {

        let sub = this.subscriptions[id] = {
          listener: undefined,
          last: undefined,
          unsub: undefined,
        }

        let updated = (val: B) => {
          if (selector && typeof selector != 'function') {
            console.log('selector', this.id, id, selector)
          }
          val = selector ? selector(val) : val
          let isUpdated = !shallowCompare(val, sub.last)
          sub.last = val
          return isUpdated
        }

        sub.listener = (val: B) => {
          if (updated(val)) {
            //console.log(`${id} triggers ${this.id}`)
            this.go("TRIGGER")
          }
        }

        // first update the key before calling subscribe so we can cache the result
        updated(out)
        sub.unsub = subscribable.subscribe(sub.listener)

      } else {
        unusedDeps.delete(id)
      }

      return out
    }

    const use: UseFunc = async <A,B>(loader: Loader<A>, selector?: (val: A) => B) => {
      return checkSubscribe(loader.id, loader, selector, await loader.go("PRELOAD"))
    }

    use.schedule = (ms) => { schedule = ms }

    use.key = (k: any) => { cacheKey = k }

    use.zustand = (store: any, selector?: any) => {
      NotImplemented
    }

    use.cleanup = (id, f: Unsubscribe) => {
      id = `!cleanup-${id}`

      if (unusedDeps[id]) {
        if (this.subscriptions[id]) {
          this.subscriptions[id].unsub()
          delete this.subscriptions[id]
        }
      }

      let subscribe = () => f
      checkSubscribe(id, { subscribe }, null, undefined)
    }

    use.event = (id, subscribeOrig) => {
      id = `!event-${id}`

      let subscribe: Loader<any>['subscribe'] = (listener) => (
        subscribeOrig((val) => {
          if (!Object.hasOwn(this.eventLast, id) || !shallowCompare(this.eventLast[id], val)) {
            this.eventLast[id] = val
            listener(val)
          }
        })
      )

      return checkSubscribe(id, { subscribe }, null, this.eventLast[id])
    }

    use.memo = (id, run) => {
      id = `${this.id}/${id}`
      return use(new Loader({ id, run }))
    }

    use.loaderCache = useLoaderCache

    let val: T
    try {
      val = await this.run(use, this.getState())
    } catch (e) {
      console.log(`Exception in loader "${this.id}":`, e)
      throw e
    }

    if (cacheKey === undefined) {
      cacheKey = val
    }

    if (!this.last || !shallowCompare(cacheKey, this.last.cacheKey)) {
      this.last = { val, cacheKey }
      for (let k in this.subscribers) {
        this.subscribers[k](val)
      }
    }

    for (let id of unusedDeps) {
      if (this.subscriptions[id]) {
        this.subscriptions[id].unsub()
        delete this.subscriptions[id]
        delete this.eventLast[id]
      }
    }

    return { val, schedule }
  }

  checkStop() {

    if (!isEmptyObject(this.subscribers)) {
      return
    }

    let unload = () => {
      if (isEmptyObject(this.subscribers)) {
        delete loaderCache[this.id]
        triggerLoaderCacheChanged()
        Object.values(this.subscriptions).map((s) => s.unsub())
        this.subscriptions = {}
        this.eventLast = {}
        this.last = undefined
      }
    }

    if (this.unloadDelayMS) {
      if (!this.unloadTimeout) {
        this.unloadTimeout = setTimeout(unload, this.unloadDelayMS)
      }
    } else {
      unload()
    }
  }

  static from<A>(...args: ToLoader<A>) {
    if (args.length == 1) {
      if (args[0] instanceof Loader) {
        return args[0]
      } else {
        return new Loader(args[0])
      }
    } else {
      return new Loader({ id: args[0], run: args[1] })
    }
  }
}

function scheduleLoader(timestampMs: number) {
  return new Loader({
    id: `schedule-${timestampMs}`,
    async run(use) {

      let expiresIn = new Date().getTime() - timestampMs

      if (expiresIn <= 0) {
        return true
      }

      use.event('timeout', (f) => {
        let t = setTimeout(f, expiresIn)
        return () => clearTimeout(t)
      })

      return false
    }
  })
}


import { useState, useEffect, useMemo } from 'react'

export function useLoader<T>(arg: Loader<T> | LoaderParams<T>): T {
  let loader = arg instanceof Loader ? arg : new Loader(arg)
  let [r, setR] = useState<T>(() => loader.getState())
  useEffect(() => loader.subscribe(setR), [loader.id])
  return r
}

export function useLoaderFunc<T>(run: LoaderFunc<T>): T {
  let id = useMemo(() => `loader-${Math.random()}`, [])
  return useLoader({ id, run })
}

export function shallowCompare(prev: any, obj: any) {
  if (prev === obj) return true
  if (typeof obj != 'object' || typeof prev != 'object') return false

  if (Array.isArray(obj)) {
    return prev.length == obj.length && obj.every((val, idx) => val === prev[idx])
  }

  if (Object.keys(obj).length != Object.keys(prev).length) return false
  for (let k in obj) if (obj[k] !== prev[k]) return false

  return true
}

const objectId = (() => {
  let currentId = 0;
  const map = new WeakMap();

  return (object: any) => {
    if (!map.has(object)) {
      map.set(object, ++currentId);
    }

    return map.get(object);
  };
})();

export function isEmptyObject(obj: Object) {
  for (let k in obj) {
    if (obj.hasOwnProperty(k)) return false;
  }
  return true;
}
