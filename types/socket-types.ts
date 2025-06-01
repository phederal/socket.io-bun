import type { NamespaceReservedEventsMap } from '@/namespace';
import type { IncomingHttpHeaders } from 'http';
import type { ParsedUrlQuery } from 'querystring';
import type { EventsMap } from './typed-events';

export type Room = string;

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

	// Acknowledgment examples - note the callback as last parameter
	get_user_info: (callback: (data: { id: string; name: string }) => void) => void;
	request_data: (requestId: string, callback: (data: any) => void) => void;

	// Multiple parameter events
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
	chat_message: (data: { from: string; room: string; message: string; timestamp: string }) => void;

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

	// Server->Client acknowledgment examples
	server_ping: (callback: (pong: string) => void) => void;
	get_client_info: (callback: (info: { id: string; rooms: string[] }) => void) => void;
	check_status: (callback: () => void) => void;
}

// Socket packet structure
export interface SocketPacketFromClient {
	event: keyof ClientToServerEvents | '__ack';
	data?: any;
	ackId?: string;
	namespace?: string;
}

export interface SocketPacketToClient {
	event: keyof ServerToClientEvents | '__ack';
	data?: any;
	ackId?: string;
}

// Acknowledgement callback type
export type AckCallback = (error?: Error | null, ...args: any[]) => void;

// Acknowledgement map for tracking callbacks
export type AckMap = Map<string, AckCallback>;

// Socket connection states
export type SocketState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

/**
 * Next: From socket.io socket-types.ts
 * @link https://github.com/socketio/socket.io/blob/main/packages/socket.io/lib/socket-types.ts
 */

type ClientReservedEvents = 'connect_error';

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

export interface SocketReservedEventsMap {
	disconnect: (reason: DisconnectReason, description?: any) => void;
	disconnecting: (reason: DisconnectReason, description?: any) => void;
	error: (err: Error) => void;
}

// EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
export interface EventEmitterReservedEventsMap {
	newListener: (eventName: string | Symbol, listener: (...args: any[]) => void) => void;
	removeListener: (eventName: string | Symbol, listener: (...args: any[]) => void) => void;
}

export const RESERVED_EVENTS: ReadonlySet<string | Symbol> = new Set<
	ClientReservedEvents | keyof NamespaceReservedEventsMap<never, never, never, never> | keyof SocketReservedEventsMap | keyof EventEmitterReservedEventsMap
>(<const>['connect', 'connect_error', 'disconnect', 'disconnecting', 'newListener', 'removeListener']);

/**
 * The handshake details
 */
export interface Handshake {
	/**
	 * The headers sent as part of the handshake
	 */
	// headers: IncomingHttpHeaders;
	headers: Record<string, string>;
	/**
	 * The date of creation (as string)
	 */
	time: string;
	/**
	 * The ip of the client
	 */
	address: string;
	/**
	 * Whether the connection is cross-domain
	 */
	xdomain: boolean;
	/**
	 * Whether the connection is secure
	 */
	secure: boolean;
	/**
	 * The date of creation (as unix timestamp)
	 */
	issued: number;
	/**
	 * The request URL string
	 */
	url: string;
	/**
	 * The query object
	 */
	query: ParsedUrlQuery;
	/**
	 * The auth object
	 */
	auth: { [key: string]: any };
}
