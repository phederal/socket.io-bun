import { EventEmitter } from 'events';
import type {
	SocketId,
	Room,
	EventsMap,
	DefaultEventsMap,
	SocketData as DefaultSocketData,
} from '../types/socket.types';
import type { Socket } from './socket';
import type { Namespace } from './namespace';
import debugModule from 'debug';

const debug = debugModule('socket.io:adapter');

const SEPARATOR = '\x1f'; // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text

const isProduction = process.env.NODE_ENV === 'production';

export interface BroadcastOptions {
	rooms: Set<Room>;
	except?: Set<SocketId>;
	flags?: {
		volatile?: boolean;
		compress?: boolean;
		local?: boolean;
		broadcast?: boolean;
	};
}

/**
 * Adapter for managing rooms and broadcasting using Bun's native pub/sub
 */
export class Adapter<
	ListenEvents extends EventsMap = DefaultEventsMap,
	EmitEvents extends EventsMap = DefaultEventsMap,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData
> extends EventEmitter {
	private rooms: Map<Room, Set<SocketId>> = new Map();
	private sids: Map<SocketId, Set<Room>> = new Map();

	constructor(
		public readonly nsp: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
	) {
		super();
	}

	/**
	 * To be overridden
	 */
	private init(): Promise<void> | void {}
	private close(): Promise<void> | void {}
	private serverCount(): Promise<void> | void {}

	/**
	 * Adds a socket to a list of room.
	 *
	 * @param {SocketId} id     the socket id
	 * @param {Set<Room>} rooms   a set of rooms
	 * @public
	 */
	addAll(id: SocketId, rooms: Set<Room>): Promise<void> | void {
		const isNew = !this.sids.has(id);

		if (!this.sids.has(id)) {
			this.sids.set(id, new Set());
		}
		for (const room of rooms) {
			this.sids.get(id)!.add(room);

			if (!this.rooms.has(room)) {
				this.rooms.set(room, new Set());
				this.emit('create-room', room);
			}
			if (!this.rooms.get(room)!.has(id)) {
				this.rooms.get(room)!.add(id);
				this.emit('join-room', room, id);
			}
		}

		/** compatible with bun */
		const socket = this.nsp.sockets.get(id);
		if (!socket) return;
		const sessionId = socket.sessionId;
		if (isNew) {
			debug('subscribe connection %s to topic %s', sessionId, this.nsp.name);
			socket.ws.subscribe(this.nsp.name);
		}
		rooms.forEach((room) => {
			const topic = `${this.nsp.name}${SEPARATOR}${room}`; // '#' can be used as wildcard
			if (!socket.ws.isSubscribed(topic)) {
				debug('subscribe connection %s to topic %s', sessionId, topic);
				socket.ws.subscribe(topic);
			}
		});
	}

	/**
	 * Removes a socket from a room.
	 *
	 * @param {SocketId} id     the socket id
	 * @param {Room}     room   the room name
	 */
	del(id: SocketId, room: Room): void {
		if (this.sids.has(id)) {
			this.sids.get(id)!.delete(room);
			if (this.sids.get(id)!.size === 0) {
				this.sids.delete(id);
			}
		}

		this._del(room, id);
	}

	/**
	 * Removes a socket from all rooms it's joined.
	 *
	 * @param {SocketId} id   the socket id
	 */
	delAll(id: SocketId): void {
		if (!this.sids.has(id)) {
			return;
		}

		for (const room of this.sids.get(id)!) {
			this._del(room, id);
		}

		this.sids.delete(id);
	}

	private _del(room: Room, id: SocketId) {
		const roomSockets = this.rooms.get(room);
		if (roomSockets == null) return;

		const deleted = roomSockets.delete(id);
		if (deleted) {
			this.emit('leave-room', room, id);
		}
		if (roomSockets.size === 0 && this.rooms.delete(room)) {
			this.emit('delete-room', room);
		}

		/** compatible with bun */
		const socket = this.nsp.sockets.get(id);
		if (!socket) return;
		const sessionId = socket.sessionId;
		const topic = `${this.nsp.name}${SEPARATOR}${room}`;
		if (socket.ws.isSubscribed(topic)) {
			debug('unsubscribe connection %s from topic %s', sessionId, topic);
			socket.ws.unsubscribe(topic);
		}
	}

	/**
	 * Broadcast packet using direct socket sending and Bun's publish
	 */
	broadcast(packet: Uint8Array, opts: BroadcastOptions): void {
		const { rooms, except, flags } = opts;
		try {
			// Get target sockets
			let targetSockets: Set<SocketId> = new Set();

			if (!rooms || rooms.size === 0) {
				// Broadcast to all sockets in namespace
				this.fetchSockets(opts).then((ids) =>
					ids.forEach((socket) => targetSockets.add(socket.id))
				);
			} else {
				// Broadcast to specific rooms
				this.sockets(rooms).then((ids) =>
					ids.forEach((socketId) => targetSockets.add(socketId))
				);
			}

			// Remove excepted sockets
			if (except && except.size > 0) {
				for (const socketId of except) {
					targetSockets.delete(socketId);
				}
			}

			// Send to each target socket directly
			for (const socketId of targetSockets) {
				const socket = this.nsp.sockets.get(socketId);
				if (socket && socket.connected && socket.ws.readyState === 1) {
					try {
						// Use direct WebSocket send for reliability
						socket.ws.send(packet);
					} catch (error) {
						if (!isProduction) {
							console.warn(`[Adapter] Failed to send to socket ${socketId}:`, error);
						}
						// Remove disconnected socket
						this.delAll(socketId);
						this.nsp.sockets.delete(socketId);
					}
				} else if (socket && !socket.connected) {
					// Clean up disconnected socket
					this.delAll(socketId);
					this.nsp.sockets.delete(socketId);
				}
			}

			// Also use Bun's publish for redundancy (if server is set)
			if (this.nsp.server && this.nsp.server.publish) {
				const topic =
					opts.rooms.size === 0
						? this.nsp.name
						: `${this.nsp.name}${SEPARATOR}${rooms.keys().next().value}`;

				this.nsp.server.publish(topic, packet);
			}
		} catch (error) {
			if (!isProduction) {
				console.error('[Adapter] Broadcast error:', error);
			}
		}
	}

	// TODO: in next version
	// broadcastWithAck(
	// 	packet: any,
	// 	opts: BroadcastOptions,
	// 	clientCountCallback: (clientCount: number) => void,
	// 	ack: (...args: any[]) => void
	// ) {
	// 	const flags = opts.flags || {};
	// 	const packetOpts = {
	// 		preEncoded: true,
	// 		volatile: flags.volatile,
	// 		compress: flags.compress,
	// 	};

	// 	packet.nsp = this.nsp.name;
	// 	// we can use the same id for each packet, since the _ids counter is common (no duplicate)
	// 	packet.id = this.nsp._ids++;

	// 	const encodedPackets = this._encode(packet, packetOpts);

	// 	let clientCount = 0;

	// 	this.apply(opts, (socket) => {
	// 		// track the total number of acknowledgements that are expected
	// 		clientCount++;
	// 		// call the ack callback for each client response
	// 		socket.acks.set(packet.id, ack);

	// 		if (typeof socket.notifyOutgoingListeners === 'function') {
	// 			socket.notifyOutgoingListeners(packet);
	// 		}

	// 		socket.client.writeToEngine(encodedPackets, packetOpts);
	// 	});

	// 	clientCountCallback(clientCount);
	// }

	/**
	 * Gets a list of sockets by sid.
	 *
	 * @param {Set<Room>} rooms   the explicit set of rooms to check.
	 */
	public sockets(rooms: Set<Room>): Promise<Set<SocketId>> {
		const sids = new Set<SocketId>();

		this.apply({ rooms }, (socket) => {
			sids.add(socket.id);
		});

		return Promise.resolve(sids);
	}

	/**
	 * Gets the list of rooms a given socket has joined.
	 *
	 * @param {SocketId} id   the socket id
	 */
	public socketRooms(id: SocketId): Set<Room> | undefined {
		return this.sids.get(id);
	}

	/**
	 * Returns the matching socket instances
	 *
	 * @param opts - the filters to apply
	 */
	public fetchSockets(opts: BroadcastOptions): Promise<Socket[]> {
		const sockets: Socket[] = [];

		this.apply(opts, (socket) => {
			sockets.push(socket);
		});

		return Promise.resolve(sockets);
	}

	/**
	 * Makes the matching socket instances join the specified rooms
	 *
	 * @param opts - the filters to apply
	 * @param rooms - the rooms to join
	 */
	addSockets(opts: BroadcastOptions, rooms: Room[]): void {
		this.apply(opts, (socket) => {
			socket.join(rooms);
		});
	}

	/**
	 * Makes the matching socket instances leave the specified rooms
	 *
	 * @param opts - the filters to apply
	 * @param rooms - the rooms to leave
	 */
	delSockets(opts: BroadcastOptions, rooms: Room[]): void {
		this.apply(opts, (socket) => {
			rooms.forEach((room) => socket.leave(room));
		});
	}

	/**
	 * Makes the matching socket instances disconnect
	 *
	 * @param opts - the filters to apply
	 * @param close - whether to close the underlying connection
	 */
	disconnectSockets(opts: BroadcastOptions, close: boolean): void {
		this.apply(opts, (socket) => {
			socket.disconnect(close);
		});
	}

	/**
	 * Applies a broadcast operation to all matching sockets
	 * @param opts Options for the broadcast operation
	 * @param callback Callback to apply to each matching socket
	 * @private
	 */
	private apply(opts: BroadcastOptions, callback: (socket: Socket) => void): void {
		const rooms = opts.rooms;
		const except = this.computeExceptSids(opts.except);

		if (rooms.size) {
			const ids = new Set();
			for (const room of rooms) {
				if (!this.rooms.has(room)) continue;

				for (const id of this.rooms.get(room)!) {
					if (ids.has(id) || except.has(id)) continue;
					const socket = this.nsp.sockets.get(id);
					if (socket) {
						callback(socket);
						ids.add(id);
					}
				}
			}
		} else {
			for (const [id] of this.sids) {
				if (except.has(id)) continue;
				const socket = this.nsp.sockets.get(id);
				if (socket) callback(socket);
			}
		}
	}

	private computeExceptSids(exceptRooms?: Set<Room>) {
		const exceptSids = new Set();
		if (exceptRooms && exceptRooms.size > 0) {
			for (const room of exceptRooms) {
				if (this.rooms.has(room)) {
					this.rooms.get(room)!.forEach((sid) => exceptSids.add(sid));
				}
			}
		}
		return exceptSids;
	}
}
