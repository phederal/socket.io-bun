/**
 * Test setup and configuration
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Global test timeout
const DEFAULT_TIMEOUT = 10000;

// Export test utilities
export const testUtils = {
	timeout: DEFAULT_TIMEOUT,

	/**
	 * Create a promise that rejects after timeout
	 */
	createTimeout(ms: number = DEFAULT_TIMEOUT, message: string = 'Test timeout') {
		return new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(message)), ms);
		});
	},

	/**
	 * Wait for a condition to be true
	 */
	async waitFor(
		condition: () => boolean | Promise<boolean>,
		timeout: number = DEFAULT_TIMEOUT,
		interval: number = 100
	): Promise<void> {
		const start = Date.now();

		while (Date.now() - start < timeout) {
			if (await condition()) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, interval));
		}

		throw new Error(`Condition not met within ${timeout}ms`);
	},

	/**
	 * Create a mock WebSocket for testing
	 */
	createMockWebSocket() {
		return {
			readyState: 1,
			send: () => 1,
			close: () => {},
			subscribe: () => {},
			unsubscribe: () => {},
			remoteAddress: '127.0.0.1',
		};
	},
};

console.log('🧪 Test environment initialized');
