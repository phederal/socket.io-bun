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
import type { Adapter } from './adapter';

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

	constructor(private adapter: Adapter<any, EmitEvents, any, SocketData>) {}

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
	 * Typed emit event to targeted sockets
	 */
	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		data: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	emit<Ev extends keyof EmitEvents>(event: Ev, dataOrArg?: any, ack?: AckCallback): boolean {
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
			}

			// Handle acknowledgement callback
			if (typeof ack === 'function') {
				ackId = SocketParser.generateAckId();

				// For broadcast acknowledgements, we need to track multiple responses
				const responses: any[] = [];
				const targetSockets = this.getTargetSockets();
				let responseCount = 0;
				const expectedResponses = targetSockets.size;

				if (expectedResponses === 0) {
					// No target sockets, call ack immediately
					ack(null, []);
					return true;
				}

				const timeout = this.flags.timeout || 5000;
				const timer = setTimeout(() => {
					ack!(new Error('Broadcast acknowledgement timeout'), responses);
				}, timeout);

				// Register callback for each target socket
				targetSockets.forEach((socketId) => {
					const socket = this.adapter.nsp.sockets.get(socketId);
					if (socket) {
						socket.ackCallbacks.set(ackId!, (err: any, responseData: any) => {
							if (err) {
								responses.push({ socketId, error: err.message || err });
							} else {
								responses.push({ socketId, data: responseData });
							}

							responseCount++;
							if (responseCount >= expectedResponses) {
								clearTimeout(timer);
								ack!(null, responses);
							}
						});
					}
				});
			}

			const packet = SocketParser.encode(event as any, data, ackId);

			// Calculate except sockets including rooms
			const allExceptSockets = new Set(this.exceptSockets);
			for (const room of this.exceptRooms) {
				const roomSockets = this.adapter.getSockets(new Set([room]));
				roomSockets.forEach((sid) => allExceptSockets.add(sid));
			}

			this.adapter.broadcast(packet, {
				rooms: this.rooms.size > 0 ? this.rooms : undefined,
				except: allExceptSockets.size > 0 ? allExceptSockets : undefined,
				flags: this.flags,
			});

			return true;
		} catch (error) {
			console.error('[BroadcastOperator] Emit error:', error);
			return false;
		}
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

/**
 * Expose of subset of the attributes and methods of the Socket class
 */
export class RemoteSocket<
	EmitEvents extends EventsMap = ServerToClientEvents,
	SocketData = DefaultSocketData
> {
	public readonly id: SocketId;
	public readonly handshake: any;
	public readonly rooms: Set<Room>;
	public readonly data: SocketData;

	private readonly operator: BroadcastOperator<EmitEvents, SocketData>;

	constructor(adapter: Adapter<any, EmitEvents, any, SocketData>, details: any) {
		this.id = details.id;
		this.handshake = details.handshake;
		this.rooms = new Set(details.rooms);
		this.data = details.data;
		this.operator = new BroadcastOperator<EmitEvents, SocketData>(adapter);

		// Target this specific socket
		this.operator['exceptSockets'] = new Set();
		this.operator['rooms'] = new Set([this.id]);
	}

	/**
	 * Adds a timeout in milliseconds for the next operation.
	 */
	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return this.operator.timeout(timeout);
	}

	/**
	 * Typed emit to this remote socket
	 */
	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean {
		return this.operator.emit(event, ...args);
	}

	/**
	 * Joins a room.
	 */
	join(room: Room | Room[]): void {
		return this.operator.socketsJoin(room);
	}

	/**
	 * Leaves a room.
	 */
	leave(room: Room): void {
		return this.operator.socketsLeave(room);
	}

	/**
	 * Disconnects this client.
	 */
	disconnect(close = false): this {
		this.operator.disconnectSockets(close);
		return this;
	}
}
