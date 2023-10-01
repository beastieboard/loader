
import { describe, expect, test } from 'vitest'

import { Loader, loaderCache, shallowCompare } from '../src'
import { create } from 'zustand'
import {sleep} from '@/Utils'


function loaderTest(name: string, testFunc: () => Promise<void>) {
  return test(name, async () => {
    for (let k in loaderCache) {
      loaderCache[k].checkStop()
      delete loaderCache[k]
    }
    return testFunc()
  })
}


function L<T>(id: string, run: any) {
  return new Loader<T>({ id, run })
}

describe('loader', () => {
  loaderTest('basics', async () => {

    let loader = L<number>('test', async () => 10)
    let ran = 0
    loader.subscribe((v) => { ran = v })

    expect(await loader.go()).toEqual(10)
    expect(ran).toEqual(10)
  })

  loaderTest('multi', async () => {

    let loader0 = L<number>('test0', async () => 10)
    let loader1 = L<number>('test1', async (use) => await use(loader0) + 1)
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

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('1,1')

    await loader1.preload()
    expect([runs0, runs1].join(',')).toEqual('2,2')

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('2,2')

    loader1.checkStop()

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('3,3')

    let unsub = loader1.subscribe(async () => {})

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('4,4')

    await loader1.go()
    expect([runs0, runs1].join(',')).toEqual('4,4')

    unsub()

    await loader1.preload()
    expect([runs0, runs1].join(',')).toEqual('5,5')

    await loader1.trigger()
    expect([runs0, runs1].join(',')).toEqual('5,6')

    await loader0.trigger()
    await sleep(50) // sleep just in case
    expect([runs0, runs1].join(',')).toEqual('6,6')
  })

  loaderTest('cacheing', async () => {

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

    await loader1.preload()
    expect([runs0, runs1].join(',')).toEqual('1,1')

    await loader0.trigger()
    expect([runs0, runs1].join(',')).toEqual('2,1')

    out0++
    await loader0.trigger()
    await sleep(10)
    expect([runs0, runs1].join(',')).toEqual('3,2')
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
