# You Might Not Need A useEffectAsync Hook

This library brings the `Async` and `Effect` functions to your codebase which allow you to seamlessly switch between the async/await and callback/effect style functions.
Using these functions also lets eslint statically verify the correct usage of the dependencies inside a `useEffect` hook.

In depth article on why
[You Might Not Need A useEffectAsync Hook](https://krassnig.dev/blog/you-might-not-need-a-use-effect-async-hook).

## How To Install

Using NPM:
```
npm install no-async-hook
```

Using Yarn:
```
yarn add no-async-hook
```

## Async

The `Async` function allows you to write a normal async function and converts that async function into a function that `useEffect` can control.
Simply add `() => Async(async signal => { /* your code */ })` to your `useEffect` and use async/await functions.

```tsx
import { Async } from "no-async-hook";
import { useEffect, useState } from "react";

const PersonComponent: React.FC = ({ personId }) => {
    const [name, setName] = useState<string | undefined>(undefined);

    useEffect(() => Async(async signal => {
        await delay(1000, signal);
        const person = await findPersonById(personId, signal);
        const fullName = person.firstName + ' ' + person.lastName;
        setName(fullName);
    }), [personId]);

    return name === undefined ? (
        <p>Loading person...</p>
    ) : (
        <p>The person is named: { name }</p>
    );
}
```

## useEffect Dependencies

Since `Async` is just another function called inside `useEffect`,
eslint verifies missing dependencies like it would for any other function inside `useEffect`.
For example, if the `personId` were to be forgotten inside the `useEffect` dependency array,
eslint would warn you with the message:
`React Hook useEffect has a missing dependency: 'personId'. Either include it or remove the dependency array  react-hooks/exhaustive-deps`.

```tsx
import { Async } from "no-async-hook";
import { useEffect, useState } from "react";

const PersonComponent: React.FC = ({ personId }) => {
    const [name, setName] = useState<string | undefined>(undefined);

    useEffect(() => Async(async signal => {
        await delay(1000, signal);
        const person = await findPersonById(personId, signal);
        const fullName = person.firstName + ' ' + person.lastName;
        setName(fullName);
    }), []); // <--- missing `personId`

    return name === undefined ? (
        <p>Loading person...</p>
    ) : (
        <p>The person is named: { name }</p>
    );
}
```

## Effect

The inverse function of `Async` is `Effect` and is used to convert a callback style function into a promise.
Inside `Effect` you can write code just like inside a `useEffect` lambda.

```typescript
useEffect(() => Async(async signal => {
    await Effect<void>(resolve => {
        const timeoutId = setTimeout(() => resolve(), 1000);
        return () => clearTimeout(timeoutId);
    }, signal);
    const response = await endpoint.findById(..., signal);
}), [...]);
```

The main difference between `useEffect` and `Effect` is that instead of passing a dependency array to `Effect` it accepts an `AbortSignal` and provides a `resolve` function to fulfill the promise.
With `Effect` any callback style function can be converted into a promise easily.
Furthermore, these promises can be wrapped inside async functions to simplify async `useEffect` even more.

```typescript
const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => {
    return Effect<void>(resolve => {
        const timeoutId = setTimeout(() => resolve(), milliseconds);
        return () => clearTimeout(timeoutId);
    }, signal);
}

useEffect(() => Async(async signal => {
    await delay(1000, signal);
    const response = await endpoint.findById(..., signal);
}), [...]);
```

## Exception Handling

An important aspect of asynchronous programming is the capability to cancel async functions at any given moment.
Without it, an async function is forced to run to completion and cannot be stopped.
Async function achieve this by throwing the `signal.reason` from inside the promise.

For this reason cancellation errors thrown inside async function should not be caught in general.
Instead, they should be rethrown until they reach the orignal caller of the async function.

However, checking for a specific error is difficult if you neither have controll over the error thrown by the callee nor the error provided by the caller.
To work around that limitation the signal can be checked to see if it has already been aborted.
Through this you can infer that the error is *almost* centrainly a cancellation error without having to check for a specific value.

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
            // handle error in some way
            console.error(error);
        }
    }
}
```