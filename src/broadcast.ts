import type {
	ServerToClientEvents,
	SocketId,
	Room,
	AckCallback,
	EventsMap,
	DefaultEventsMap,
	SocketData as DefaultSocketData,
} from '../types/socket.types';
import type { Adapter } from './adapter';
import { BinaryProtocol, SocketParser } from './parser';

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
 * Simplified BroadcastOperator with only emit and emitWithAck
 */
export class BroadcastOperator<
	EmitEvents extends EventsMap = ServerToClientEvents,
	SocketData extends DefaultSocketData = DefaultSocketData
> {
	private rooms: Set<Room> = new Set();
	private exceptRooms: Set<Room> = new Set();
	private exceptSockets: Set<SocketId> = new Set();
	private flags: BroadcastFlags = {};

	constructor(private adapter: Adapter) {}

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
	 * Exclude specific room(s) or socket(s)
	 */
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		const operator = this.clone();
		const rooms = Array.isArray(room) ? room : [room];
		rooms.forEach((r) => {
			if (typeof r === 'string' && (r.length === 20 || r.includes('_'))) {
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
	 * Set binary flag for forced binary protocol usage
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
	 * Main emit method with full Socket.IO compatibility
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
		let data: any;

		// Handle different call signatures
		if (typeof dataOrArg === 'function') {
			ack = dataOrArg;
			data = undefined;
		} else {
			data = dataOrArg;
			if (data && typeof data === 'object') {
				data = this.sanitizeData(data);
			}
		}

		// Handle acknowledgement callback
		if (typeof ack === 'function') {
			return this.emitWithAck(event as string, data, ack, {
				timeout: this.flags.timeout,
				priority: this.flags.priority,
				binary: this.flags.binary,
			});
		}

		const targetSockets = this.getTargetSockets();
		if (targetSockets.size === 0) return true;

		let success = true;

		for (const socketId of targetSockets) {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket && socket.connected && socket.ws.readyState === 1) {
				if (!this.sendToSocket(socket, event, data, undefined, this.flags.binary)) {
					success = false;
				}
			} else {
				success = false;
			}
		}

		return success;
	}

	/**
	 * Emit with acknowledgement callback
	 */
	emitWithAck(
		event: string,
		data: any,
		callback: AckCallback,
		options: {
			timeout?: number;
			priority?: 'low' | 'normal' | 'high';
			binary?: boolean;
		} = {}
	): boolean {
		const targetSockets = this.getTargetSockets();

		if (targetSockets.size === 0) {
			setTimeout(() => callback(null, []), 0);
			return true;
		}

		const ackId = SocketParser.generateAckId();
		const responses: any[] = [];
		let responseCount = 0;
		let timedOut = false;
		const expectedResponses = targetSockets.size;

		let timeout = options.timeout || this.flags.timeout;
		if (!timeout) {
			switch (options.priority) {
				case 'high':
					timeout = 1000;
					break;
				case 'low':
					timeout = 15000;
					break;
				default:
					timeout = 5000;
					break;
			}
		}

		const timer = setTimeout(() => {
			if (!timedOut) {
				timedOut = true;
				this.cleanupAckCallbacks(targetSockets, ackId);
				callback(new Error('Broadcast acknowledgement timeout'), responses);
			}
		}, timeout);

		const sharedCallback = (socketId: string) => (err: any, responseData: any) => {
			if (timedOut) return;

			responses.push(
				err ? { socketId, error: err.message || err } : { socketId, data: responseData }
			);
			responseCount++;

			if (responseCount >= expectedResponses) {
				timedOut = true;
				clearTimeout(timer);
				callback(null, responses);
			}
		};

		// Register callbacks and send messages
		let success = true;
		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket) {
				socket.ackCallbacks.set(ackId, {
					callback: sharedCallback(socketId),
					timeoutId: timer,
					createdAt: Date.now(),
				});

				if (!this.sendToSocket(socket, event, data, ackId, options.binary)) {
					success = false;
				}
			} else {
				responses.push({ socketId, error: 'Socket not found' });
				responseCount++;
			}
		});

		return success;
	}

	/**
	 * Send message to individual socket
	 */
	private sendToSocket(
		socket: any,
		event: any,
		data: any,
		ackId?: string,
		useBinary?: boolean
	): boolean {
		try {
			// Use binary protocol if requested and supported
			if (useBinary && !ackId && BinaryProtocol.supportsBinaryEncoding(event as string)) {
				if (
					socket.emitBinary &&
					(typeof data === 'string' || typeof data === 'number' || !data)
				) {
					return socket.emitBinary(event, data);
				}
			}

			// Standard emit
			if (ackId) {
				const packet = SocketParser.encode(event, data, ackId, socket.nsp);
				return socket.ws.send(packet) > 0;
			} else {
				return socket.emit(event, data);
			}
		} catch (error) {
			if (!isProduction) {
				console.warn(`[BroadcastOperator] Failed to send to socket ${socket.id}:`, error);
			}
			return false;
		}
	}

	/**
	 * Send a message (alias for emit with 'message' event)
	 */
	send(...args: Parameters<EmitEvents[any]>): boolean {
		return this.emit('message' as any, ...args);
	}

	/**
	 * Write a message (alias for send)
	 */
	write(...args: Parameters<EmitEvents[any]>): boolean {
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
					emitWithAck: socket.emitWithAck?.bind(socket),
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
	 * Clean up ACK callbacks for timed out broadcasts
	 */
	private cleanupAckCallbacks(targetSockets: Set<SocketId>, ackId: string): void {
		targetSockets.forEach((socketId) => {
			const socket = this.adapter.nsp.sockets.get(socketId);
			if (socket && socket.ackCallbacks.has(ackId)) {
				socket.ackCallbacks.delete(ackId);
			}
		});
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

	/**
	 * Sanitize data to remove functions and circular references
	 */
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
