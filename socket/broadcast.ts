import type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketId,
	Room,
	AckCallback,
	EventsMap,
	DefaultEventsMap,
	SocketData as DefaultSocketData,
} from '../shared/types/socket.types';
import { SocketParser } from './parser';

const isProduction = process.env.NODE_ENV === 'production';

export interface BroadcastFlags {
	volatile?: boolean;
	compress?: boolean;
	local?: boolean;
	broadcast?: boolean;
	timeout?: number;
}

/**
 * Broadcast operator for chaining operations with full TypeScript support
 */
export class BroadcastOperator<
	EmitEvents extends EventsMap = ServerToClientEvents,
	SocketData extends DefaultSocketData = DefaultSocketData
> {
	private rooms: Set<Room> = new Set();
	private exceptRooms: Set<Room> = new Set();
	private exceptSockets: Set<SocketId> = new Set();
	private flags: BroadcastFlags = {};

	constructor(private adapter: any) {} // Избегаем циклических импортов

	/**
	 * Target specific room(s)
	 */
	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		const rooms = Array.isArray(room) ? room : [room];
		rooms.forEach((r) => operator.rooms.add(r));
		return operator;
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.to(room);
	}

	/**
	 * Exclude specific room(s)
	 */
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		const rooms = Array.isArray(room) ? room : [room];
		rooms.forEach((r) => {
			if (r.length === 20) {
				// Likely a socket ID
				operator.exceptSockets.add(r as SocketId);
			} else {
				operator.exceptRooms.add(r);
			}
		});
		return operator;
	}

	/**
	 * Set volatile flag
	 */
	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		operator.flags.volatile = true;
		return operator;
	}

	/**
	 * Set compress flag
	 */
	compress(compress: boolean): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		operator.flags.compress = compress;
		return operator;
	}

	/**
	 * Set local flag
	 */
	get local(): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		operator.flags.local = true;
		return operator;
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		operator.flags.timeout = timeout;
		return operator;
	}

	/**
	 * Typed emit to all sockets in namespace with proper overloads (Socket.IO format)
	 */
	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg?: Parameters<EmitEvents[Ev]>[0],
		ack?: AckCallback
	): boolean {
		try {
			let ackId: string | undefined;
			let data: any;

			// Handle different call signatures
			if (typeof dataOrArg === 'function') {
				// emit(event, ack)
				ack = dataOrArg;
				data = undefined;
			} else if (typeof ack === 'function') {
				// emit(event, data, ack)
				data = dataOrArg;
			} else {
				// emit(event, ...args) or emit(event, data)
				data = dataOrArg;
				// Ensure data doesn't contain functions
				if (data && typeof data === 'object') {
					data = this.sanitizeData(data);
				}
			}

			// Handle acknowledgement callback for broadcast
			if (typeof ack === 'function') {
				const targetSockets = this.getTargetSockets();

				if (targetSockets.size === 0) {
					// No target sockets, call ack immediately
					setTimeout(() => ack(null, []), 0);
					return true;
				}

				ackId = SocketParser.generateAckId();
				if (!isProduction) {
					console.log(`[BroadcastOperator] Generated broadcast ACK ID: ${ackId}`);
				}
				const responses: any[] = [];
				let responseCount = 0;
				let timedOut = false;
				const expectedResponses = targetSockets.size;

				const timeout = this.flags.timeout || 5000;
				const timer = setTimeout(() => {
					if (!timedOut) {
						timedOut = true;
						if (!isProduction) {
							console.log(
								`[BroadcastOperator] ACK timeout for broadcast ${ackId}, expected ${expectedResponses}, got ${responseCount} responses`
							);
						}

						// Clean up any remaining callbacks
						targetSockets.forEach((socketId) => {
							const socket = this.adapter.nsp.sockets.get(socketId);
							if (socket && socket.ackCallbacks.has(ackId!)) {
								socket.ackCallbacks.delete(ackId!);
							}
						});

						ack(new Error('Broadcast acknowledgement timeout'), responses);
					}
				}, timeout);

				// Create a shared callback that handles responses from all sockets
				const sharedCallback = (socketId: string) => (err: any, responseData: any) => {
					if (timedOut) return; // Ignore late responses

					if (!isProduction) {
						console.log(
							`[BroadcastOperator] ACK response from ${socketId} for broadcast ${ackId}:`,
							responseData
						);
					}

					if (err) {
						responses.push({ socketId, error: err.message || err });
					} else {
						responses.push({ socketId, data: responseData });
					}
					responseCount++;

					if (responseCount >= expectedResponses) {
						timedOut = true;
						clearTimeout(timer);

						// Clean up remaining callbacks
						targetSockets.forEach((sid) => {
							const socket = this.adapter.nsp.sockets.get(sid);
							if (socket && socket.ackCallbacks.has(ackId!)) {
								socket.ackCallbacks.delete(ackId!);
							}
						});

						ack(null, responses);
					}
				};

				// Register callback for each target socket
				targetSockets.forEach((socketId) => {
					const socket = this.adapter.nsp.sockets.get(socketId);
					if (socket) {
						socket.ackCallbacks.set(ackId!, sharedCallback(socketId));
						if (!isProduction) {
							console.log(
								`[BroadcastOperator] Registered ACK callback ${ackId} for socket ${socketId}`
							);
						}
					} else {
						// Socket not found, count as error response
						responses.push({ socketId, error: 'Socket not found' });
						responseCount++;

						if (responseCount >= expectedResponses) {
							timedOut = true;
							clearTimeout(timer);
							ack(null, responses);
						}
					}
				});
			}

			// Создаем Socket.IO формат пакета для каждого namespace
			const namespaces = new Map<string, Set<SocketId>>();
			const targetSockets = this.getTargetSockets();

			// Группируем сокеты по namespace
			targetSockets.forEach((socketId) => {
				const socket = this.adapter.nsp.sockets.get(socketId);
				if (socket && socket.connected) {
					const nsp = socket.nsp;
					if (!namespaces.has(nsp)) {
						namespaces.set(nsp, new Set());
					}
					namespaces.get(nsp)!.add(socketId);
				}
			});

			// Отправляем пакет в каждый namespace с правильным форматом
			let success = true;
			for (const [nsp, sockets] of namespaces) {
				const packet = SocketParser.encode(event as any, data, ackId, nsp);

				if (!isProduction) {
					console.log(
						`[BroadcastOperator] Broadcasting packet to namespace ${nsp}:`,
						'<packet>'
					);
				}

				// Отправляем каждому сокету в этом namespace
				for (const socketId of sockets) {
					const socket = this.adapter.nsp.sockets.get(socketId);
					if (socket && socket.connected && socket.ws.readyState === 1) {
						try {
							const result = socket.ws.send(packet);
							if (result === 0 || result === -1) {
								success = false;
							}
						} catch (error) {
							if (!isProduction) {
								console.warn(
									`[BroadcastOperator] Failed to send to socket ${socketId}:`,
									error
								);
							}
							success = false;
						}
					}
				}
			}

			return success;
		} catch (error) {
			if (!isProduction) {
				console.error('[BroadcastOperator] Emit error:', error);
			}
			return false;
		}
	}

	private sanitizeData(data: any, seen = new WeakSet()): any {
		if (data === null || data === undefined) return data;

		if (typeof data === 'function') return undefined;

		// Check for circular references
		if (typeof data === 'object' && seen.has(data)) {
			return '[Circular]';
		}

		if (Array.isArray(data)) {
			seen.add(data);
			const result = data.map((item) => this.sanitizeData(item, seen));
			seen.delete(data);
			return result;
		}

		if (typeof data === 'object') {
			seen.add(data);
			const sanitized: any = {};
			for (const [key, value] of Object.entries(data)) {
				if (typeof value !== 'function') {
					sanitized[key] = this.sanitizeData(value, seen);
				}
			}
			seen.delete(data);
			return sanitized;
		}

		return data;
	}

	/**
	 * Send a message (alias for emit with 'message' event)
	 */
	send(...args: any[]): boolean {
		return this.emit('message' as any, ...args);
	}

	/**
	 * Write a message (alias for send)
	 */
	write(...args: any[]): boolean {
		return this.send(...args);
	}

	/**
	 * Make all matching sockets join room(s)
	 */
	socketsJoin(room: Room | Room[]): void {
		const rooms = Array.isArray(room) ? room : [room];
		const targetSockets = this.getTargetSockets();

		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket) {
				socket.join(rooms);
			}
		});
	}

	/**
	 * Make all matching sockets leave room(s)
	 */
	socketsLeave(room: Room | Room[]): void {
		const rooms = Array.isArray(room) ? room : [room];
		const targetSockets = this.getTargetSockets();

		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket) {
				rooms.forEach((r) => socket.leave(r));
			}
		});
	}

	/**
	 * Disconnect all matching sockets
	 */
	disconnectSockets(close: boolean = false): void {
		const targetSockets = this.getTargetSockets();

		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket) {
				socket.disconnect(close);
			}
		});
	}

	/**
	 * Get all matching socket instances with full typing
	 */
	fetchSockets(): Promise<any[]> {
		const targetSockets = this.getTargetSockets();
		const sockets: any[] = [];

		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket) {
				// Create a simplified socket representation for safety
				sockets.push({
					id: socket.id,
					handshake: socket.handshake,
					rooms: new Set(socket.rooms),
					data: socket.data,
					emit: socket.emit.bind(socket),
					join: socket.join.bind(socket),
					leave: socket.leave.bind(socket),
					disconnect: socket.disconnect.bind(socket),
				});
			}
		});

		return Promise.resolve(sockets);
	}

	/**
	 * Get target socket IDs based on rooms and exceptions
	 */
	private getTargetSockets(): Set<SocketId> {
		let targetSockets: Set<SocketId>;

		if (this.rooms.size > 0) {
			targetSockets = this.adapter.getSockets(this.rooms);
		} else {
			targetSockets = this.adapter.getSockets();
		}

		// Remove excepted sockets
		for (const socketId of this.exceptSockets) {
			targetSockets.delete(socketId);
		}

		// Remove sockets in excepted rooms
		for (const room of this.exceptRooms) {
			const roomSockets = this.adapter.getSockets(new Set([room]));
			for (const socketId of roomSockets) {
				targetSockets.delete(socketId);
			}
		}

		return targetSockets;
	}

	/**
	 * Clone this operator
	 */
	private clone(): BroadcastOperator<EmitEvents, SocketData> {
		const operator = new BroadcastOperator<EmitEvents, SocketData>(this.adapter);
		operator.rooms = new Set(this.rooms);
		operator.exceptRooms = new Set(this.exceptRooms);
		operator.exceptSockets = new Set(this.exceptSockets);
		operator.flags = { ...this.flags };
		return operator;
	}
}

// RemoteSocket остается без изменений - он уже работает правильно
export class RemoteSocket<
	EmitEvents extends EventsMap = ServerToClientEvents,
	SocketData extends DefaultSocketData = DefaultSocketData
> {
	public readonly id: SocketId;
	public readonly handshake: any;
	public readonly rooms: Set<Room>;
	public readonly data: SocketData;

	private readonly operator: BroadcastOperator<EmitEvents, SocketData>;

	constructor(adapter: any, details: any) {
		this.id = details.id;
		this.handshake = details.handshake;
		this.rooms = new Set(details.rooms);
		this.data = details.data;
		this.operator = new BroadcastOperator<EmitEvents, SocketData>(adapter);

		// Target this specific socket
		this.operator['exceptSockets'] = new Set();
		this.operator['rooms'] = new Set([this.id]);
	}

	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return this.operator.timeout(timeout);
	}

	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean {
		return this.operator.emit(event, ...args);
	}

	join(room: Room | Room[]): void {
		return this.operator.socketsJoin(room);
	}

	leave(room: Room): void {
		return this.operator.socketsLeave(room);
	}

	disconnect(close = false): this {
		this.operator.disconnectSockets(close);
		return this;
	}
}
