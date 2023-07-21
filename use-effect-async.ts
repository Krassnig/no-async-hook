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
			let hasDestructorBeenCalled = false;

			const freeResources = () => {
				signal.removeEventListener('abort', onAbort);
				
				try {
					if (!hasDestructorBeenCalled) {
						hasDestructorBeenCalled = true;
						destructor?.();
					}
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
			
			const destructor = effect(value => {
				freeResources();
				resolve(value);
			});

			signal.addEventListener('abort', onAbort);
		}
		catch (e) {
			reject(e);
		}
	});
};