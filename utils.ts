export function getStack() {
	/** use: debug('closing socket - reason %s (from: %s)', reason, new Error().stack?.split('\n')[2]); */
	return new Error().stack?.split('\n')[2];
}
