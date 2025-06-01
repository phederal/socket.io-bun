import { EventEmitter } from 'events';
import debugModule from 'debug';
import type { SocketData as DefaultSocketData } from '../types/socket-types';
import type { Socket } from './socket';
import type { Namespace } from './namespace';
import type { DefaultEventsMap, EventsMap } from '#types/typed-events';
import { debugConfig } from '../config';
import { yeast } from './socket.io-adapter/yeast';

const debug = debugModule('socket.io:adapter');
debug.enabled = debugConfig.adapter;

const SEPARATOR = '\x1f'; // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text

/**
 * A public ID, sent by the server at the beginning of the Socket.IO session and which can be used for private messaging
 */
export type SocketId = string;
/**
 * A private ID, sent by the server at the beginning of the Socket.IO session and used for connection state recovery
 * upon reconnection
 */
export type PrivateSessionId = string;

// we could extend the Room type to "string | number", but that would be a breaking change
// related: https://github.com/socketio/socket.io-redis-adapter/issues/418
export type Room = string;

export interface BroadcastFlags {
	volatile?: boolean;
	compress?: boolean;
	local?: boolean;
	broadcast?: boolean;
	binary?: boolean;
	timeout?: number;
}

export interface BroadcastOptions {
	rooms: Set<Room>;
	except?: Set<SocketId>;
	flags?: BroadcastFlags;
	sender?: Socket;
}

interface SessionToPersist {
	sid: SocketId;
	pid: PrivateSessionId;
	rooms: Room[];
	data: unknown;
}

export type Session = SessionToPersist & { missedPackets: unknown[][] };

export class Adapter extends EventEmitter {
	private rooms: Map<Room, Set<SocketId>> = new Map();
	private sids: Map<SocketId, Set<Room>> = new Map();
	private readonly encoder;

	/**
	 * In-memory adapter constructor.
	 *
	 * @param {Namespace} nsp
	 */
	constructor(readonly nsp: Namespace<any, any, any, DefaultSocketData>) {
		super();
		this.encoder = nsp.server.encoder;
	}

	/**
	 * To be overridden
	 */
	public init(): Promise<void> | void {}
	public close(): Promise<void> | void {}
	public serverCount(): Promise<number> {
		return Promise.resolve(1);
	}

	/**
	 * Adds a socket to a list of room.
	 *
	 * @param {SocketId} id     the socket id
	 * @param {Set<Room>} rooms   a set of rooms
	 * @public
	 */
	addAll(id: SocketId, rooms: Set<Room>): Promise<void> | void {
		const isNew = !this.sids.has(id);
		const socket = this.nsp.sockets.get(id);
		if (!socket) return;

		if (isNew) {
			this.sids.set(id, new Set());
			debug('subscribe connection %s to topic %s', socket.id, this.nsp.name);
			socket.ws.subscribe(this.nsp.name);
		}

		for (const room of rooms) {
			const topic = `${this.nsp.name}${SEPARATOR}${room}`; // '#' can be used as wildcard

			this.sids.get(id)!.add(room);

			if (!this.rooms.has(room)) {
				this.rooms.set(room, new Set());
				this.emit('create-room', room);
			}

			if (!this.rooms.get(room)!.has(id)) {
				this.rooms.get(room)!.add(id);
				this.emit('join-room', room, id);
			}

			if (!socket.ws.isSubscribed(topic)) {
				debug('subscribe connection %s to topic %s', socket.id, topic);
				socket.ws.subscribe(topic);
			}
		}
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
		if (!deleted) return; // Socket wasn't in room

		if (deleted) {
			this.emit('leave-room', room, id);
		}

		if (roomSockets.size === 0 && this.rooms.delete(room)) {
			this.emit('delete-room', room);
		}

		/** compatible with bun pub/sub */
		const socket = this.nsp.sockets.get(id);
		if (socket) {
			const topic = `${this.nsp.name}${SEPARATOR}${room}`;
			if (socket.ws.isSubscribed(topic)) {
				debug('unsubscribe connection %s from topic %s', socket.id, topic);
				socket.ws.unsubscribe(topic);
			}
		}
	}

