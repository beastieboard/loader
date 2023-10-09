

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
