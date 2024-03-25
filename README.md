

# Loader

"Loader" is a data & resource loading event pipeline, built to complement React.

It provides Loaders, which are like React functions for loading data:

* They are **async** functions instead of sync.
* Like React functions, they perform automatic event subscription when called recursively, however:
* They are indexed on a provided ID rather than the order of calls, and;
* They are deduplicated globally based on this ID, so resources are only loaded once.

So, they are designed for loading complex resources in the most efficient way, and provide fine grained control while reducing boilerplate and bugs.

In many cases, they are a more adaptable alternative to useState and friends.

## Basics

```typescript
/*
 * This is a loader factory, ie, its a function that returns a parameterized loader.
 */
function uriLoader(uri: string) {
  return new Loader({

    /*
     * Loaders automatically deduplicate based on ID (parameters),
     * so resources wont get loaded many times.
     */
    id: `uri-${uri}`,

    /*
     * The run function loads resources and may call other loaders.
     */
    async run(use) {

      // Load your resource uri
      const b = await fetch(uri)

      // Call another loader; may return a cached value
      const a = await use(someOtherLoader)

      return { a, b }
    }
  })
}
```

## Listen to an event

```typescript
const windowSizeLoader = new Loader({                                           
  id: 'windowSize',                                                          
  async run(use) {
    /*
     * We can easily write a loader that returns the window size and triggers when it changes
     *
     * This call does not wait for the event to trigger, it will return undefined
     * if it has never been triggered. However, it will trigger this loader when the event
     * is triggered.
     *
     * The first argument is a (local) ID for the subscription.
     */
    let _ = use.eventListener('windowSize', window, 'resize')

    return {
      w: window.innerWidth,
      h: window.innerHeight
    }
  }                                                                                 
})                                                                                  
```

## Using in React

```typescript
// React component
function MyComponent() {

  let data = useLoader(uriLoader("/api/someResource"))

  // Etc
}
```
