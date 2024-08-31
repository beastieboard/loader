import { UseBoundStore, StoreApi } from 'zustand'



type Listener<T> = (val: T) => void
export type Subscribe<T> = (listener: Listener<T>) => Unsubscribe
type Unsubscribe = () => void

type LoaderParams<T> = {
  id: string
  run: LoaderFunc<T>
  unloadDelayMS?: number
}

// Supports non DOM event interfaces
type Eventable = {
  addEventListener: (type: string, cb: (e: any) => void) => void
  removeEventListener: (type: string, cb: (e: any) => void) => void
}

export type UseApi = {
  <T>(func: LoaderFunc<T>, id: string): Promise<T>
  <T>(loader: ToLoader<T>): Promise<T>
  schedule: (ms: number) => void
  key: (key: any) => void
  zustand: {
    <T>(store: UseBoundStore<StoreApi<T>>): T
    <T,A>(id: string, store: UseBoundStore<StoreApi<T>>, selector: (val: T) => A): A
  }
  subscribe: {
    <T>(id: string, subscribe: Subscribe<T>): T,
    <T, A>(id: string, subscribe: Subscribe<T>, selector: (val: T) => A): A
  },
  cleanup: (cleanup: () => void) => void
  //memo: {
  //  <T>(func: NamedLoaderFunc<T>): Promise<T>
  //  <T>(id: string, func: LoaderFunc<T>): Promise<T>
  //  <T,A>(id: string, func: LoaderFunc<T>, selector: (val: T) => A): Promise<A>
  //}
  event: {
    <T extends Event>(elem: Eventable, eventKey: string): T | undefined
    //<T extends Event, O>(elem: Eventable, eventKey: string, selector: (event: T) => O): O
  }
}


type ToLoader<T> = LoaderParams<T> | Loader<T>

const useOnce: UseApi = async (...args: any[]) => {
  let loader = args.length == 2 ? new Loader({ id: args[1], run: args[0] }) : Loader.from(args[0])
  return await loader.once()
}
useOnce.schedule = () => {}
useOnce.key = () => {}
useOnce.zustand = (store: any) => store.getState()
useOnce.subscribe = () => undefined
useOnce.cleanup = () => {}
useOnce.event = () => undefined


export type LoaderFunc<T> = (use: UseApi, prev: T | undefined) => Promise<T>
export type NamedLoaderFunc<T> = (use: UseApi, prev: T) => Promise<T>

export const loaderCache: { [id: string]: Loader<any> } = {}

type Subscription = {
  listener: (val: any) => void
  unsub: Unsubscribe
  last: { val: any } | undefined
  defer: boolean
}


type GoMode = (
  "CACHED"  | // Return cached value or run for first time
  "TRIGGER"   // Run again but don't pull dependencies
)


export class Loader<T> implements Loader<T> {

  /*
   * If this is working it should probably be left alone!
   */

  readonly id: string
  private nextSubId = 0
  private last: { val: T, cacheKey: any } | undefined
  private subscribers: { [id: string]: Listener<T> } = {}
  private request: Promise<T> | undefined
  private subscriptions: { [id: string]: Subscription } = {}
  private runTimeout: any
  private unloadTimeout: any
  private unloadDelayMS: number
  private cleanup: (() => void)[] = []

  readonly run: LoaderFunc<T>

  constructor(params: LoaderParams<T>) {

    this.id = params.id
    this.run = params.run

    this.unloadDelayMS = params.unloadDelayMS || 0

    for (let name of ['go', 'subscribe', 'getState'] as const) {
      let method = this[name] as any
      ;(this as any)[name] = (...args: any[]) => {
        let that = loaderCache[this.id] || this
        return method.apply(that, args)
      }
    }
  }

