type Destructor = () => void;

export const Async = (promise: (signal: AbortSignal) => Promise<void>): Destructor => {
	const abortReason = new Error('promise-aborted');
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
			const cleanUpAndThen = (andThen: () => void) => {
				signal.removeEventListener('abort', onAbort);
				
				try {
					cleanUp?.();
				}
				catch (e) {
					console.error("An error occurred inside an Effect Destructor call. Consider adding an error boundary to your Effect Destructor function.", e);
				}
				finally {
					andThen();
				}
			}

			const onAbort = () => {
				cleanUpAndThen(() => reject(signal.reason));
			}
			
			signal.addEventListener('abort', onAbort);

			const cleanUp = effect(value => {
				cleanUpAndThen(() => resolve(value));
			});
		}
		catch (e) {
			reject(e);
		}
	});
};