	/**
	 * Broadcasts a packet.
	 *
	 * Options:
	 *  - `flags` {Object} flags for this packet
	 *  - `except` {Array} sids that should be excluded
	 *  - `rooms` {Array} list of rooms to broadcast to
	 *
	 * @param {Object} packet   the packet object
	 * @param {Object} opts     the options
	 * @public
	 */
	broadcast(packet: any, opts: BroadcastOptions): void {
		// TODO: Remake this with using engine.io-parser encoder for encode packets from client or server.publish

		const flags = opts.flags || {};
		const packetOpts = {
			preEncoded: true,
			volatile: flags.volatile,
			compress: flags.compress,
		};

		packet.nsp = this.nsp.name;
		const encodedPackets = this.encoder.encode(packet);

		if (opts.except!.size > 0) {
			return this.apply(opts, (socket) => {
				if (typeof socket.notifyOutgoingListeners === 'function') {
					socket.notifyOutgoingListeners(packet);
				}
				socket.client.writeToEngine(encodedPackets, packetOpts);
			});
		} else {
			/** compatible with bun pub/sub */
			if (opts.rooms.size <= 1) {
				const topic = opts.rooms.size === 0 ? this.nsp.name : `${this.nsp.name}${SEPARATOR}${opts.rooms.keys().next().value}`;
				encodedPackets.forEach((encodedPacket) => {
					const isBinary = typeof encodedPacket !== 'string';
					// "4" being the message type in the Engine.IO protocol, see https://github.com/socketio/engine.io-protocol
					if (opts.sender?.ws) {
						opts.sender.ws.publish(topic, isBinary ? encodedPacket : '4' + encodedPacket);
					} else {
						this.nsp.server.publish(topic, isBinary ? encodedPacket : '4' + encodedPacket);
					}
				});
				return;
			} else {
				opts.rooms.forEach((room) => {
					const topic = `${this.nsp.name}${SEPARATOR}${room}`;
					encodedPackets.forEach((encodedPacket) => {
						const isBinary = typeof encodedPacket !== 'string';
						if (opts.sender?.ws) {
							opts.sender.ws.publish(topic, isBinary ? encodedPacket : '4' + encodedPacket);
						} else {
							this.nsp.server.publish(topic, isBinary ? encodedPacket : '4' + encodedPacket);
						}
					});
				});
			}
		}
	}

	/**
	 * Broadcasts a packet and expects multiple acknowledgements.
	 *
	 * Options:
	 *  - `flags` {Object} flags for this packet
	 *  - `except` {Array} sids that should be excluded
	 *  - `rooms` {Array} list of rooms to broadcast to
	 *
	 * @param {Object} packet   the packet object
	 * @param {Object} opts     the options
	 * @param clientCountCallback - the number of clients that received the packet
	 * @param ack                 - the callback that will be called for each client response
	 *
	 * @public
	 */
	broadcastWithAck(
		/** strict types */
		packet: any,
		opts: BroadcastOptions,
		clientCountCallback: (clientCount: number) => void,
		ack: (...args: any[]) => void,
	) {
		const flags = opts.flags || {};
		const packetOpts = {
			preEncoded: true,
			volatile: flags.volatile,
			compress: flags.compress,
		};

		packet.nsp = this.nsp.name;
		// we can use the same id for each packet, since the _ids counter is common (no duplicate)
		packet.id = this.nsp._ids++;

		const encodedPackets = this.encoder.encode(packet);

		let clientCount = 0;

		this.apply(opts, (socket) => {
			// track the total number of acknowledgements that are expected
			clientCount++;
			// call the ack callback for each client response
			socket['acks'].set(packet.id, ack);
			if (typeof socket.notifyOutgoingListeners === 'function') {
				socket.notifyOutgoingListeners(packet);
			}
			socket.client.writeToEngine(encodedPackets, packetOpts);
		});

		clientCountCallback(clientCount);
	}

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

	/**
	 * Send a packet to the other Socket.IO servers in the cluster
	 * @param packet - an array of arguments, which may include an acknowledgement callback at the end
	 */
	public serverSideEmit(packet: any[]): void {
		console.warn('this adapter does not support the serverSideEmit() functionality');
	}

	/**
	 * Save the client session in order to restore it upon reconnection.
	 */
	public persistSession(session: SessionToPersist) {}

	/**
	 * Restore the session and find the packets that were missed by the client.
	 * @param pid
	 * @param offset
	 */
	public restoreSession(pid: PrivateSessionId, offset: string): Promise<Session> | null {
		return null;
	}
}

// TODO: Add serving files
// const toArrayBuffer = (buffer: Buffer) => {
// 	const { buffer: arrayBuffer, byteOffset, byteLength } = buffer;
// 	return arrayBuffer.slice(byteOffset, byteOffset + byteLength);
// };
// // imported from https://github.com/kolodziejczak-sz/uwebsocket-serve
// export function serveFile(res /* : HttpResponse */, filepath: string) {
// 	const { size } = statSync(filepath);
// 	const readStream = createReadStream(filepath);
// 	const destroyReadStream = () => !readStream.destroyed && readStream.destroy();

