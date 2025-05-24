import { EventEmitter } from 'events';
import type {
	SocketId,
	Room,
	ClientToServerEvents,
	ServerToClientEvents,
	DefaultEventsMap,
	SocketData,
} from '../shared/types/socket.types';
import type { Socket } from './socket';
import type { Namespace } from './namespace';

export interface BroadcastOptions {
	rooms?: Set<Room>;
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
export class Adapter extends EventEmitter {
	private rooms: Map<Room, Set<SocketId>> = new Map();
	private sids: Map<SocketId, Set<Room>> = new Map();

	constructor(
		public readonly nsp: Namespace<
			ClientToServerEvents,
			ServerToClientEvents,
			DefaultEventsMap,
			SocketData
		>
	) {
		super();
	}

	/**
	 * Add socket to a room
	 */
	addSocket(socketId: SocketId, room: Room): void {
		// Add to sids map
		if (!this.sids.has(socketId)) {
			this.sids.set(socketId, new Set());
		}
		this.sids.get(socketId)!.add(room);

		// Add to rooms map
		if (!this.rooms.has(room)) {
			this.rooms.set(room, new Set());
			this.emit('create-room', room);
		}

		if (!this.rooms.get(room)!.has(socketId)) {
			this.rooms.get(room)!.add(socketId);
			this.emit('join-room', room, socketId);
		}
	}

	/**
	 * Remove socket from a room
	 */
	removeSocket(socketId: SocketId, room: Room): void {
		// Remove from sids
		if (this.sids.has(socketId)) {
			this.sids.get(socketId)!.delete(room);
			if (this.sids.get(socketId)!.size === 0) {
				this.sids.delete(socketId);
			}
		}

		// Remove from rooms
		if (this.rooms.has(room)) {
			const roomSockets = this.rooms.get(room)!;
			const removed = roomSockets.delete(socketId);

			if (removed) {
				this.emit('leave-room', room, socketId);
			}

			if (roomSockets.size === 0) {
				this.rooms.delete(room);
				this.emit('delete-room', room);
			}
		}
	}

	/**
	 * Remove socket from all rooms
	 */
	removeSocketFromAllRooms(socketId: SocketId): void {
		if (this.sids.has(socketId)) {
			const rooms = Array.from(this.sids.get(socketId)!);
			rooms.forEach((room) => this.removeSocket(socketId, room));
		}
	}

	/**
	 * Get all sockets in room(s)
	 */
	getSockets(rooms?: Set<Room>): Set<SocketId> {
		const result = new Set<SocketId>();

		if (!rooms || rooms.size === 0) {
			// Return all sockets
			for (const socketId of this.sids.keys()) {
				result.add(socketId);
			}
		} else {
			// Return sockets in specified rooms
			for (const room of rooms) {
				if (this.rooms.has(room)) {
					for (const socketId of this.rooms.get(room)!) {
						result.add(socketId);
					}
				}
			}
		}

		return result;
	}

	/**
	 * Get rooms for a socket
	 */
	getSocketRooms(socketId: SocketId): Set<Room> {
		return this.sids.get(socketId) || new Set();
	}

	/**
	 * Broadcast packet using Bun's publish
	 */
	broadcast(packet: Uint8Array, opts: BroadcastOptions = {}): void {
		const { rooms, except, flags } = opts;

		try {
			if (!rooms || rooms.size === 0) {
				// Broadcast to entire namespace
				const topic = `namespace:${this.nsp.name}`;

				if (except && except.size > 0) {
					// Need to send individually to exclude some sockets
					const allSockets = this.getSockets();
					for (const socketId of allSockets) {
						if (!except.has(socketId)) {
							const socket: Socket | undefined = this.nsp.sockets.get(socketId);
							if (socket && socket.connected) {
								socket['ws'].send(packet);
							}
						}
					}
				} else {
					// Use Bun's publish for efficient broadcasting
					this.nsp.server.publish(topic, packet);
				}
			} else {
				// Broadcast to specific rooms
				for (const room of rooms) {
					const topic = `room:${this.nsp.name}:${room}`;

					if (except && except.size > 0) {
						// Send individually to exclude some sockets
						const roomSockets = this.rooms.get(room);
						if (roomSockets) {
							for (const socketId of roomSockets) {
								if (!except.has(socketId)) {
									const socket: Socket | undefined =
										this.nsp.sockets.get(socketId);
									if (socket && socket.connected) {
										socket['ws'].send(packet);
									}
								}
							}
						}
					} else {
						// Use Bun's publish
						this.nsp.server.publish(topic, packet);
					}
				}
			}
		} catch (error) {
			console.error('[Adapter] Broadcast error:', error);
		}
	}

	/**
	 * Get number of sockets in room
	 */
	getRoomSize(room: Room): number {
		return this.rooms.get(room)?.size || 0;
	}

	/**
	 * Get all rooms
	 */
	getRooms(): Set<Room> {
		return new Set(this.rooms.keys());
	}

	/**
	 * Check if room exists
	 */
	hasRoom(room: Room): boolean {
		return this.rooms.has(room);
	}

	/**
	 * Clean up adapter
	 */
	close(): void {
		this.rooms.clear();
		this.sids.clear();
		this.removeAllListeners();
	}
}
