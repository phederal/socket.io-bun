# Socket.IO-Bun Technical Architecture Reference

## Architecture Overview

Socket.IO-Bun представляет собой полнофункциональную реализацию Socket.IO протокола, оптимизированную для Bun runtime с интеграцией Hono framework. Архитектура построена на принципах строгой типизации, исключает HTTP Node.js сервер и использует исключительно нативный WebSocket Bun 1.2.13.

### Core Design Principles

1. **Single Transport Architecture**: Исключительно WebSocket транспорт через Bun.serve WebSocket API
2. **Type-Safe Protocol**: Полная типизация EventsMap с статической проверкой типов на compile-time
3. **Zero-Copy Data Flow**: Минимизация копирования данных через SharedArrayBuffer и прямую передачу Uint8Array
4. **Adapter Pattern**: Абстракция room management через unified adapter interface
5. **Namespace Isolation**: Логическое разделение connection scope с изолированными event handling

## Core Class Hierarchy

### Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>

**Primary Orchestrator Class**

```typescript
class Server extends StrictEventEmitter<
  ServerSideEvents,
  RemoveAcknowledgements<EmitEvents>,
  ServerReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
>
```

**State Management:**

-   `_nsps: Map<string, Namespace>` - Namespace registry с O(1) lookup
-   `_clients: Map<string, Client>` - Client connection pool
-   `parentNsps: Map<ParentNspNameMatchFn, ParentNamespace>` - Dynamic namespace handlers
-   `parentNamespacesFromRegExp: Map<RegExp, ParentNamespace>` - Pattern-based namespace routing
-   `engine: Engine` - Engine.IO abstraction layer
-   `encoder: Encoder` - Protocol packet encoder instance

**Critical Methods:**

#### `onconnection(c: Context, data?: SocketData): WSEvents<ServerWebSocket<WSContext>>`

-   **Input Flow**: Hono Context + optional SocketData
-   **Output Flow**: WebSocket event handlers object
-   **Process**: Delegiert zu engine.handleRequest() für Transport initialization
-   **Side Effects**: Registriert client в \_clients Map, инициализирует Transport layer

#### `of(name: string | RegExp, fn?: ConnectionHandler): Namespace`

-   **Namespace Resolution Algorithm**:
    1. String normalization (prefix '/' если отсутствует)
    2. Existing namespace lookup в \_nsps Map
    3. ParentNamespace pattern matching через regex testing
    4. New namespace creation с adapter initialization
-   **Side Effects**:
    -   Namespace creation trigger 'new_namespace' event
    -   Parent namespace child registration
    -   Adapter binding к server instance

#### `_checkNamespace(name: string, auth: object, fn: Callback): void`

-   **Dynamic Namespace Resolution Pipeline**:
    1. ParentNamespace iterator traversal
    2. Sequential auth middleware execution
    3. Namespace creation authorization chain
    4. Fallback rejection handling
-   **Async Flow**: Promise-based middleware chain с sequential execution

### Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>

**Logical Communication Channel**

```typescript
class Namespace extends StrictEventEmitter<
  ServerSideEvents,
  RemoveAcknowledgements<EmitEvents>,
  NamespaceReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
>
```

**State Management:**

-   `sockets: Map<SocketId, Socket>` - Active socket registry
-   `adapter: Adapter` - Room management abstraction
-   `_fns: Array<MiddlewareFunction>` - Middleware chain
-   `_ids: number` - Monotonic ACK ID generator

**Critical Methods:**

#### `_add(client: Client, auth: Record<string, unknown>, fn: Callback): void`

-   **Socket Creation Pipeline**:
    1. Socket instance construction с handshake building
    2. Middleware chain execution через run() method
    3. Connection state validation
    4. Error handling с CONNECT_ERROR packet dispatch
    5. Success path через \_doConnect()
-   **Async Considerations**: nextTick scheduling для connection state consistency

#### `run(socket: Socket, fn: Callback): void`

-   **Middleware Execution Chain**:
    -   Sequential middleware traversal
    -   Error short-circuiting
    -   Context preservation через closure scope
    -   Next callback chaining

#### Broadcast Operations