  subscribe(listener: Listener<T>, reason=""): Unsubscribe {

    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout)
      this.unloadTimeout = null
    }

    let subId = this.nextSubId++
    this.subscribers[subId] = listener

    if (!loaderCache[this.id]) {
      loaderCache[this.id] = this
    }

    this.go("CACHED", `subscribe() (start process) by ${reason}`)

    return () => {
      delete this.subscribers[subId]
      this.checkStop()
    }
  }

  getState(): T | undefined {
    return this.last?.val
  }

  async once(): Promise<T | undefined> {
    return await this.run(useOnce, this.getState())
  }

  async trigger(): Promise<T> {
    return await this.go("TRIGGER")
  }

  async go(mode: GoMode = "CACHED", _reason=""): Promise<T> {

    if (!loaderCache[this.id]) {
      loaderCache[this.id] = this
    }

    /*
     * Happy path
     */
    if (mode != "TRIGGER" && this.last) {
      return this.last.val
    }


    /*
     * Piggyback?
     */
    if (this.request) {
      // If already running, just wait for the result of the active request
      let val = await this.request

      if (mode != "TRIGGER") {
        return val
      }

      // If trigger and there is a request, it's likely not the same request as before,
      // which means that another run has started since we were triggered. Piggyback
      // onto it.
      if (this.request) {
        return await this.request
      }
    }

    // Sanity?
    if (this.request) throw "already have request"

    // MAKE time
    clearTimeout(this.runTimeout)
    this.runTimeout = null

    // We need to do a funny little dance here; If we assign `this.request = await this._go()`,
    // it can cause a loop if a bunch of sync calls trigger again before this.request
    // is actually assigned (because for it to be assigned, something has to yield).
    // So, use an intermediary promise:
    let { resolve, reject, p } = makeLater()
    this.request = p

    let guts = this.#guts()

    let val: any
    try {
      while (this.cleanup.length) {
        (this.cleanup as any).pop()()
      }
      val = await this.run(guts.use, this.getState())
    } catch (e) {
      reject(e)
      throw e
    } finally {
      this.request = undefined
    }

    resolve(val)
    guts.propagate(val)

    return val
  }

  #guts() {

    let unusedDeps = new Set(Object.keys(this.subscriptions))
    let subscribeCalls = new Set()
    let schedule: number = 0
    let cacheKey: any

    const checkSubscribe = <B>(
      id: string | any[],
      subscribable: Pick<Loader<B>, 'subscribe'>,
      selector: ((val: B) => any) | undefined,
      defer=false
    ) => {

      if (Array.isArray(id)) {
        id = JSON.stringify(id.map(objectId))
      }

      if (this.subscriptions[id]) {
        unusedDeps.delete(id)
      } else {

        if (subscribeCalls.has(id)) {
          throw `Loader(${this.id}) duplicate subscriber: ${id}`
        }
        subscribeCalls.add(id)

        if (selector && typeof selector != 'function') {
          console.log('selector is weird', this.id, id, selector)
        }

        let sub = this.subscriptions[id] = {
          listener: undefined,
          last: undefined,
          unsub: undefined,
          defer
        } as any

        sub.listener = (val: B) => {
          val = selector ? selector(val) : val
          let isUpdated = !shallowCompare(val, sub.last?.val)
          sub.last = { val } // shallowCopy(val)

          if (isUpdated && !sub.defer) {
            this.go("TRIGGER", `new input from ${id}`)
          }

          sub.defer = false
        }

        Object.defineProperty(sub.listener, "name", { value: `Loader:${this.id}` });

        // first update the key before calling subscribe so we can cache the result
        sub.unsub = subscribable.subscribe(sub.listener, this.id)
      }

      return this.subscriptions[id]
    }
    
    const use: UseApi = async (...args: any) => {

      let loader: Loader<any>

      if (args.length == 2) {
        let id = `${this.id}/${args[1]}`
        loader = new Loader({ id, run: args[0] })
      } else {
        loader = Loader.from(args[0])
      }

      let sub = checkSubscribe(loader.id, loader, undefined, true)
      let out = await loader.go()
      if (sub.defer) sub.listener(out) // prime
      return out
    }

    use.schedule = (ms) => { schedule = ms }

    use.key = (k: any) => { cacheKey = k }

    use.zustand = (...args: any[]) => {
      let [id, store, selector] = args
      if (args.length == 1) {
        store = args[0]
        id = `!zustand-${_objectId(store)}`
      }
      checkSubscribe(id, store, selector)
      let state = store.getState()
      return selector ? selector(state) : state
    }

    use.subscribe = (id: string, subscribe: any, selector?: any) => {
      id = `!subscribe-${id}`
      return checkSubscribe(id, { subscribe }, selector).last?.val
    }

    use.cleanup = (cleanup) => this.cleanup.push(cleanup)

    use.event = (elem, type) => (
      use.subscribe(`${objectId(elem)}-${type}`, eventSubscriber(elem, type))
    )
    

    let propagate = (val: T) => {

      if (cacheKey === undefined) {
        cacheKey = val
      }

      // Dispatch subscribers
      if (!this.last || !shallowCompare(cacheKey, this.last.cacheKey)) {
        this.last = { val, cacheKey }
        for (let k in this.subscribers) {
          this.subscribers[k](val)
        }
      }

      // Unsubscribe from unused
      for (let id of unusedDeps) {
        if (this.subscriptions[id]) {
          this.subscriptions[id].unsub()
          delete this.subscriptions[id]
        }
      }

      // Schedule
      if (schedule && !isEmptyObject(this.subscribers)) {
        this.runTimeout = setTimeout(() => this.go("TRIGGER", 'scheduled'), schedule)
      }

      this.checkStop()
    }

    return { unusedDeps, subscribeCalls, schedule, cacheKey, propagate, use }
  }

  checkStop() {

    if (!isEmptyObject(this.subscribers)) {
      return
    }

    let unload = () => {
      if (isEmptyObject(this.subscribers) && !this.request) {
        while (this.cleanup.length) {
          (this.cleanup as any).pop()()
        }
        delete loaderCache[this.id]
        for (let [k, v] of Object.entries(this.subscriptions)) {
          delete this.subscriptions[k]
          v.unsub()
        }
        this.subscriptions = {}
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

  static from<A>(arg: ToLoader<A>) {
    return arg instanceof Loader ? arg : new Loader(arg)
  }
}


import {isEmptyObject, makeLater} from './utils'


const randomLoaderID = () => `anon-${Math.random()}`

import * as React from 'react'

export const useLoader = (() => {
  //let React: any = undefined
  //try {
  //  React = require('react')
  //} catch {
  //}
  return function useLoader<T>(arg: ToLoader<T> | LoaderFunc<T>): T | undefined {
    if (typeof arg == 'function') {
      arg = React.useMemo(() => ({ id: randomLoaderID(), run: arg } as LoaderParams<T>), [])
    }
    let loader = arg instanceof Loader ? arg : new Loader(arg as any)

    // we wrap the object in an array so that React doesn't mistake it for something it's not
    let [r, setR] = React.useState(() => [loader.getState()])

    React.useEffect(() => {
      if (r !== loader.getState()) {
        setR([loader.getState()])
      }
      return loader.subscribe((r) => setR([r]))
    }, [loader.id])

    return r[0] as any
  }
})()


export async function runLoader<T>(arg: ToLoader<T> | LoaderFunc<T>) {
  if (typeof arg == 'function') {
    arg = { id: randomLoaderID(), run: arg }
  }
  let loader = arg instanceof Loader ? arg : new Loader(arg)

  return await new Promise<T>((resolve) => {
    let unsub = loader.subscribe((r) => {
      unsub()
      resolve(r)
    })
  })
}


/*
 * Compare to check if should propagate
 */
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

/*
 * Copy to ensure changes to mutable objects arent missed
 */
export function shallowCopy(val: any) {
  if (typeof val != 'object') {
    return val
  }

  if (Array.isArray(val)) {
    return val.slice(0)
  }

  return {...val}
}


/*
 * Utility function for an addEventListener interface, i.e.:
 *
 * use.subscribe('resize', eventSubscriber(window, 'resize'))
 */
function eventSubscriber<T>(
  target: Eventable,
  type: string
): Subscribe<T> {
  return (listener: any) => {
    target.addEventListener(type, listener)
    return () => target.removeEventListener(type, listener)
  }
}

const _objectId = (() => {
  let currentId = 0;
  const map = new WeakMap();
  return (obj: any) => {
    if (!map.has(obj)) {
      map.set(obj, currentId++)
    }
    return map.get(obj)
  }
})()
const objectId = (obj: any) => {
  if (typeof obj != 'object' && typeof obj != 'function') {
    return String(obj)
  }

  return String(_objectId(obj))
}

export const anyLoader = new Loader<any>({ id: "void", async run() {} })
