
import { describe, expect, test } from 'vitest'
import { create } from 'zustand'

import { Loader, loaderCache, shallowCompare, shallowCopy } from '../src'
import {LoaderFunc} from '../src'
import {sleep} from '../src/utils'


function loaderTest(name: string, testFunc: () => Promise<void>) {
  return test(name, async () => {
    for (let k in loaderCache) {
      loaderCache[k].checkStop()
      delete loaderCache[k]
    }
    return testFunc()
  })
}


function L<T>(id: string, run: LoaderFunc<T>) {
  return new Loader<T>({ id, run })
}

describe('loader', () => {
  loaderTest('basics', async () => {

    let loader = L('test', async () => 10)
    let ran = 0
    loader.subscribe((v) => { ran = v })

    expect(await loader.go()).toEqual(10)
    expect(ran).toEqual(10)
  })

  loaderTest('multi', async () => {

    let loader0 = L('test0', async () => 10)
    //expect(await loader0.go()).toEqual(10)

    let loader1 = L('test1', async (use) => await use(loader0) + 1)
    expect(await loader1.go()).toEqual(11)
  })

  loaderTest('race1', async () => {

    // This tests a subtle race condition where subscriptions are wiped while execution
    // is ongoing, causing an inconsistency in the subscriber diff

    let store = create(() => true)

    let loader1 = L(
      'test1',
      async (use) => store.getState() && use.zustand(store)
    )

    let unsub = loader1.subscribe(() => {})
    await loader1.go()

    store.setState(false)
    unsub()
    await loader1.go()
  })

  loaderTest('runOnce', async () => {
    let runs0 = 0, runs1 = 0

    let loader0 = L('test0', async () => { runs0++ })
    let loader1 = L('test1', async (use) => { await use(loader0); runs1++ })

    await loader1.go()

    expect(runs0).toBe(1)
    expect(runs1).toBe(1)
  })

  loaderTest('stopAndRestart', async () => {

    let runs0 = 0, runs1 = 0

    let loader0 = L('test0', async () => { runs0++ })
    let loader1 = L('test1', async (use) => { await use(loader0); ++runs1 })

    //loader1.subscribe(() => {}) // so it doesnt unload
    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('1,1')

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('2,2')

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('3,3')

    let unsub = loader1.subscribe(async () => {})

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('4,4')

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('4,4')

    await loader1.trigger()
    expect([runs0, runs1].join(',')).toEqual('4,5')

    await loader0.trigger()
    expect([runs0, runs1].join(',')).toEqual('5,5')

    unsub()

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('6,6')
  })

  loaderTest('caching', async () => {

    let runs0 = 0, runs1 = 0
    let out0 = 0, out1 = 0

    let loader0 = L(
      'test0',
      async () => { runs0++; return out0 }
    )
    let loader1 = L(
      'test1',
      async (use) => { await use(loader0); ++runs1; return out1 }
    )

    loader1.subscribe(() => {}) // so loader 1 doesnt unload
    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('1,1')

    await loader0.trigger()
    expect([runs0, runs1].join(',')).toEqual('2,1')

    out0++
    await loader0.trigger()
    await sleep(10)
    expect([runs0, runs1].join(',')).toEqual('3,2')
  })

  loaderTest('subscriber returns latest event', async () => {

    let store = create(() => 1)
    let received: any = []

    let loader = L(
      'test0',
      async (use) => {
        let o = use.subscribe('store', (cb) => store.subscribe(cb))
        received.push(o)
      }
    )

    loader.subscribe(() => {}) // so loader 1 doesnt unload

    store.setState(2, true)
    await sleep(10)
    store.setState(3, true)
    await sleep(10)

    expect(received).toEqual([undefined, 2, 3])
  })

  //loaderTest('return changed mutable object triggers', async () => {

  //  /*
  //   * Some event handlers will return the same mutated object each time.
  //   * Loader should make a shallow copy each time so it can detect changes.
  //   */

  //  let received = []

  //  let _callback: any

  //  let loader = L(
  //    'test0',
  //    async (use) => {
  //      let o = use.subscribe('store', (cb) => { _callback = cb; return () => {} })
  //      received.push(o)
  //    }
  //  )

  //  loader.subscribe(() => {}) // so loader 1 doesnt unload

  //  let o = {}

  //  _callback(o)
  //  await sleep(10)

  //  o['a'] = 1
  //  _callback(o)
  //  await sleep(10)

  //  expect(received).toEqual([undefined, {}, {a: 1}])
  //})

  loaderTest('retriggering handled correctly', async () => {

    /*
     * This tests the case that a child subscription triggers another
     * child subscription to make sure they don't go around and around
     * in some horrible loop
     */

    let nextKey = 0
    let callbacks: any = {}

    let dep = L(
      "DEP",
      async (use) => {
        let o: number = use.subscribe('abc', (listener) => {
          callbacks[nextKey++] = listener
          return () => { }
        }) || 0

        use(
          async () => { callbacks[0](o + 1) },
          "foo"
        )

        return o
      }
    )

    let leafCalls = 0

    let leaf = L(
      'LEAF',
      async (use) => {
        leafCalls++
        return await use(dep)
      }
    )

    leaf.subscribe(() => {})
    await sleep(10)
    expect(nextKey).toEqual(1) // one subscription
    expect(leaf.getState()).toEqual(1)
    expect(leafCalls).toEqual(2)
    expect(dep.getState()).toEqual(1)
  })

  loaderTest('sub unsub while running', async () => {

    let later = makeLater()

    let loader0 = L(
      'test0',
      async () => { await later.p }
    )

    let leaf = L(
      'LEAF',
      async (use) => {
        await use(loader0)
      }
    )

    let unsub = leaf.subscribe(() => {})
    unsub()


    unsub = leaf.subscribe(() => {})
    expect(leaf['subscriptions']).toHaveProperty('test0')

    later.resolve()
    unsub()
    await sleep(10)

    expect(leaf['subscriptions']).toEqual({})
  })

  loaderTest('sub to loaded loader invalid defer state', async () => {

    let i = 0
    let loader0 = L(
      'test0',
      async () => ++i
    )

    loader0.subscribe(() => {})
    await loader0.go()
    expect(loader0.getState()).toEqual(1)

    let leaf = L(
      'LEAF',
      async (use) => await use(loader0)
    )

    leaf.subscribe(() => {})
    await leaf.go()
    expect(loader0.getState()).toEqual(1)
    expect(leaf.getState()).toEqual(1)

    // now there is a problem, the leaf listener to loader has defer true, which means that it
    // wont get triggered

    await loader0.trigger()
    expect(loader0.getState()).toEqual(2)
    await sleep(10)
    expect(leaf.getState()).toEqual(2)
  })

  loaderTest('shallow copy result', async () => {
    //let arr = [1,2,3]

    //let loader = L('test', async (use) => use(async () => arr, ''))
    //loader.subscribe(() => {})
    //let r = await loader.go()
    //
    //expect(r).toEqual(arr)
    //expect(r === arr).toBeFalsy()

  })

  loaderTest('shallowCopy', async () => {

    let test = (v: any) => {
      let r = shallowCopy(v)
      expect(v).toEqual(r)
    }

    test(1)
    test('abc')
    test(1n)
    test({})
    test({a: 1})
    test([1,2,3])
  })

  loaderTest('shallowCompare', async () => {

    expect(shallowCompare(1, 1)).toBeTruthy()
    expect(shallowCompare(1, 0)).toBeFalsy()

    expect(shallowCompare(false, true)).toBeFalsy()

    expect(shallowCompare([1], [1])).toBeTruthy()
    expect(shallowCompare([1], [1, 1])).toBeFalsy()

    expect(shallowCompare([{}], [{}])).toBeFalsy()
    expect(shallowCompare({}, {})).toBeTruthy()

    expect(shallowCompare({a:1}, {a:1})).toBeTruthy()
    expect(shallowCompare({a:2}, {a:1})).toBeFalsy()

    expect(shallowCompare({a:{}}, {a:{}})).toBeFalsy()
  })
})



function makeLater<T=any>() {
  let resolve: any, reject: any
  let p = new Promise<T>((_res, _rej) => {
    resolve = _res
    reject = _rej
  })
  return { p, resolve, reject }
}
