type Destructor = () => void;

/**
 * Converts an async style function into an effect which can be supplied to useEffect.
 * useEffectAsync(() => Async(async signal => { ... }), [...]);
 * @param promise any promise, don't forget to utilize the AbortSignal when calling other async functions.
 * @returns A function that aborts the AbortSignal.
 */
export const Async = (promise: (signal: AbortSignal) => Promise<void>): Destructor => {
	const abortReason = Symbol('promise aborted / do not catch');
	const controller = new AbortController();
	const signal = controller.signal;

	promise(signal).catch(error => {
		if (!signal.aborted && error !== abortReason) {
			throw error;
		}
	});

	return () => controller.abort(abortReason);
}

/**
 * Converts an effect style function into a promise.
 * @param effect implement an effect and use the two arguments to effect resolve and reject to complete it.
 * @param signal a signal with which you can abort the returned promise.
 * @returns a promise.
 */
export const Effect = <T>(
	effect: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => (Destructor | void),
	signal: AbortSignal
): Promise<T> => {
	if (signal.aborted) return Promise.reject(signal.reason);
	
	return new Promise<T>((resolve, reject) => {
		try {
			let hasDestructorBeenCalled = false;

			const freeResources = () => {
				if (hasDestructorBeenCalled) return;
				else hasDestructorBeenCalled = true;

				signal.removeEventListener('abort', onAbort);
					
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

			const onAbort = () => {
				freeResources();
				reject(signal.reason);
			}
			
			const destructor = effect(
				value => {
					freeResources();
					resolve(value);
				},
				reason => {
					freeResources();
					reject(reason);
				}
			);

			signal.addEventListener('abort', onAbort);
		}
		catch (e) {
			reject(e);
		}
	});
};

/*
export const Signal = (effect: (abort: (reason?: any) => void) => (Destructor | void)): AbortSignal => {
	const controller = new AbortController();
	const signal = controller.signal;

	const destructor = effect(reason => {
		destructor?.();
		controller.abort(reason);
	})

	return signal;
}
*/