// 	const onError = (error: Error) => {
// 		destroyReadStream();
// 		throw error;
// 	};

// 	const onDataChunk = (chunk: Buffer) => {
// 		const arrayBufferChunk = toArrayBuffer(chunk);

// 		res.cork(() => {
// 			const lastOffset = res.getWriteOffset();
// 			const [ok, done] = res.tryEnd(arrayBufferChunk, size);

// 			if (!done && !ok) {
// 				readStream.pause();

// 				res.onWritable((offset) => {
// 					const [ok, done] = res.tryEnd(arrayBufferChunk.slice(offset - lastOffset), size);

// 					if (!done && ok) {
// 						readStream.resume();
// 					}

// 					return ok;
// 				});
// 			}
// 		});
// 	};

// 	res.onAborted(destroyReadStream);
// 	readStream.on('data', onDataChunk).on('error', onError).on('end', destroyReadStream);
// }

interface PersistedPacket {
	id: string;
	emittedAt: number;
	data: unknown[];
	opts: BroadcastOptions;
}

type SessionWithTimestamp = SessionToPersist & { disconnectedAt: number };

export class SessionAwareAdapter extends Adapter {
	private readonly maxDisconnectionDuration: number;

	private sessions: Map<PrivateSessionId, SessionWithTimestamp> = new Map();
	private packets: PersistedPacket[] = [];

	constructor(override readonly nsp: Namespace<any, any, any, DefaultSocketData>) {
		super(nsp);
		this.maxDisconnectionDuration = nsp.server['opts'].connectionStateRecovery!.maxDisconnectionDuration!;

		const timer = setInterval(() => {
			const threshold = Date.now() - this.maxDisconnectionDuration;
			this.sessions.forEach((session, sessionId) => {
				const hasExpired = session.disconnectedAt < threshold;
				if (hasExpired) {
					this.sessions.delete(sessionId);
				}
			});
			for (let i = this.packets.length - 1; i >= 0; i--) {
				const hasExpired = this.packets[i]!.emittedAt < threshold;
				if (hasExpired) {
					this.packets.splice(0, i + 1);
					break;
				}
			}
		}, 60 * 1000);
		// prevents the timer from keeping the process alive
		timer.unref();
	}

	override persistSession(session: SessionToPersist) {
		(session as SessionWithTimestamp).disconnectedAt = Date.now();
		this.sessions.set(session.pid, session as SessionWithTimestamp);
	}

	override restoreSession(pid: PrivateSessionId, offset: string): Promise<Session> | null {
		const session = this.sessions.get(pid);
		if (!session) {
			// the session may have expired
			return null;
		}
		const hasExpired = session.disconnectedAt + this.maxDisconnectionDuration < Date.now();
		if (hasExpired) {
			// the session has expired
			this.sessions.delete(pid);
			return null;
		}
		const index = this.packets.findIndex((packet) => packet.id === offset);
		if (index === -1) {
			// the offset may be too old
			return null;
		}
		const missedPackets = [];
		for (let i = index + 1; i < this.packets.length; i++) {
			const packet = this.packets[i];
			if (shouldIncludePacket(session.rooms, packet!.opts)) {
				missedPackets.push(packet!.data);
			}
		}
		return Promise.resolve({
			...session,
			missedPackets,
		});
	}

	override broadcast(packet: any, opts: BroadcastOptions) {
		const isEventPacket = packet.type === 2;
		// packets with acknowledgement are not stored because the acknowledgement function cannot be serialized and
		// restored on another server upon reconnection
		const withoutAcknowledgement = packet.id === undefined;
		const notVolatile = opts.flags?.volatile === undefined;
		if (isEventPacket && withoutAcknowledgement && notVolatile) {
			const id = yeast();
			// the offset is stored at the end of the data array, so the client knows the ID of the last packet it has
			// processed (and the format is backward-compatible)
			packet.data.push(id);
			this.packets.push({
				id,
				opts,
				data: packet.data,
				emittedAt: Date.now(),
			});
		}
		super.broadcast(packet, opts);
	}
}

function shouldIncludePacket(sessionRooms: Room[], opts: BroadcastOptions): boolean {
	const included = opts.rooms.size === 0 || sessionRooms.some((room) => opts.rooms.has(room));
	const notExcluded = sessionRooms.every((room) => !opts.except!.has(room));
	return included && notExcluded;
}
