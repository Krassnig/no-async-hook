/**
 * Runs the given async function immediately and returns a cleanup function that aborts it.
 * Call the cleanup function to abort the async function.
 * @param {(signal: AbortSignal) => PromiseLike<void>} asyncFunction receives an `AbortSignal`. Pass it to every async call inside so the function can be aborted correctly.
 * @returns {() => void} A cleanup function that aborts the `AbortSignal`.
 * @throws {TypeError} If `asyncFunction` does not return a promise.
 */
export function asCallback(asyncFunction) {
	const abortReason = Symbol('aborted by asCallback cleanup / do not catch');
	const controller = new AbortController();
	const signal = controller.signal;

	const promise = asyncFunction(signal);

	if (typeof promise?.then !== 'function') {
		throw new TypeError(`asCallback: asyncFunction must return a promise, but returned ${promise === null ? 'null' : typeof promise}.`);
	}

	Promise.resolve(promise).catch(error => {
		if (!signal.aborted) {
			throw error;
		}
	});

	return () => controller.abort(abortReason);
}

/**
 * Converts a callback into a promise.
 * @template T
 * @param {(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => ((() => void) | void)} effect implement an effect and use the two arguments to effect resolve and reject to complete it.
 * @param {AbortSignal} signal a signal which can abort the returned promise.
 * @returns {Promise<T>} a promise.
 */
export function asPromise(effect, signal) {
	if (!(signal instanceof AbortSignal))
		throw new TypeError();
	if (typeof effect !== 'function')
		throw new TypeError();
	if (signal.aborted)
		return Promise.reject(signal.reason);
	
	return new Promise((resolve, reject) => {
		let isSettled = false;
		let destructor = undefined;

		const runDestructor = () => {
			try {
				destructor?.();
			}
			catch (error) {
				console.error(
					"An error occurred inside an Effect Destructor call. " +
					"Consider adding an error boundary to your Effect Destructor function.",
					error
				);
			}
		}

		const freeResources = () => {
			if (isSettled) return;
			else isSettled = true;

			signal.removeEventListener('abort', onAbort);
			runDestructor();
		}

		const onAbort = () => {
			freeResources();
			reject(signal.reason);
		}

		signal.addEventListener('abort', onAbort);

		try {
			destructor = effect(
				value => {
					freeResources();
					resolve(value);
				},
				reason => {
					freeResources();
					reject(reason);
				}
			);
		}
		catch (error) {
			freeResources();
			reject(error);
			return;
		}

		if (destructor !== undefined && typeof destructor !== 'function') {
			const error = new TypeError(`asPromise: effect must return a cleanup function or nothing, but returned ${destructor === null ? 'null' : typeof destructor}.`);
			destructor = undefined;

			if (isSettled) {
				console.error(error);
			}
			else {
				freeResources();
				reject(error);
			}
			return;
		}

		// effect resolved or rejected synchronously, before its destructor was assigned
		if (isSettled) runDestructor();
	});
}

export function asPromise3(effect, signal) {
	if (!(signal instanceof AbortSignal))
		throw new TypeError();
	if (typeof effect !== 'function')
		throw new TypeError();
	if (signal.aborted)
		return Promise.reject(signal.reason);
	
	return new Promise((resolve, reject) => {
		let isPromiseSettled = false;
		let destructor = undefined;

		const freeResources = () => {
			signal.removeEventListener('abort', onAbort);

			if (isPromiseSettled)
				return;

			isPromiseSettled = true;

			try {
				destructor?.();
				destructor = undefined;
			}
			catch (error) {
				console.error(
					"An error occurred inside an Effect Destructor call. " +
					"Consider adding an error boundary to your Effect Destructor function.",
					error
				);
			}
		}

		const onAbort = () => {
			freeResources();
			reject(signal.reason);
		}

		signal.addEventListener('abort', onAbort);

		try {
			const returnedDestructor = effect(
				value => {
					freeResources();
					resolve(value);
				},
				reason => {
					freeResources();
					reject(reason);
				}
			);
			if (returnedDestructor !== undefined && typeof returnedDestructor !== 'function') {
				if (isPromiseSettled) {
					console.error(`asPromise: effect must return a cleanup function or nothing, but returned ${returnedDestructor === null ? 'null' : typeof returnedDestructor}.`);
					return;
				}
				else {
					throw new TypeError(`asPromise: effect must return a cleanup function or nothing, but returned ${returnedDestructor === null ? 'null' : typeof returnedDestructor}.`);
				}
			}
			else {
				destructor = returnedDestructor;
				// effect resolved or rejected synchronously, before its destructor was assigned
				if (isPromiseSettled) {
					isPromiseSettled = false;
					freeResources();
				}
			}
		}
		catch (error) {
			freeResources();
			reject(error);
			return;
		}
	});
}