-   `to(room)`, `in(room)`, `except(room)`: BroadcastOperator construction
-   `emit()`: Delegation к BroadcastOperator с packet assembly
-   Internal routing через adapter.broadcast()

### Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>

**Individual Client Connection Abstraction**

```typescript
class Socket extends StrictEventEmitter<ListenEvents, EmitEvents, SocketReservedEventsMap>
```

**State Management:**

-   `id: SocketId` - Unique session identifier (base64id generated)
-   `handshake: Handshake` - Connection metadata snapshot
-   `data: SocketData` - User-attachable state container
-   `connected: boolean` - Connection state flag
-   `acks: Map<number, Function>` - Pending acknowledgment callbacks
-   `fns: Array<MiddlewareFunction>` - Socket-level middleware stack
-   `flags: BroadcastFlags` - Emission modifier state
-   `_anyListeners: Array<Function>` - Wildcard incoming listeners
-   `_anyOutgoingListeners: Array<Function>` - Wildcard outgoing listeners

**Critical Methods:**

#### `emit<Ev>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean`

-   **Packet Assembly Process**:
    1. RESERVED_EVENTS validation
    2. Data array construction [event, ...args]
    3. ACK callback detection и registration
    4. Packet object creation с type: PacketType.EVENT
    5. Flags application и reset
    6. outgoing listener notification
    7. packet() delegation
-   **ACK Flow**:
    -   ID generation через nsp.\_ids++
    -   Callback storage в acks Map
    -   Timeout handling если flags.timeout specified

#### `emitWithAck<Ev>(...args): Promise<Response>`

-   **Promise-Based ACK Pattern**:
    -   Promise construction с resolve/reject handlers
    -   Timeout flag detection для error handling
    -   Args modification с callback injection
    -   Delegation к standard emit()

#### `_onpacket(packet: Packet): void`

-   **Packet Processing Switch**:
    -   PacketType.EVENT/BINARY_EVENT → onevent()
    -   PacketType.ACK/BINARY_ACK → onack()
    -   PacketType.DISCONNECT → ondisconnect()
-   **State Validation**: Packet processing только если connected === true

#### `onevent(packet: Packet): void`

-   **Event Dispatch Pipeline**:
    1. Argument extraction из packet.data
    2. ACK callback attachment если packet.id present
    3. \_anyListeners iteration и execution
    4. dispatch() delegation для middleware chain
-   **ACK Callback Creation**:
    -   Double-send prevention mechanism
    -   Response packet assembly с type: PacketType.ACK

#### Room Management

-   `join(rooms)`: Delegation к adapter.addAll()
-   `leave(room)`: Delegation к adapter.del()
-   `leaveAll()`: Delegation к adapter.delAll()

### Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>

**Engine.IO Connection Wrapper**

**State Management:**

-   `conn: RawSocket` - Engine.IO socket reference
-   `server: Server` - Server instance reference
-   `encoder: Encoder` - Packet encoding instance
-   `decoder: Decoder` - Packet decoding instance
-   `sockets: Map<SocketId, Socket>` - Socket instances per namespace
-   `nsps: Map<string, Socket>` - Namespace → Socket mapping
-   `connectTimeout: NodeJS.Timeout` - Connection timeout handler

**Critical Methods:**

#### `setup(): void`

-   **Event Binding Process**:
    -   Decoder 'decoded' event → ondecoded()
    -   Connection 'data' event → ondata()
    -   Connection 'error' event → onerror()
    -   Connection 'close' event → onclose()
    -   connectTimeout initialization

#### `ondecoded(packet: Packet): void`

-   **Packet Routing Logic**:
    1. Namespace extraction из packet.nsp || '/'
    2. Auth payload extraction из packet.data
    3. Socket lookup в nsps Map
    4. PacketType switch processing:
        - CONNECT: connect() если socket отсутствует
        - EVENT/ACK/DISCONNECT: socket.\_onpacket() если socket exists
        - CONNECT_ERROR: socket.\_onpacket()
    5. Invalid state handling с connection close

#### `connect(name: string, auth: object): void`

-   **Namespace Connection Process**:
    1. Existing namespace check в server.\_nsps
    2. Dynamic namespace resolution через \_checkNamespace()
    3. doConnect() delegation при success
    4. CONNECT_ERROR packet при failure

