const { randomBytes } = await import('node:crypto');

/**
 * socket.io-совместимый base64id (20 символов)
 * https://github.com/socketio/base64id
 */
export function generateSid(): string {
	// 15 байт → 20 символов base64
	const raw = randomBytes(15); // Bun API
	return Buffer.from(raw)
		.toString('base64')
		.replace(/\+/g, '0') // убрать «+/»
		.replace(/\//g, '0')
		.substring(0, 20);
}
