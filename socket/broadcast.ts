import type {
	ServerToClientEvents,
	SocketId,
	Room,
	AckCallback,
	EventsMap,
	DefaultEventsMap,
	SocketData as DefaultSocketData,
} from '../shared/types/socket.types';
import { SocketParser } from './parser';
import { BinaryProtocol } from './object-pool';

const isProduction = process.env.NODE_ENV === 'production';

export interface BroadcastFlags {
	volatile?: boolean;
	compress?: boolean;
	local?: boolean;
	broadcast?: boolean;
	timeout?: number;
	binary?: boolean;
	priority?: 'low' | 'normal' | 'high';
}

/**
 * Упрощенный Broadcast operator под новый унифицированный API
 */
export class BroadcastOperator<
	EmitEvents extends EventsMap = ServerToClientEvents,
	SocketData extends DefaultSocketData = DefaultSocketData
> {
	private rooms: Set<Room> = new Set();
	private exceptRooms: Set<Room> = new Set();
	private exceptSockets: Set<SocketId> = new Set();
	private flags: BroadcastFlags = {};

	constructor(private adapter: any) {}

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
	 * Set binary flag - принудительное использование бинарного формата
	 */
	get binary(): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		operator.flags.binary = true;
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
	 * Основной emit метод с поддержкой ACK
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
				ack = dataOrArg;
				data = undefined;
			} else if (typeof ack === 'function') {
				data = dataOrArg;
			} else {
				data = dataOrArg;
				if (data && typeof data === 'object') {
					data = this.sanitizeData(data);
				}
			}

			// Handle acknowledgement callback for broadcast
			if (typeof ack === 'function') {
				const targetSockets = this.getTargetSockets();

				if (targetSockets.size === 0) {
					setTimeout(() => ack(null, []), 0);
					return true;
				}

				ackId = SocketParser.generateAckId();
				const responses: any[] = [];
				let responseCount = 0;
				let timedOut = false;
				const expectedResponses = targetSockets.size;

				const timeout = this.flags.timeout || 5000;
				const timer = setTimeout(() => {
					if (!timedOut) {
						timedOut = true;
						targetSockets.forEach((socketId) => {
							const socket = this.adapter.nsp.sockets.get(socketId);
							if (socket && socket.ackCallbacks.has(ackId!)) {
								socket.ackCallbacks.delete(ackId!);
							}
						});
						ack(new Error('Broadcast acknowledgement timeout'), responses);
					}
				}, timeout);

				const sharedCallback = (socketId: string) => (err: any, responseData: any) => {
					if (timedOut) return;

					if (err) {
						responses.push({ socketId, error: err.message || err });
					} else {
						responses.push({ socketId, data: responseData });
					}
					responseCount++;

					if (responseCount >= expectedResponses) {
						timedOut = true;
						clearTimeout(timer);
						ack(null, responses);
					}
				};

				// Register callback for each target socket
				targetSockets.forEach((socketId) => {
					const socket = this.adapter.nsp.sockets.get(socketId);
					if (socket) {
						socket.ackCallbacks.set(ackId!, {
							callback: sharedCallback(socketId),
							timeoutId: timer,
							createdAt: Date.now(),
						});
					}
				});
			}

			const targetSockets = this.getTargetSockets();
			if (targetSockets.size === 0) return true;

			let success = true;

			// Определяем тип отправки
			const useBinary = this.flags.binary;
			const useAck = !!ackId;

			for (const socketId of targetSockets) {
				const socket = this.adapter.nsp.sockets.get(socketId);
				if (!socket || !socket.connected || socket.ws.readyState !== 1) {
					success = false;
					continue;
				}

				try {
					// Выбираем оптимальный метод отправки
					let result: boolean;

					if (useAck) {
						// С ACK используем обычный emit
						result = socket.emit(event, data);
					} else if (useBinary && !data) {
						// Бинарный без данных
						result = socket.emitBinary(event);
					} else if (useBinary && typeof data === 'string') {
						// Бинарный со строковыми данными
						result = socket.emitBinary(event, data);
					} else if (!data) {
						// Быстрый emit без данных
						result = socket.emitFast(event as string);
					} else if (typeof data === 'string') {
						// Быстрый emit со строкой
						result = socket.emitFast(event as string, data);
					} else {
						// Обычный emit для сложных данных
						result = socket.emit(event, data);
					}

					if (!result) {
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

			return success;
		} catch (error) {
			if (!isProduction) {
				console.error('[BroadcastOperator] Emit error:', error);
			}
			return false;
		}
	}

	/**
	 * Быстрый emit без проверок для максимальной производительности
	 */
	emitFast<Ev extends keyof EmitEvents>(
		event: Ev,
		data?: Parameters<EmitEvents[Ev]>[0]
	): boolean {
		const targetSockets = this.getTargetSockets();
		if (targetSockets.size === 0) return true;

		const useBinary = this.flags.binary;
		let success = true;

		for (const socketId of targetSockets) {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket && socket.connected && socket.ws.readyState === 1) {
				try {
					if (useBinary) {
						if (!socket.emitBinary(event, data)) success = false;
					} else {
						if (!socket.emitFast(event as string, data as string)) success = false;
					}
				} catch {
					success = false;
				}
			}
		}

		return success;
	}

	/**
	 * Batch операции для broadcast
	 */
	emitBatch<Ev extends keyof EmitEvents>(
		operations: Array<{
			event: Ev;
			data?: Parameters<EmitEvents[Ev]>[0];
			rooms?: Room | Room[];
			binary?: boolean;
		}>
	): number {
		let successful = 0;

		for (const op of operations) {
			try {
				let operator = this;

				if (op.rooms) {
					operator = this.to(op.rooms);
				}

				if (op.binary) {
					operator = operator.binary;
				}

				if (operator.emitFast(op.event, op.data)) {
					successful++;
				}
			} catch (error) {
				continue;
			}
		}

		return successful;
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
	 * Get all matching socket instances
	 */
	fetchSockets(): Promise<any[]> {
		const targetSockets = this.getTargetSockets();
		const sockets: any[] = [];

		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket) {
				sockets.push({
					id: socket.id,
					handshake: socket.handshake,
					rooms: new Set(socket.rooms),
					data: socket.data,
					emit: socket.emit.bind(socket),
					emitWithAck: socket.emitWithAck.bind(socket),
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

	private sanitizeData(data: any, seen = new WeakSet()): any {
		if (data === null || data === undefined) return data;

		if (typeof data === 'function') return undefined;

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
}

/**
 * Упрощенный RemoteSocket под новый API
 */
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

	get binary(): BroadcastOperator<EmitEvents, SocketData> {
		return this.operator.binary;
	}

	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean {
		return this.operator.emit(event, ...args);
	}

	emitWithAck(
		event: string,
		data: any,
		callback: AckCallback,
		options?: { timeout?: number; priority?: 'low' | 'normal' | 'high' }
	): boolean {
		// Получаем реальный сокет и используем его метод
		const adapter = (this.operator as any).adapter;
		const socket = adapter.nsp.sockets.get(this.id);
		if (socket) {
			return socket.emitWithAck(event, data, callback, options);
		}
		return false;
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