#### `doConnect(name: string, auth: object): void`

-   **Socket Registration Pipeline**:
    1. Namespace retrieval через server.of()
    2. Socket creation через nsp.\_add()
    3. Socket registration в sockets и nsps Maps
    4. connectTimeout cleanup

### BroadcastOperator<EmitEvents, SocketData>

**Targeted Emission Abstraction**

**State Management:**

-   `adapter: Adapter` - Room management reference
-   `rooms: Set<Room>` - Target room set
-   `exceptRooms: Set<Room>` - Exclusion room set
-   `flags: BroadcastFlags` - Emission modifiers
-   `socket?: Socket` - Originating socket (для self-exclusion)

**Critical Methods:**

#### `emit<Ev>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean`

-   **Broadcast Emission Process**:
    1. RESERVED_EVENTS validation
    2. Data array assembly [ev, ...args]
    3. Packet construction с type: PacketType.EVENT
    4. ACK callback detection
    5. Broadcast routing:
        - Simple broadcast: adapter.broadcast()
        - ACK broadcast: adapter.broadcastWithAck()
    6. Client count tracking
    7. Response aggregation
    8. Timeout handling

#### `broadcastWithAck` Flow:

-   **Multi-Client ACK Coordination**:
    1. Expected server count determination
    2. Client count callback registration
    3. Response collection array
    4. Timeout timer setup
    5. Completion check triggering
    6. Promise resolution с aggregated responses

### Adapter (Base Class)

**Room Management Abstraction Layer**

**State Management:**

-   `rooms: Map<Room, Set<SocketId>>` - Room → Socket membership
-   `sids: Map<SocketId, Set<Room>>` - Socket → Room membership (inverse index)
-   `encoder: Encoder` - Packet encoding reference
-   `nsp: Namespace` - Namespace reference

**Critical Methods:**

#### `addAll(id: SocketId, rooms: Set<Room>): void`

-   **Room Subscription Process**:
    1. Socket existence validation
    2. SID map initialization если new socket
    3. Namespace topic subscription
    4. Room iteration с membership updates:
        - Topic generation: `${nsp.name}${SEPARATOR}${room}`
        - Room set creation если new room
        - Socket addition к room set
        - WebSocket topic subscription
    5. Event emission: 'create-room', 'join-room'

#### `broadcast(packet: Packet, opts: BroadcastOptions): void`

-   **Packet Distribution Algorithm**:
    1. Packet namespace assignment
    2. Encoding через encoder.encode()
    3. Target socket resolution через apply()
    4. outgoing listener notification
    5. Packet transmission через writeToEngine()

#### `apply(opts: BroadcastOptions, callback: Function): void`

-   **Socket Selection Algorithm**:
    1. Room-based selection если rooms specified:
        - Room iteration
        - Socket ID collection с deduplication
        - Exception filtering
    2. Global selection если no rooms:
        - SID map iteration
        - Exception filtering
    3. Callback execution per matching socket

### SessionAwareAdapter extends Adapter

**Connection State Recovery Extension**

**Additional State:**

-   `sessions: Map<PrivateSessionId, SessionWithTimestamp>` - Persisted sessions
-   `packets: PersistedPacket[]` - Packet history buffer
-   `maxDisconnectionDuration: number` - Session expiry threshold

**Enhanced Methods:**

#### `persistSession(session: SessionToPersist): void`

-   Session storage с timestamp marking
-   Automatic cleanup timer management

#### `restoreSession(pid: PrivateSessionId, offset: string): Promise<Session> | null`

-   **Session Recovery Process**:
    1. Session existence validation
    2. Expiry check против maxDisconnectionDuration
    3. Packet offset resolution
    4. Missed packet filtering
    5. Session restoration с missed packet array

#### `broadcast()` Override:

-   **Packet Persistence Logic**:
    -   Event packet detection (type === 2)
    -   ACK absence validation
    -   Volatility check
    -   Packet storage с unique ID generation
    -   Standard broadcast delegation

## Data Flow Architecture

### Connection Establishment Flow

