import { EventEmitter } from 'events';
import type {
	SocketId,
	Room,
	EventsMap,
	DefaultEventsMap,
	SocketData as DefaultSocketData,
} from '../shared/types/socket.types';

const isProduction = process.env.NODE_ENV === 'production';

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
export class Adapter<
	ListenEvents extends EventsMap = DefaultEventsMap,
	EmitEvents extends EventsMap = DefaultEventsMap,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData = DefaultSocketData
> extends EventEmitter {
	private rooms: Map<Room, Set<SocketId>> = new Map();
	private sids: Map<SocketId, Set<Room>> = new Map();

	constructor(public readonly nsp: any) {
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
	 * Broadcast packet using direct socket sending and Bun's publish
	 */
	broadcast(packet: Uint8Array, opts: BroadcastOptions = {}): void {
		const { rooms, except, flags } = opts;

		try {
			// Get target sockets
			let targetSockets: Set<SocketId>;

			if (!rooms || rooms.size === 0) {
				// Broadcast to all sockets in namespace
				targetSockets = this.getSockets();
			} else {
				// Broadcast to specific rooms
				targetSockets = this.getSockets(rooms);
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
						this.removeSocketFromAllRooms(socketId);
						this.nsp.sockets.delete(socketId);
					}
				} else if (socket && !socket.connected) {
					// Clean up disconnected socket
					this.removeSocketFromAllRooms(socketId);
					this.nsp.sockets.delete(socketId);
				}
			}

			// Also use Bun's publish for redundancy (if server is set)
			if (this.nsp.server && this.nsp.server.publish) {
				if (!rooms || rooms.size === 0) {
					const topic = `namespace:${this.nsp.name}`;
					this.nsp.server.publish(topic, packet);
				} else {
					for (const room of rooms) {
						const topic = `room:${this.nsp.name}:${room}`;
						this.nsp.server.publish(topic, packet);
					}
				}
			}
		} catch (error) {
			if (!isProduction) {
				console.error('[Adapter] Broadcast error:', error);
			}
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
	 * Get all sockets in namespace
	 */
	getAllSockets(): Set<SocketId> {
		return new Set(this.sids.keys());
	}

	/**
	 * Get room members
	 */
	getRoomMembers(room: Room): Set<SocketId> {
		return this.rooms.get(room) || new Set();
	}

	/**
	 * Clean up adapter
	 */
	close(): void {
		this.rooms.clear();
		this.sids.clear();
		this.removeAllListeners();
	}

	/**
	 * Debug information
	 */
	getDebugInfo() {
		return {
			roomsCount: this.rooms.size,
			socketsCount: this.sids.size,
			rooms: Array.from(this.rooms.keys()),
			sockets: Array.from(this.sids.keys()),
		};
	}
}
