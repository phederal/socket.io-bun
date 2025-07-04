import type { NamespaceReservedEventsMap } from '../src/namespace';
import type { IncomingHttpHeaders } from 'http';
import type { ParsedUrlQuery } from 'querystring';
import type { EventsMap } from './typed-events';

export type DefaultSocketData = Record<string, any>;

/**
 * Next: From socket.io socket-types.ts
 * @link https://github.com/socketio/socket.io/blob/main/packages/socket.io/lib/socket-types.ts
 */

type ClientReservedEvents = 'connect_error';

// Disconnect reasons for server
export type DisconnectReason =
	// Engine.IO close reasons
	| 'transport error'
	| 'transport close'
	| 'forced close'
	| 'ping timeout'
	| 'parse error'
	// Socket.IO disconnect reasons
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
