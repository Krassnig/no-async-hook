import { afterEach, describe, expect, it, vi } from 'vitest';
import { asCallback, asPromise } from './no-async-hook.js';

afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * Records the listeners added to and removed from a signal.
 * @param {AbortSignal} signal
 * @returns {() => number} the number of listeners that were added but never removed.
 */
function trackListeners(signal) {
	const add = vi.spyOn(signal, 'addEventListener');
	const remove = vi.spyOn(signal, 'removeEventListener');

	return () => add.mock.calls.filter(([type, listener]) =>
		!remove.mock.calls.some(([removedType, removedListener]) => removedType === type && removedListener === listener)
	).length;
}

/**
 * Collects the errors the library reports as uncaught errors through `queueMicrotask`,
 * instead of letting them fail the test run.
 * @returns {unknown[]} the reported errors, filled as the microtasks run.
 */
function captureReportedErrors() {
	const reported = [];
	const originalQueueMicrotask = globalThis.queueMicrotask;

	vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(callback => originalQueueMicrotask(() => {
		try {
			callback();
		}
		catch (error) {
			reported.push(error);
		}
	}));

	return reported;
}

/**
 * Waits until all pending microtasks have run.
 * @returns {Promise<void>}
 */
function flush() {
	return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<{ value: unknown } | { error: unknown } | 'pending'>} how the promise settled, once all pending microtasks have run.
 */
function outcomeOf(promise) {
	return Promise.race([
		promise.then(value => ({ value }), error => ({ error })),
		flush().then(() => 'pending'),
	]);
}

/**
 * Calls `asPromise` with an executor that returns a cleanup spy and exposes `resolve`, `reject` and the controller.
 * @param {(test: object) => void} [during] runs inside the executor, before the cleanup function is returned.
 */
function start(during = () => { }) {
	const controller = new AbortController();
	const test = {
		controller,
		cleanup: vi.fn(),
		activeListeners: trackListeners(controller.signal),
	};

	test.promise = asPromise((resolve, reject) => {
		test.resolve = resolve;
		test.reject = reject;
		during(test);
		return test.cleanup;
	}, controller.signal);

	return test;
}

describe('asCallback', () => {
	it('runs the async function immediately with an AbortSignal', () => {
		const asyncFunction = vi.fn(async () => { });

		asCallback(asyncFunction);

		expect(asyncFunction).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
	});

	it.each([
		['an AbortError without a reason', undefined, reason => reason instanceof DOMException && reason.name === 'AbortError'],
		['the given reason', 'stop', reason => reason === 'stop'],
	])('the cleanup aborts the signal with %s', (_, reason, isExpectedReason) => {
		let signal;
		const cleanup = asCallback(async s => { signal = s; });

		cleanup(reason);

		expect(signal.aborted).toBe(true);
		expect(isExpectedReason(signal.reason)).toBe(true);
	});

	it('reports errors thrown before the signal was aborted', async () => {
		const reported = captureReportedErrors();
		const error = new Error('boom');

		asCallback(async () => { throw error; });
		await flush();

		expect(reported).toEqual([error]);
	});

	it('does not report errors thrown after the signal was aborted', async () => {
		const reported = captureReportedErrors();

		const cleanup = asCallback(async signal => {
			await null;
			signal.throwIfAborted();
		});
		cleanup();
		await flush();

		expect(reported).toEqual([]);
	});

	it.each([undefined, null, {}])('throws a TypeError if asyncFunction is %o', asyncFunction => {
		expect(() => asCallback(asyncFunction)).toThrow(TypeError);
	});

	it.each([undefined, null, 42])('throws a TypeError if asyncFunction returns %o', returnValue => {
		expect(() => asCallback(() => returnValue)).toThrow(TypeError);
	});

	it('accepts a non-native thenable', () => {
		expect(() => asCallback(() => ({ then() { } }))).not.toThrow();
	});
});

