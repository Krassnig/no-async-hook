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
 * @param {(signal: AbortSignal) => PromiseLike<void>} asyncFunction receives an `AbortSignal`. Pass it to every async call inside so the function can be aborted correctly.
 * @returns {(reason?: any) => void} A cleanup function that aborts the `AbortSignal`, an optional reason may be given.
 * @throws {TypeError} If `asyncFunction` is not a function or does not return a promise.
 */
export function asCallback(asyncFunction) {
	if (typeof asyncFunction !== 'function')
		throw new TypeError(`The parameter 'asyncFunction' must be a function, but received '${describeType(asyncFunction)}' instead.`);

	const controller = new AbortController();
	const signal = controller.signal;

	const promiseLike = asyncFunction(signal);

	if (!isPromiseLike(promiseLike)) {
		throw new TypeError(`The parameter 'asyncFunction' must return a 'PromiseLike', but returned '${describeType(promiseLike)}' instead.`);
	}

	Promise.resolve(promiseLike).catch(error => {
		if (!signal.aborted) {
			queueMicrotask(() => { throw error; });
		}
	});

	return reason => controller.abort(reason);
}

/**
 * Runs the given executor function immediately and returns a promise that can be aborted using an AbortSignal.
 * Unlike a normal Promise executor, this executor function has to return a cleanup function.
 * @example
 * // Wrap exactly one callback resource and return its cleanup function.
 * // Not `resolve => setTimeout(resolve, ms)`: it returns a timer id and rejects with a TypeError.
 * // Nothing to clean up: return `() => {}`.
 * const delay = (ms, signal) => asPromise(resolve => {
 *     const id = setTimeout(resolve, ms);
 *     return () => clearTimeout(id);
 * }, signal);
 * @example
 * // Combine resources in an async function, not inside one asPromise.
 * await delay(1000, signal);
 * await nextEvent(button, 'click', signal);
 * @template T
 * @param {(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => ((reason?: any) => void)} executor a Promise executor that returns a cleanup function.
 * @param {AbortSignal} signal a signal which can be used to abort the returned promise.
 * @returns {Promise<T>} a promise.
 * @throws {TypeError} If the executor or signal are not the correct type.
 */
export function asPromise(executor, signal) {
	if (typeof executor !== 'function')
		throw new TypeError(`The parameter 'executor' must be a function, but received '${describeType(executor)}' instead.`);
	if (!isAbortSignalLike(signal))
		throw new TypeError(`The parameter 'signal' must be an AbortSignal, but received '${describeType(signal)}' instead.`);
	if (signal.aborted)
		return Promise.reject(signal.reason);
	
	/** @type {Promise<T> | undefined} */
	let promise = undefined;

	promise = new Promise((resolve, reject) => {
		let isPromiseSettled = false;
		// `resolve` was called with a promise-like value, the outcome is decided by that value from now on
		let isResolving = false;
		/** @type {undefined | ((reason?: any) => void)} */
		let cleanupFunction = undefined;
		let settledReason = undefined;

		const freeResources = reason => {
			if (!isPromiseSettled) {
				isPromiseSettled = true;
				settledReason = reason;
			}

			signal.removeEventListener('abort', onAbort);

			try {
				const swapCleanupFunction = cleanupFunction;
				cleanupFunction = undefined;
				if (swapCleanupFunction !== undefined)
					swapCleanupFunction(settledReason);
			}
			catch (innerError) {
				queueMicrotask(() => {
					throw new Error(
						`An error was thrown inside an 'asPromise' cleanup function. Consider adding a try/catch.`,
						{ cause: innerError }
					);
				});
			}
		}

		const onAbort = () => {
			freeResources(signal.reason);
			reject(signal.reason);
		}

		signal.addEventListener('abort', onAbort);

		try {
			cleanupFunction = executor(
				value => {
					if (isPromiseSettled || isResolving)
						return;

					if (!isPromiseLike(value)) {
						freeResources();
						resolve(value);
						return;
					}

					if (value === promise) {
						const error = new TypeError(`An 'asPromise' promise cannot be resolved with itself.`);
						freeResources(error);
						reject(error);
						return;
					}

					isResolving = true;
					Promise.resolve(value).then(
						innerValue => {
							freeResources();
							resolve(innerValue);
						},
						innerError => {
							freeResources(innerError);
							reject(innerError);
						}
					);
				},
				reason => {
					if (isPromiseSettled || isResolving)
						return;

					freeResources(reason);
					reject(reason);
				}
			);

			if (typeof cleanupFunction !== 'function') {
				const error = new TypeError(`The executor must return a cleanup function, but returned '${describeType(cleanupFunction)}' instead.`);
				cleanupFunction = undefined;
				throw error;
			}

			// executor resolved or rejected synchronously, before its cleanup function was assigned
			if (isPromiseSettled) {
				freeResources();
			}
		}
		catch (error) {
			// the outcome is already decided, so the error can only be reported
			if (isPromiseSettled || isResolving) {
				queueMicrotask(() => { throw error; });
			}
			else {
				freeResources(error);
				reject(error);
			}
		}
	});

	return promise;
}

/**
 * Describes the type of a value for error messages: the constructor name for objects, otherwise typeof.
 * @param {unknown} value any value
 * @returns typeof or prototype name of that value
 */
function describeType(value) {
	if (value === null)
		return 'null';
	if (typeof value !== 'object')
		return typeof value;
	const prototype = Object.getPrototypeOf(value);
	const className = prototype && prototype.constructor && prototype.constructor.name;
	return typeof className === 'string' && className !== '' ? className : 'object';
}

/**
 * Checks for a `then` method, the same way `Promise.resolve` recognizes a thenable.
 * @param {unknown} value any value
 * @returns {value is PromiseLike<unknown>} promise like
 */
function isPromiseLike(value) {
	return value !== null && value !== undefined && typeof value.then === 'function';
}

/**
 * Checks the shape instead of `instanceof AbortSignal`, so signals from other realms (iframes, jsdom) and polyfills are accepted.
 * `reason` is not checked, as older implementations do not have it.
 * @param {unknown} signal maybe a signal
 * @returns {signal is AbortSignal} signal like
 */
function isAbortSignalLike(signal) {
	return signal !== null
		&& signal !== undefined
		&& typeof signal.aborted === 'boolean'
		&& typeof signal.addEventListener === 'function'
		&& typeof signal.removeEventListener === 'function';
}