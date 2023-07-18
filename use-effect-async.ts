type Destructor = () => void;

export const Async = (promise: (signal: AbortSignal) => Promise<void>): Destructor => {
	const abortReason = Symbol('promise-aborted');
	const controller = new AbortController();
	const signal = controller.signal;

	promise(signal).catch(error => {
		if (!signal.aborted && error !== abortReason) {
			throw error;
		}
	});

	return () => controller.abort(abortReason);
}

export const Effect = <T>(
	effect: (resolve: (value: T | PromiseLike<T>) => void) => (Destructor | void),
	signal: AbortSignal
): Promise<T> => {
	if (signal.aborted) return Promise.reject(signal.reason);
	
	return new Promise<T>((resolve, reject) => {
		try {
			const cleanUp = effect(resolve);
			
			const onAbort = () => {
				try {
					cleanUp?.();
					reject(signal.reason);
				}
				finally {
					signal.removeEventListener('abort', onAbort);
				}
			}

			signal.addEventListener('abort', onAbort);
		}
		catch (e) {
			reject(e);
		}
	});
};