describe('asPromise', () => {
	describe('arguments', () => {
		it.each([undefined, {}])('throws a TypeError if executor is %o', executor => {
			expect(() => asPromise(executor, new AbortController().signal)).toThrow(TypeError);
		});

		it.each([
			['undefined', undefined],
			['null', null],
			['an empty object', {}],
			['a non-boolean aborted', { aborted: 'no', addEventListener() { }, removeEventListener() { } }],
			['a missing removeEventListener', { aborted: false, addEventListener() { } }],
		])('throws a TypeError if signal is %s', (_, signal) => {
			expect(() => asPromise(() => () => { }, signal)).toThrow(TypeError);
		});

		it('accepts a signal that is not an instance of AbortSignal but has its shape', async () => {
			const target = new EventTarget();
			const signal = {
				aborted: false,
				addEventListener: target.addEventListener.bind(target),
				removeEventListener: target.removeEventListener.bind(target),
			};
			const cleanup = vi.fn();

			const promise = asPromise(() => cleanup, signal);
			Object.assign(signal, { aborted: true, reason: 'stop' });
			target.dispatchEvent(new Event('abort'));

			expect(await outcomeOf(promise)).toEqual({ error: 'stop' });
			expect(cleanup).toHaveBeenCalledExactlyOnceWith('stop');
		});

		it('rejects without running the executor if the signal is already aborted', async () => {
			const executor = vi.fn();

			const promise = asPromise(executor, AbortSignal.abort('pre'));

			expect(await outcomeOf(promise)).toEqual({ error: 'pre' });
			expect(executor).not.toHaveBeenCalled();
		});
	});

	describe('settling', () => {
		it.each([
			['resolve synchronously', 'during', t => t.resolve(1), { value: 1 }, undefined],
			['resolve asynchronously', 'after', t => t.resolve(1), { value: 1 }, undefined],
			['reject synchronously', 'during', t => t.reject('nope'), { error: 'nope' }, 'nope'],
			['reject asynchronously', 'after', t => t.reject('nope'), { error: 'nope' }, 'nope'],
			['abort during the executor', 'during', t => t.controller.abort('stop'), { error: 'stop' }, 'stop'],
			['abort while pending', 'after', t => t.controller.abort('stop'), { error: 'stop' }, 'stop'],
			['abort after resolving', 'after', t => { t.resolve(1); t.controller.abort('stop'); }, { value: 1 }, undefined],
			['settle more than once', 'after', t => { t.resolve(1); t.resolve(2); t.reject('nope'); }, { value: 1 }, undefined],
			['reject more than once', 'after', t => { t.reject('first'); t.reject('second'); }, { error: 'first' }, 'first'],
			['resolve with a fulfilling promise', 'after', t => t.resolve(Promise.resolve(1)), { value: 1 }, undefined],
			['resolve with a rejecting promise', 'after', t => t.resolve(Promise.reject('inner')), { error: 'inner' }, 'inner'],
			['abort while a resolved promise is pending', 'after', t => { t.resolve(new Promise(() => { })); t.controller.abort('stop'); }, { error: 'stop' }, 'stop'],
			['settle again while a resolved promise is pending', 'after', t => { t.resolve(Promise.resolve(1)); t.resolve(2); t.reject('nope'); }, { value: 1 }, undefined],
		])('%s', async (_, when, act, outcome, cleanupReason) => {
			const t = start(when === 'during' ? act : undefined);
			if (when === 'after') act(t);

			expect(await outcomeOf(t.promise)).toEqual(outcome);
			expect(t.cleanup).toHaveBeenCalledExactlyOnceWith(cleanupReason);
			expect(t.activeListeners()).toBe(0);
		});

		it.each([
			['the executor has not settled', () => { }],
			['a resolved promise is pending', t => t.resolve(new Promise(() => { }))],
		])('keeps the cleanup and the abort listener while %s', async (_, act) => {
			const t = start();
			act(t);

			expect(await outcomeOf(t.promise)).toBe('pending');
			expect(t.cleanup).not.toHaveBeenCalled();
			expect(t.activeListeners()).toBe(1);
		});

		it('rejects when the executor throws', async () => {
			const error = new Error('boom');

			const t = start(() => { throw error; });

			expect(await outcomeOf(t.promise)).toEqual({ error });
			expect(t.cleanup).not.toHaveBeenCalled();
			expect(t.activeListeners()).toBe(0);
		});
	});

	describe('cleanup function', () => {
		it.each(['during', 'after'])('runs only once when it settles the promise itself (resolve %s the executor)', async when => {
			const settle = t => {
				t.cleanup.mockImplementation(() => t.resolve('again'));
				t.resolve(1);
			};

			const t = start(when === 'during' ? settle : undefined);
			if (when === 'after') settle(t);

			expect(await outcomeOf(t.promise)).toEqual({ value: 1 });
			expect(t.cleanup).toHaveBeenCalledOnce();
		});

		it('reports an error it throws and still settles the promise', async () => {
			const reported = captureReportedErrors();
			const error = new Error('cleanup failed');

			const t = start(t => {
				t.cleanup.mockImplementation(() => { throw error; });
				t.resolve(1);
			});

			expect(await outcomeOf(t.promise)).toEqual({ value: 1 });
			expect(reported).toHaveLength(1);
			expect(reported[0].cause).toBe(error);
		});
	});

	describe('invalid cleanup function', () => {
		it.each([
			['nothing', () => { }],
			['null', () => null],
			['a timer', resolve => setTimeout(resolve, 0)],
			['a promise', async () => { }],
		])('rejects with a TypeError if the executor returns %s', async (_, executor) => {
			const signal = new AbortController().signal;
			const activeListeners = trackListeners(signal);

			const outcome = await outcomeOf(asPromise(executor, signal));

			expect(outcome.error).toBeInstanceOf(TypeError);
			expect(activeListeners()).toBe(0);
		});

		it.each([
			['nothing', resolve => { resolve(1); }],
			['a promise', async resolve => resolve(1)],
		])('reports a TypeError if the executor resolves synchronously and returns %s', async (_, executor) => {
			const reported = captureReportedErrors();

			const outcome = await outcomeOf(asPromise(executor, new AbortController().signal));

			expect(outcome).toEqual({ value: 1 });
			expect(reported).toEqual([expect.any(TypeError)]);
		});

		it('is never called when the executor settles again later', async () => {
			const reported = captureReportedErrors();

			const promise = asPromise(async resolve => {
				resolve(1);
				await null;
				resolve(2);
			}, new AbortController().signal);

			expect(await outcomeOf(promise)).toEqual({ value: 1 });
			expect(reported).toEqual([expect.any(TypeError)]);
		});
	});

	describe('after the outcome is decided', () => {
		it('rejects with a TypeError when resolved with itself, like a native promise', async () => {
			const t = start();
			t.resolve(t.promise);

			const outcome = await outcomeOf(t.promise);

			expect(outcome.error).toBeInstanceOf(TypeError);
			expect(t.cleanup).toHaveBeenCalledExactlyOnceWith(outcome.error);
		});

		it.each([
			['a value', 1],
			['a promise', Promise.resolve(1)],
		])('reports a throw after resolving with %s', async (_, value) => {
			const reported = captureReportedErrors();
			const error = new Error('boom');

			const t = start(t => {
				t.resolve(value);
				throw error;
			});

			expect(await outcomeOf(t.promise)).toEqual({ value: 1 });
			expect(reported).toEqual([error]);
		});

		it('reports an invalid cleanup function after resolving with a promise, like after resolving with a value', async () => {
			const reported = captureReportedErrors();

			const promise = asPromise(resolve => {
				resolve(Promise.resolve(1));
				return 42;
			}, new AbortController().signal);

			expect(await outcomeOf(promise)).toEqual({ value: 1 });
			expect(reported).toEqual([expect.any(TypeError)]);
		});

		it('can still be aborted after the executor threw while a resolved promise is pending', async () => {
			captureReportedErrors();

			const t = start(t => {
				t.resolve(new Promise(() => { }));
				throw new Error('boom');
			});
			t.controller.abort('stop');

			expect(await outcomeOf(t.promise)).toEqual({ error: 'stop' });
			expect(t.activeListeners()).toBe(0);
		});
	});
});
