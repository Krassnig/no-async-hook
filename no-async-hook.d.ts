/**
 * Runs the given async function immediately and returns a cleanup function that aborts it.
 * Call the cleanup function to abort the async function.
 * @example
 * // Use it instead of an async effect or a custom useEffectAsync hook.
 * useEffect(() => asCallback(async signal => {
 *     const response = await fetch(url, { signal }); // pass the signal to every async call
 *     setData(await response.json());
 * }), [url]);
 * @example
 * // Never swallow cancellation.
 * try {
 *     await load(signal);
 * }
 * catch (error) {
 *     if (signal.aborted) throw error;
 *     // handle the error
 * }
 * @param asyncFunction receives an `AbortSignal`. Pass it to every async call inside so the function can be aborted correctly.
 * @returns A cleanup function that aborts the `AbortSignal`, an optional reason may be given.
 * @throws {TypeError} If `asyncFunction` is not a function or does not return a promise.
 */
export function asCallback(
	asyncFunction: (signal: AbortSignal) => PromiseLike<void>
): (reason?: any) => void;

/**
 * Runs the given executor function immediately and returns a promise that can be aborted using an AbortSignal.
 * Unlike a normal Promise executor, this executor function has to return a cleanup function.
 * @example
 * // Wrap exactly one callback resource and return its cleanup function.
 * // Not `resolve => setTimeout(resolve, ms)`: it returns a timer id and rejects with a TypeError.
 * // Nothing to clean up: return `() => {}`.
 * const delay = (ms: number, signal: AbortSignal) => asPromise<void>(resolve => {
 *     const id = setTimeout(resolve, ms);
 *     return () => clearTimeout(id);
 * }, signal);
 * @example
 * // Combine resources in an async function, not inside one asPromise.
 * await delay(1000, signal);
 * await nextEvent(button, 'click', signal);
 * @param executor a Promise executor that returns a cleanup function.
 * @param signal a signal which can be used to abort the returned promise.
 * @returns a promise.
 * @throws {TypeError} If the executor or signal are not the correct type.
 */
export function asPromise<T>(
	executor: (
		resolve: (value: T | PromiseLike<T>) => void,
		reject: (reason?: any) => void
	) => (reason?: any) => void,
	signal: AbortSignal
): Promise<T>;
