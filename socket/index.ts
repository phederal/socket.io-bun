// Main exports
import { io } from './server';
export { io, SocketServer } from './server';
export { Socket } from './socket';
export { Namespace } from './namespace';
export { BroadcastOperator } from './broadcast';
export { Adapter } from './adapter';
export { SocketParser } from './parser';

// WebSocket integration
export { wsUpgrade, websocket } from '../ws';

// Types
export type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketPacketFromClient,
	SocketPacketToClient,
	SocketId,
	Room,
	AckCallback,
	AckMap,
	DisconnectReason,
	Handshake,
	SocketData,
	EventsMap,
	DefaultEventsMap,
} from '../shared/types/socket.types';

// Convenience function to create namespace
export function createNamespace(name: string) {
	return io.of(name);
}

// Convenience function to get default namespace
export function getDefaultNamespace() {
	return io.sockets;
}
