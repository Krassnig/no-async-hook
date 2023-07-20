# You might not need a useEffectAsync hook

This library brings the `Async` and `Effect` functions to your codebase which allow you to seamlessly switch between the async/await and callback/effect style functions.
Using these functions also lets eslint statically verify the correct usage of the dependencies inside a `useEffect` hook.

## Async

The most common use case is using async functions inside a `useEffect` call.
Simply add `() => Async(async signal => { /* your code */ })` to your `useEffect` and use async/await functions.

```tsx
import react, { useEffect } from "react";
import { Async } from "@krassnig/use-effect-async";

const CountComponent: React.FC = () => {
    const [count, setCount] = useState<number>();

    useEffect(() => Async(async signal => {
        // backend call or any async operation
        const response = await Promise.resolve(12345);
        setCount(response);
    }), []);

    return count === undefined ? (
        <p>Loading count...</p>
    ) : (
        <p>Count: { count }</p>
    );
}
```

## useEffect Dependencies

If `useEffect` and `Async` are used correctly, eslint will notify you of missing dependencies.
To receive proper linting you should NOT pass the result of the `Async` function directly into `useEffect`.

```tsx
// DO NOT do this
useEffect(Async(async signal) => {
    // async code
}, []);
```

Although the example above would behave perfectly fine, eslint would not be able to statically identify missing depencies.
The following eslint error would be produced:
`React Hook useEffect received a function whose dependencies are unknown. Pass an inline function instead react-hooks/exhaustive-deps`

To avoid this just inline the function like this:
```tsx
// Do this instead
useEffect(() => Async(async signal) => {
    // async code
}, []);
```

Using the `Async` function this way alerts you about missing dependencies.
For example, if you were to forget `id` as a dependency when doing a backend call

```tsx
import react, { useEffect } from "react";
import { Async } from "@krassnig/use-effect-async";

const CountComponent: React.FC<{ id: number }> = ({ id }) => {
    const [count, setCount] = useState<number>();

    useEffect(() => Async(async signal => {
        const response = await fetch(`/api/counters/${id}`, { signal });
        const count = await response.json();
        setCount(count);
    }), []); // <--- missing `id`

    return count === undefined ? (
        <p>Loading count...</p>
    ) : (
        <p>Count: { count }</p>
    );
}
```

eslint gives the following output: `React Hook useEffect has a missing dependency: 'id'. Either include it or remove the dependency array  react-hooks/exhaustive-deps`

## Effect

`Effect` is the inverse to `Async`.
It allows you to convert a function written in a callback style into a function that uses async/await.
It expects the same exact pattern that is used inside a `useEffect` hook, but accepts a signal instead of a dependency array.
The cleanup function will be triggered once the signal is aborted.
If, like in the example below, the signal comes from the `Async` function, the cleanup will be triggered exactly when React cleans up the surrounding `useEffect` hook.

```tsx
import { Async, Effect } from "@krassnig/use-effect-async";

const MyComponent: React.FC = () => {
    useEffect(() => Async(async signal => {		
        
        await Effect(resolve => {
            const timeoutId = setTimeout(() => resolve(), 1000);
            return () => clearTimeout(timeoutId);
        }, signal);

        const response = await fetch(...);
    }, []);

    return (...);
}
```

This example waits for one second and then calls `fetch` afterwards. The `resolve` function provided by `Effect` resolves the promises that is returned by the `Effect` function.

## Delay

You can encapsulate `Effect` calls inside async function to make them easier to read.
For example, this `delay` function.
It is implemented by calling `setTimeout` and resolving it once the timeout is triggered.
It is important to clean up the timeout should the `Effect` be aborted before the timeout resolves.

```typescript
import { Effect } from "async-effect";

export const delay = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
    return await Effect(resolve => {
        const timeoutId = setTimeout(() => resolve(), milliseconds);
        return () => clearTimeout(timeoutId);
    }, signal);
}
```

Once implemented it is easier to use and read.
For example, the hook from the [Effect Section above](#Effect) can then be simplified to:

```tsx
import { Async } from "@krassnig/use-effect-async";

const MyComponent: React.FC = () => {
    useEffect(() => Async(async signal => {		
        await delay(1000, signal);
        const response = await fetch(...);
    }, []);

    return (...);
}
```

## Awaiting cleanup

`Effect` can be utilized to execute code after the signal (or `useEffect` cleanup) has been triggered.
Simply resolve the `Effect` in the `Effect`s cleanup function.

```tsx
import { Async, Effect } from "@krassnig/use-effect-async";

useEffect(() => Async(async signal => {
    await delay(1000, signal); // do work

    // resolve when useEffect cleans up.
    await Effect(resolve => () => resolve(), signal); 

    console.log('cleanup has been called');
}), []);
```

## Exception Handling

Aync function in general, but especially in React inside a `useEffect` call, are supposed to be cancelable at "any" point in time.
In order to achieve that, an [AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) is passed between async functions which tells the async operation when an [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) cancels the async operation.
In order to cancel the async operation deep inside the call stack an exception is thrown (or equivalently the promise is rejected).
This then collapses the call stack and the promise is aborted.
Since Javascripts `catch` catches everything, simply surrounding an async operation with a `try`/`catch` would prevent that cancellation.
In order to not break the cancellability of an async function when catching errors use `signal.aborted` and rethrow the error.

```typescript
const myAsyncFunction = async (signal: AbortSignal): Promise<any> => {
    try {
        return await anotherAsyncFunction(signal);
    }
    catch (error) {
        if (signal.aborted) { // DO NOT catch cancellations!
            throw error; // The call stack continues to collapse
        }
        else {
            // handle error
            console.error(error);
        }
    }
}
```

## Nesting

If you are unsure which paradigm to use after reading this README feel free to express that uncertainty by switching between both paradigms multiple times!

```tsx
useEffect(
    () => Async(
        async signal => await Effect(
            resolve => Async(
                async signal => await Effect(
                    resolve => Async(
                        async signal => await Effect(
                            resolve => Async(
                                async signal => { console.log('Hello World!'); }
                            ), signal
                        )
                    ), signal
                )
            ), signal
        )
    )
);
```