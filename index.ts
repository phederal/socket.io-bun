// Main Server class export
export { Server } from './src/index';

// Core classes
export { Socket } from './src/socket';
export { Client } from './src/client';
export { Namespace } from './src/namespace';
export { ParentNamespace } from './src/parent-namespace';
export { BroadcastOperator } from './src/broadcast';

// Adapters
export { Adapter, SessionAwareAdapter } from './src/socket.io-adapter';

// Engine.IO classes
export { Server as EngineServer, Socket as RawSocket, Transport } from './src/engine.io/index';

// Test utilities
export { TestEnvironment, createTestEnv } from './test/utils/test-env';

// === TYPE EXPORTS ===
// Core types from main server
export type { DisconnectReason, DefaultEventsMap, ExtendedError, Event, ServerOptions } from './src/index';

// Socket and namespace types
export type { SocketReservedEventsMap, Handshake } from './types/socket-types';

// Adapter types
export type { SocketId, PrivateSessionId, Room, BroadcastFlags, BroadcastOptions, Session } from './src/socket.io-adapter';

// Typed events system
export type {
	EventsMap,
	DefaultEventsMap as DefaultEvents,
	EventNames,
	EventParams,
	EventNamesWithAck,
	EventNamesWithoutAck,
	StrictEventEmitter,
	TypedEventBroadcaster,
	DecorateAcknowledgements,
	DecorateAcknowledgementsWithMultipleResponses,
	DecorateAcknowledgementsWithTimeoutAndMultipleResponses,
	RemoveAcknowledgements,
} from './types/typed-events';

// Namespace reserved events
export type { NamespaceReservedEventsMap, ServerReservedEventsMap } from './src/namespace';

// Default export - just the Server class
export { Server as default } from './src/index';
