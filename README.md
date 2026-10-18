# You Might Not Need A useEffectAsync Hook

`asEffect` turns an async function into a `useEffect` callback, `asPromise` turns a callback API into a promise.
Both can be aborted through an `AbortSignal`, and eslint keeps checking your `useEffect` dependencies.

You can read the article on why here: [You Might Not Need A useEffectAsync Hook](https://krassnig.dev/blog/you-might-not-need-a-use-effect-async-hook).

## How To Install

```
npm install no-async-hook
```

Any other package manager works too, or just copy the code manually.

## Agent Instructions

The doc comments in `no-async-hook.js` and `no-async-hook.d.ts` show the correct patterns as examples, so coding agents reading them pick up the right usage.

## asEffect

The `asEffect` function allows you to write a normal async function and converts that async function into a function that can be passed to `useEffect`.
Simply add `() => asEffect(async signal => { /* your code */ })` to your `useEffect` and use async/await functions.

```tsx
import { asEffect } from "no-async-hook";
import { useEffect, useState } from "react";

function Person({ personId }: { personId: number }) {
    const [name, setName] = useState<string | undefined>(undefined);

    useEffect(() => asEffect(async signal => {
        const response = await fetch(`/api/persons/${personId}`, { signal });
        const person = await response.json();
        setName(`${person.firstName} ${person.lastName}`);
    }), [personId]);

    return name === undefined ? (
        <p>Loading person...</p>
    ) : (
        <p>The person is named: {name}</p>
    );
}
```

## useEffect Dependencies

Since `asEffect` is just a function called inside `useEffect`, eslint checks its dependencies like any other code in `useEffect`.
Forgetting `personId` in the example above produces the usual warning:
`React Hook useEffect has a missing dependency: 'personId'. Either include it or remove the dependency array. react-hooks/exhaustive-deps`

```tsx
import { asEffect } from "no-async-hook";
import { useEffect, useState } from "react";

function Person({ personId }: { personId: number }) {
    const [name, setName] = useState<string | undefined>(undefined);

    useEffect(() => asEffect(async signal => {
        const response = await fetch(`/api/persons/${personId}`, { signal });
        const person = await response.json();
        setName(`${person.firstName} ${person.lastName}`);
    }), []); // <--- missing `personId`

    return name === undefined ? (
        <p>Loading person...</p>
    ) : (
        <p>The person is named: {name}</p>
    );
}
```

## asPromise

`asPromise` is the inverse of `asEffect`: it turns a callback style API into a promise.
Its executor works like the one of `new Promise`, but must return a cleanup function, just like a `useEffect` callback.

```typescript
useEffect(() => asEffect(async signal => {
    await asPromise<void>(resolve => {
        const timeoutId = setTimeout(() => resolve(), 1000);
        return () => clearTimeout(timeoutId);
    }, signal);
    const response = await fetch(`/api/persons/${personId}`, { signal });
}), [personId]);
```

Instead of a dependency array, `asPromise` takes an `AbortSignal`: aborting it rejects the promise with `signal.reason`.
The cleanup function runs exactly once, whether the promise resolves, rejects or is aborted.
Ideally, each callback API should be wrapped in its own function and then combined through async/await.

```typescript
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
    return asPromise<void>(resolve => {
        const timeoutId = setTimeout(() => resolve(), milliseconds);
        return () => clearTimeout(timeoutId);
    }, signal);
}

useEffect(() => asEffect(async signal => {
    await delay(1000, signal);
    const response = await fetch(`/api/persons/${personId}`, { signal });
}), [personId]);
```

## Exception Handling

Cancellation lets an async function stop at any point instead of running to completion.
When its signal is aborted, the pending call throws `signal.reason`.

Therefore, do not catch cancellation errors: rethrow them until they reach the original caller.

Checking for a specific error is unreliable, since you control neither the error thrown by the callee nor the reason given by the caller.
Check `signal.aborted` instead: if it is set, the error is *almost* certainly a cancellation.

```typescript
async function myAsyncFunction(signal: AbortSignal): Promise<unknown> {
    try {
        return await anotherAsyncFunction(signal);
    }
    catch (error) {
        if (signal.aborted) { // DO NOT catch cancellations!
            throw error; // the call stack continues to unwind
        }
        // handle the error in some way
        console.error(error);
    }
}
```