```
Client WebSocket Connection
    ↓
Hono wsUpgrade Handler
    ↓
Server.onconnection(Context, SocketData)
    ↓
Engine.handleRequest(Context, SocketData)
    ↓
Engine.Socket Creation
    ↓
Transport Initialization
    ↓
Client Construction
    ↓
Connection Event Emission
```

### Packet Processing Pipeline

```
WebSocket Message Reception
    ↓
Transport.onMessage(MessageEvent)
    ↓
Engine.IO Packet Decoding
    ↓
Engine.Socket.onPacket()
    ↓
Client.ondata()
    ↓
Decoder.add()
    ↓
Decoder 'decoded' Event
    ↓
Client.ondecoded()
    ↓
Packet Routing (Namespace Resolution)
    ↓
Socket._onpacket()
    ↓
Event/ACK/Disconnect Processing
```

### Emission Data Flow

```
Socket.emit(event, ...args)
    ↓
Packet Assembly [event, ...args]
    ↓
ACK Callback Registration (if present)
    ↓
Packet Encoding (Encoder.encode())
    ↓
Client._packet()
    ↓
Client.writeToEngine()
    ↓
Engine.Socket.write()
    ↓
Transport.send()
    ↓
WebSocket.send()
```

### Broadcast Distribution Flow

```
BroadcastOperator.emit()
    ↓
Packet Construction
    ↓
Adapter.broadcast()
    ↓
Room/Socket Resolution
    ↓
apply() Target Selection
    ↓
Per-Socket Packet Encoding
    ↓
Parallel Client.writeToEngine()
    ↓
WebSocket Message Distribution
```

### Room Management Flow

```
Socket.join(room)
    ↓
Adapter.addAll()
    ↓
Room Set Update
    ↓
SID Inverse Index Update
    ↓
WebSocket Topic Subscription
    ↓
Event Emission ('join-room')
```

## Type System Architecture

### Generic Constraint Chain

```typescript
Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
    ↓
Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
    ↓
Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
    ↓
BroadcastOperator<EmitEvents, SocketData>
```

### Event Type Flow

```
EventsMap Definition
    ↓
EventNames<Map> Extraction
    ↓
EventParams<Map, Event> Parameter Inference
    ↓
Compile-Time Type Validation
    ↓
Runtime Event Dispatch
```

### Acknowledgment Type Decoration

```
Base EmitEvents
    ↓
DecorateAcknowledgements<EmitEvents>
    ↓
DecorateAcknowledgementsWithMultipleResponses<EmitEvents>
    ↓
DecorateAcknowledgementsWithTimeoutAndMultipleResponses<EmitEvents>
```

## Engine.IO Integration Layer

### Engine.Server

**WebSocket Transport Coordinator**

**State Management:**

-   `bun: BunServer` - Bun server reference
-   `clients: Map<string, Engine.Socket>` - Engine client registry
-   `clientsCount: number` - Active connection counter

**Critical Methods:**

#### `handleRequest(ctx: Context, data?: any): Transport`

-   **Transport Selection Logic**:
    1. Query parameter extraction
    2. Existing connection lookup via SID
    3. IP address validation для security
    4. New connection initialization:
        - ID generation via base64id
        - Engine.Socket creation
        - Client registration
        - 'connection' event emission

#### `publish(topics, encodedPackets, opts): void`

-   **Bun Pub/Sub Integration**:
    1. Client count validation
    2. Packet array normalization
    3. Topic array normalization
    4. Per-topic packet publishing:
        - Engine.IO packet wrapping
        - Bun.Server.publish() delegation

### Engine.Socket

**Low-Level Connection Management**

**State Management:**

-   `id: string` - Unique socket identifier
-   `ctx: Context` - Hono context reference
-   `data: any` - Custom attachment data
-   `remoteAddress: string` - Client IP address
-   `transport: Transport` - WebSocket transport reference
-   `writeBuffer: Packet[]` - Outgoing packet queue
-   `readyState: WebSocketReadyState` - Connection state
-   `pingIntervalTimer: NodeJS.Timeout` - Heartbeat interval
-   `pingTimeoutTimer: NodeJS.Timeout` - Heartbeat timeout

**Critical Methods:**

#### `onOpen(): void`

