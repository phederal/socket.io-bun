# Socket.IO-Bun API Reference

This document describes all public classes and functions of the **socket.io-bun** library. The project is a fully typed Socket.IO implementation for the Bun runtime with Hono framework integration.

## Table of Contents

- [Server](#server)
- [Namespace](#namespace)
- [Socket](#socket)
- [BroadcastOperator](#broadcastoperator)
- [Adapter](#adapter)
- [SessionAwareAdapter](#sessionawareadapter)
- [ParentNamespace](#parentnamespace)
- [Client](#client)
- [Connection](#connection)
- [Engine.IO Server](#engineio-server)
- [Engine.IO Socket](#engineio-socket)
- [Engine.IO Transport](#engineio-transport)
- [Parser](#parser)
- [Utilities](#utilities)

## Server

`import { Server } from "socket.io-bun";`

Represents the main Socket.IO server instance.

### Constructor
```ts
new Server(opts?: Partial<ServerOptions>)
```
`ServerOptions` include:
- `path: string` – client path (default `/ws`)
- `adapter: AdapterConstructor` – room adapter class
- `parser: typeof parser` – packet parser
- `connectTimeout: number` – delay before closing a client without namespace
- `connectionStateRecovery` – options for recovering missed packets
- `cleanupEmptyChildNamespaces: boolean`
- `pingTimeout: number`
- `pingInterval: number`
- `transports: 'websocket'`
- `perMessageDeflate: boolean`
- `maxPayload: number`

### Methods
- `path(v?: string): this | string`
- `connectTimeout(v?: number): this | number`
- `adapter(v?: AdapterConstructor): this | AdapterConstructor`
- `listen(srv: BunServer, opts?: Partial<ServerOptions>): void`
- `attach(srv: BunServer, opts?: Partial<ServerOptions>): void`
- `bind(engine: any): this`
- `onconnection(c: Context, data?: SocketData): WSEvents<ServerWebSocket<WSContext>>`
- `publish(topic: string, message: string | Uint8Array): boolean`
- `of(name: string, fn?: (socket: Socket) => void): Namespace`
- `close(fn?: (err?: Error) => void): Promise<void>`
- `use(fn: (socket: Socket, next: (err?: ExtendedError) => void) => void): this`
- `to(room: Room | Room[]): BroadcastOperator`
- `in(room: Room | Room[]): BroadcastOperator`
- `except(room: Room | Room[]): BroadcastOperator`
- `send(...args: EventParams<EmitEvents, 'message'>): this`
- `write(...args: EventParams<EmitEvents, 'message'>): this`
- `compress(compress: boolean): BroadcastOperator`
- `volatile: BroadcastOperator` *(getter)*
- `local: BroadcastOperator` *(getter)*
- `timeout(timeout: number): BroadcastOperator`
- `fetchSockets(): Promise<any[]>`
- `socketsJoin(room: Room | Room[]): void`
- `socketsLeave(room: Room | Room[]): void`
- `disconnectSockets(close?: boolean): void`

## Namespace

Represents a logical channel within the server.

### Constructor
```ts
new Namespace(server: Server, name: string)
```

### Methods
- `_initAdapter(): void`
- `use(fn: (socket: Socket, next: (err?: ExtendedError) => void) => void): this`
- `to(room: Room | Room[]): BroadcastOperator`
- `in(room: Room | Room[]): BroadcastOperator`
- `except(room: Room | Room[]): BroadcastOperator`
- `_add(client: Client, auth: Record<string, unknown>, fn: (socket: Socket) => void): void`
- `fetchSockets(): Promise<Socket[]>`
- `socketsJoin(room: Room | Room[]): void`
- `socketsLeave(room: Room | Room[]): void`
- `disconnectSockets(close?: boolean): void`
- `emit(event: string, ...args: any[]): boolean`
- `send(...args: any[]): this`
- `write(...args: any[]): this`
- `compress(compress: boolean): BroadcastOperator`
- `binary: BroadcastOperator` *(getter)*
- `volatile: BroadcastOperator` *(getter)*
- `local: BroadcastOperator` *(getter)*
- `timeout(timeout: number): BroadcastOperator`

## Socket

Represents a single client connection.

### Constructor
```ts
new Socket(nsp: Namespace, client: Client, auth: Record<string, unknown>)
```

### Properties
- `id: string` – unique session id
- `handshake: Handshake` – connection details
- `data: SocketData` – custom data container
- `connected: boolean`
- `conn` *(getter)* – raw Engine.IO connection
- `ws` *(getter)* – Bun WebSocket
- `ctx` *(getter)* – Hono context
- `rooms` *(getter)* – joined rooms
- `disconnected` *(getter)* – inverse of `connected`

### Methods
- `emit(event: string, ...args: any[]): boolean`
- `emitWithAck(event: string, ...args): Promise<any>`
- `send(...args: any[]): this`
- `write(...args: any[]): this`
- `to(room: Room | Room[]): BroadcastOperator`
- `in(room: Room | Room[]): BroadcastOperator`
- `except(room: Room | Room[]): BroadcastOperator`
- `join(room: Room | Room[]): Promise<void> | void`
- `leave(room: Room): Promise<void> | void`
- `disconnect(close?: boolean): this`
- `compress(compress: boolean): this`
- `volatile: this` *(getter)*
- `broadcast: BroadcastOperator` *(getter)*
- `local: BroadcastOperator` *(getter)*
- `timeout(timeout: number): Socket`
- `use(fn: (event: Event, next: (err?: Error) => void) => void): this`
- `onAny(listener: (...args: any[]) => void): this`
- `prependAny(listener: (...args: any[]) => void): this`
- `offAny(listener?: (...args: any[]) => void): this`
- `listenersAny(): Array<(...args: any[]) => void>`
- `onAnyOutgoing(listener: (...args: any[]) => void): this`
- `prependAnyOutgoing(listener: (...args: any[]) => void): this`
- `offAnyOutgoing(listener?: (...args: any[]) => void): this`
- `listenersAnyOutgoing(): Array<(...args: any[]) => void>`

## BroadcastOperator

Utility for broadcasting packets to multiple sockets.

### Methods
- `to(room: Room | Room[]): BroadcastOperator`
- `in(room: Room | Room[]): BroadcastOperator`
- `except(room: Room | Room[]): BroadcastOperator`
- `compress(compress: boolean): BroadcastOperator`
- `volatile: BroadcastOperator` *(getter)*
- `local: BroadcastOperator` *(getter)*
- `timeout(timeout: number): BroadcastOperator`
- `binary: BroadcastOperator` *(getter)*
- `emit(event: string, ...args: any[]): boolean`
- `emitWithAck(event: string, ...args): Promise<any>`
- `fetchSockets(): Promise<Socket[]>`
- `socketsJoin(room: Room | Room[]): void`
- `socketsLeave(room: Room | Room[]): void`
- `disconnectSockets(close?: boolean): void`

## Adapter

Default in-memory adapter used for room management and broadcasting.

### Constructor
```ts
new Adapter(nsp: Namespace)
```

### Methods
- `init(): void | Promise<void>`
- `close(): void | Promise<void>`
- `serverCount(): Promise<number>`
- `addAll(id: SocketId, rooms: Set<Room>): void`
- `del(id: SocketId, room: Room): void`
- `delAll(id: SocketId): void`
- `broadcast(packet: any, opts: BroadcastOptions): void`
- `broadcastWithAck(packet: any, opts: BroadcastOptions, clientCountCallback: (count: number) => void, ack: (...args: any[]) => void): void`
- `sockets(rooms: Set<Room>): Promise<Set<SocketId>>`
- `socketRooms(id: SocketId): Set<Room> | undefined`
- `fetchSockets(opts: BroadcastOptions): Promise<Socket[]>`
- `addSockets(opts: BroadcastOptions, rooms: Room[]): void`
- `delSockets(opts: BroadcastOptions, rooms: Room[]): void`
- `disconnectSockets(opts: BroadcastOptions, close: boolean): void`
- `serverSideEmit(packet: any[]): void`
- `persistSession(session: SessionToPersist): void`
- `restoreSession(pid: PrivateSessionId, offset: string): Promise<Session> | null`

## SessionAwareAdapter

Extends `Adapter` with reconnection support.

### Overrides
- `persistSession(session: SessionToPersist): void`
- `restoreSession(pid: PrivateSessionId, offset: string): Promise<Session> | null`
- `broadcast(packet: any, opts: BroadcastOptions): void`

## ParentNamespace

A special namespace that holds dynamically created child namespaces.

### Constructor
```ts
new ParentNamespace(server: Server)
```

### Methods
- `createChild(name: string): Namespace`
- `emit(event: string, ...args: any[]): boolean`
- `fetchSockets(): Promise<any[]>` *(not supported and throws)*

## Client

Represents a connected client over Engine.IO.

### Constructor
```ts
new Client(conn: RawSocket, server: Server)
```

### Methods
- `get ctx: Context`
- `_packet(packet: Packet | any[], opts?: WriteOptions): void`
- `connect(name: string, auth?: Record<string, unknown>): void` *(private)*
- `doConnect(name: string, auth: Record<string, unknown>): void` *(private)*
- `_disconnect(): void`
- `_remove(socket: Socket): void`
- `close(): void` *(private)*
- `writeToEngine(encodedPackets: Array<string | Buffer>, opts: WriteOptions): void`

## Connection

Imitates an Engine.IO socket for Bun's WebSocket API.

### Constructor
```ts
new Connection(id: string, server: Server, ctx: Context, data?: SocketData)
```

### Methods
- `onOpen(event: Event, ws: WSContext): void`
- `onMessage(event: MessageEvent, ws?: WSContext): void`
- `onClose(event: CloseEvent, ws?: WSContext): void`
- `onError(event: Event, ws?: WSContext): void`
- `send(packet: Packet): void`
- `write(data: string | Uint8Array): void`
- `writeToEngine(data: string | Uint8Array): void`
- `publish(topic: string, data: string | Uint8Array): boolean`
- `close(): void`

## Engine.IO Server

`import { Server as EngineServer } from "socket.io-bun/dist/engine.io";`

### Constructor
```ts
new EngineServer(server: BunServer, opts?: Partial<ServerOptions>)
```

### Methods
- `handleRequest(ctx: Context, data?: any): Transport`
- `close(terminate?: boolean): void`

## Engine.IO Socket

Lower-level socket used by Engine.IO layer.

### Constructor
```ts
new EngineSocket(id: string, server: EngineServer, transport: Transport, ctx: Context, data?: any)
```

### Methods
- `send(data: any, options?: any, callback?: any): this`
- `close(discard?: boolean): this`
- `discard(): void`
- `sendPacket(type: PacketType, data?: Packet['data'], options?: Packet['options'], callback?: any): void`
- `flush(): void`
- `onPacket(packet: Packet): void`
- `onClose(reason: string, description?: string): void`
- `onError(err: Error): void`

## Engine.IO Transport

WebSocket transport handling Engine.IO packets.

### Constructor
```ts
new Transport(ctx: Context)
```

### Methods
- `onOpen(ev: Event, ws: WSContext): void`
- `onMessage(ev: MessageEvent): void`
- `onClose(ev: CloseEvent): void`
- `onError(ev: Event): void`
- `send(packets: Packet[]): void`
- `close(fn?: () => void): void`
- `discard(): void`

## Parser

Optimized Socket.IO protocol parser.

### Encoder
```ts
new Encoder(replacer?: (key: string, value: any) => any)
```
Methods:
- `encode(obj: Packet): Array<string | Buffer>`
- `encodeAsString(obj: Packet): string` *(private)*
- `encodeAsBinary(obj: Packet): Array<string | Buffer>` *(private)*
- `getDataHash(data: any): string` *(private)*
- `interpolateData(template: string, data: any): string` *(private)*
- `static clearCache(): void`

### Decoder
```ts
new Decoder(reviver?: (key: string, value: any) => any)
```
Methods:
- `add(obj: any): void`
- `destroy(): void`

### Utility
- `isPacketValid(packet: Packet): boolean`
- `isBinary(obj: any): boolean`
- `hasBinary(obj: any): boolean`

## Utilities

- `ws.ts` exports `io`, `websocket`, `upgradeWebSocket`, and `wsUpgrade` helpers for integrating with Hono and Bun's WebSocket server.
- `yeast()` – unique id generator used by the adapter.

---
