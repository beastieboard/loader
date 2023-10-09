

# Loader

## Example Usage

```typescript

// Loader factory
function myUriLoader(uri: string) {
  return new Loader({
    id: `uri-${uri}`,
    async run() {
      return await fetch(uri)
    }
  })
}

// React component
function MyComponent() {
  let data = useLoader(myUriLoader("/api/someResource"))

  if (data) {
    return <>`got data: ${data}`</>
  }
}
```

## What is special about this?

In the example above, if 2 loaders are created (for example in different React components) with the same ID, then the request is only loaded once.

Also, loaders can subscribe to each other using the `use` function (passed to the run method), so you can make a tree of async loader subscriptions.
