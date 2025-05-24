/**
 * Socket.IO Types for Client-Server Communication
 */

// Base event interface
export interface EventsMap {
	[event: string]: (...args: any[]) => void;
}

// Default events map
export interface DefaultEventsMap {
	[event: string]: (...args: any[]) => void;
}

// Example client to server events (replace with your actual events)
export interface ClientToServerEvents extends EventsMap {
	ping: () => void;
	message: (data: string) => void;
	join_room: (room: string) => void;
	leave_room: (room: string) => void;
}

// Example server to client events (replace with your actual events)
export interface ServerToClientEvents extends EventsMap {
	pong: () => void;
	message: (data: string) => void;
	room_joined: (room: string) => void;
	room_left: (room: string) => void;
	notification: (message: string) => void;
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

// Socket data that can be attached
export interface SocketData {
	[key: string]: any;
}
