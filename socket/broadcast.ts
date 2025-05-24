import type {
	ServerToClientEvents,
	SocketId,
	Room,
	AckCallback,
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
 * Broadcast operator for chaining operations
 */
export class BroadcastOperator {
	private rooms: Set<Room> = new Set();
	private exceptRooms: Set<Room> = new Set();
	private exceptSockets: Set<SocketId> = new Set();
	private flags: BroadcastFlags = {};

	constructor(private adapter: Adapter) {}

	/**
	 * Target specific room(s)
	 */
	to(room: Room | Room[]): BroadcastOperator {
		const operator = this.clone();
		const rooms = Array.isArray(room) ? room : [room];
		rooms.forEach((r) => operator.rooms.add(r));
		return operator;
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator {
		return this.to(room);
	}

	/**
	 * Exclude specific room(s)
	 */
	except(room: Room | Room[]): BroadcastOperator {
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
	get volatile(): BroadcastOperator {
		const operator = this.clone();
		operator.flags.volatile = true;
		return operator;
	}

	/**
	 * Set compress flag
	 */
	compress(compress: boolean): BroadcastOperator {
		const operator = this.clone();
		operator.flags.compress = compress;
		return operator;
	}

	/**
	 * Set local flag
	 */
	get local(): BroadcastOperator {
		const operator = this.clone();
		operator.flags.local = true;
		return operator;
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator {
		const operator = this.clone();
		operator.flags.timeout = timeout;
		return operator;
	}

	/**
	 * Emit event to targeted sockets
	 */
	emit<K extends keyof ServerToClientEvents>(
		event: K,
		...args: Parameters<ServerToClientEvents[K]>
	): boolean;
	emit<K extends keyof ServerToClientEvents>(
		event: K,
		data: Parameters<ServerToClientEvents[K]>[0],
		ack?: AckCallback
	): boolean;
	emit<K extends keyof ServerToClientEvents>(
		event: K,
		dataOrArg?: any,
		ack?: AckCallback
	): boolean {
		try {
			let ackId: string | undefined;

			// Handle acknowledgement callback
			if (typeof ack === 'function') {
				ackId = SocketParser.generateAckId();

				// For broadcast acknowledgements, we need to track multiple responses
				// This is simplified - in production you might want more sophisticated handling
				const responses: any[] = [];
				const targetSockets = this.getTargetSockets();
				let responseCount = 0;
				const expectedResponses = targetSockets.size;

				const timeout = this.flags.timeout || 5000;
				const timer = setTimeout(() => {
					ack(new Error('Broadcast acknowledgement timeout'), responses);
				}, timeout);

				// Register callback for each target socket
				targetSockets.forEach((socketId) => {
					const socket = this.adapter.nsp.sockets.get(socketId);
					if (socket) {
						socket['ackCallbacks'].set(ackId!, (err: any, data: any) => {
							if (err) {
								responses.push({ socketId, error: err });
							} else {
								responses.push({ socketId, data });
							}

							responseCount++;
							if (responseCount >= expectedResponses) {
								clearTimeout(timer);
								ack(null, responses);
							}
						});
					}
				});
			}

			const packet = SocketParser.encode(event, dataOrArg, ackId);

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
	send(data: any): boolean {
		return this.emit('message' as any, data);
	}

	/**
	 * Write a message (alias for send)
	 */
	write(data: any): boolean {
		return this.send(data);
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
				sockets.push(socket);
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
	private clone(): BroadcastOperator {
		const operator = new BroadcastOperator(this.adapter);
		operator.rooms = new Set(this.rooms);
		operator.exceptRooms = new Set(this.exceptRooms);
		operator.exceptSockets = new Set(this.exceptSockets);
		operator.flags = { ...this.flags };
		return operator;
	}
}