-   **Connection Initialization Sequence**:
    1. Ready state update
    2. Transport SID assignment
    3. Open packet transmission с handshake data
    4. Initial packet transmission если configured
    5. 'open' event emission
    6. Ping scheduling

#### `onPacket(packet: Packet): void`

-   **Engine.IO Packet Processing**:
    -   ping → pong response с timeout refresh
    -   pong → timeout cleanup с interval refresh
    -   message → 'data'/'message' event emission
    -   error → connection closure
    -   close → 'close' event emission

#### `schedulePing(): void`

-   **Heartbeat Management**:
    1. Interval timer setup
    2. Ping packet transmission
    3. Timeout timer initialization
    4. Connection closure при timeout

### Transport

**WebSocket Protocol Handler**

**State Management:**

-   `name: string` - Transport identifier ('websocket')
-   `sid: string` - Session identifier
-   `writable: boolean` - Write capability flag
-   `readyState: WebSocketReadyState` - Connection state
-   `discarded: boolean` - Disposal flag
-   `socket: WSContext` - Bun WebSocket context

**Critical Methods:**

#### `onMessage(ev: MessageEvent): void`

-   **Message Processing Pipeline**:
    1. Packet decoding via engine.io-parser
    2. Debug logging
    3. 'packet' event emission
    4. Error handling с 'error' event

#### `send(packets: Packet[]): void`

-   **Packet Transmission Sequence**:
    1. Writable flag reset
    2. Packet iteration
    3. Per-packet encoding
    4. WebSocket transmission
    5. 'drain' event emission при completion
    6. Writable flag restoration

## Error Handling Architecture

### Connection Error Propagation

```
WebSocket Error
    ↓
Transport.onError()
    ↓
Engine.Socket Error Handling
    ↓
Client.onerror()
    ↓
Socket Error Propagation
    ↓
User Error Handler
```

### Middleware Error Chain

```
Middleware Exception
    ↓
Next Callback Error Parameter
    ↓
Short-Circuit Execution
    ↓
CONNECT_ERROR Packet
    ↓
Client Notification
```

### ACK Timeout Handling

```
ACK Registration с Timeout
    ↓
Timer Setup
    ↓
Timeout Expiration
    ↓
Callback Execution с Error
    ↓
ACK Map Cleanup
```

## Memory Management Strategy

### Connection Lifecycle

```
Client Connection
    ↓
Object Graph Creation
    ↓
Active State Maintenance
    ↓
Disconnection Detection
    ↓
Cleanup Chain Execution
    ↓
Reference Removal
    ↓
Garbage Collection
```

### Room Membership Optimization

-   **Dual Index Strategy**: rooms Map + sids Map для O(1) lookup/cleanup
-   **Set-Based Membership**: Efficient add/remove operations
-   **Automatic Cleanup**: Empty room deletion

### Memory Leak Prevention

-   **Event Listener Cleanup**: removeListener() в disconnect handlers
-   **Timer Cleanup**: clearTimeout() для all pending timers
-   **Map Cleanup**: delete() операции для all registries
-   **Circular Reference Breaking**: Explicit nullification

## Performance Optimization Features

### Zero-Copy Message Passing

-   **Direct Uint8Array Transfer**: Минимизация buffer copying
-   **SharedArrayBuffer Usage**: где applicable для large payloads
-   **Binary Frame Preservation**: Native WebSocket binary support

### Efficient Room Broadcasting

-   **Parallel Transmission**: Concurrent client writeToEngine() calls
-   **Deduplication Logic**: Single transmission per client per broadcast
-   **Topic-Based Pub/Sub**: Bun native publish() utilization

### Hot Path Optimization

-   **Map-Based Lookups**: O(1) namespace/socket resolution
-   **Pre-compiled Packet Templates**: Reduced encoding overhead
-   **Inline Flag Processing**: Minimal object allocation

### Connection Pool Management

-   **Connection Reuse**: SID-based reconnection support
-   **Lazy Cleanup**: Deferred resource deallocation
-   **Adaptive Timeouts**: Dynamic timeout adjustment

This technical reference provides comprehensive coverage of the Socket.IO-Bun architecture, class relationships, data flows, and implementation details necessary for deep understanding and maintenance of the codebase.
