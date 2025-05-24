/**
 * Socket.IO Types for Client-Server Communication
 * Based on Socket.IO v4+ typing standards
 */

// Base event interface - events are functions that can be called
export interface EventsMap {
	[event: string]: (...args: any[]) => void;
}

// Default events map allowing any events
export interface DefaultEventsMap {
	[event: string]: (...args: any[]) => void;
}

// Inter-server events for clustering (optional)
export interface InterServerEvents extends EventsMap {
	ping: () => void;
}

// Socket data type for socket.data attribute
export interface SocketData {
	user?: {
		id: string;
		name?: string;
		email?: string;
	};
	session?: {
		id: string;
		[key: string]: any;
	};
	[key: string]: any;
}

// Base constraint for socket data - ensures it extends our base SocketData
export type SocketDataConstraint = SocketData;

// ==== Define your application events here ====

// Events that clients can send to server
export interface ClientToServerEvents extends EventsMap {
	// Basic events
	ping: () => void;

	// Messaging
	message: (data: string) => void;
	chat_message: (data: { room: string; message: string }) => void;

	// Room management
	join_room: (room: string) => void;
	leave_room: (room: string) => void;

	// Example with acknowledgment
	// get_user_info: (callback: (data: { id: string; name: string }) => void) => void;
	get_user_info: (data: any, callback: (response: { id: string; name: string }) => void) => void;

	// Example with multiple parameters
	update_position: (x: number, y: number, z: number) => void;

	// Custom events for your app
	typing_start: (room: string) => void;
	typing_stop: (room: string) => void;
}

// Events that server can send to clients
export interface ServerToClientEvents extends EventsMap {
	// Basic events
	pong: () => void;

	// Messaging
	message: (data: string) => void;
	chat_message: (data: {
		from: string;
		room: string;
		message: string;
		timestamp: string;
	}) => void;

	// Room management
	room_joined: (room: string) => void;
	room_left: (room: string) => void;
	user_joined: (data: { userId: string; room: string }) => void;
	user_left: (data: { userId: string; room: string }) => void;

	// Notifications
	notification: (message: string) => void;
	error: (error: { code: number; message: string }) => void;

	// Real-time updates
	position_update: (data: { userId: string; x: number; y: number; z: number }) => void;

	// Typing indicators
	user_typing: (data: { userId: string; room: string }) => void;
	user_stopped_typing: (data: { userId: string; room: string }) => void;
}

// Socket packet structure
export interface SocketPacketFromClient {
	event: keyof ClientToServerEvents;
	data?: any;
	ackId?: string;
}

export interface SocketPacketToClient {
	event: keyof ServerToClientEvents;
	data?: any;
	ackId?: string;
}

// Acknowledgement callback type
export type AckCallback = (...args: any[]) => void;

// Acknowledgement map for tracking callbacks
export type AckMap = Map<string, AckCallback>;

// Socket connection states
export type SocketState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

// Disconnect reasons
export type DisconnectReason =
	| 'transport error'
	| 'transport close'
	| 'forced close'
	| 'ping timeout'
	| 'parse error'
	| 'server shutting down'
	| 'forced server close'
	| 'client namespace disconnect'
	| 'server namespace disconnect';

// Room and socket ID types
export type SocketId = string;
export type Room = string;

// Handshake data
export interface Handshake {
	headers: Record<string, string>;
	time: string;
	address: string;
	xdomain: boolean;
	secure: boolean;
	issued: number;
	url: string;
	query: Record<string, string>;
	auth: Record<string, any>;
}
