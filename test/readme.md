# Socket.IO-Bun Tests

Comprehensive test suite for the Socket.IO-Bun library using Bun's native test runner.

## Quick Start

```bash
# Run all tests
bun test

# Run unit tests only
bun test test/unit/

# Run integration tests only
bun test test/integration/

# Run with watch mode
bun test --watch

# Run with coverage
bun test --coverage
```

## Structure

```
test/
├── unit/               # Unit tests for individual components
│   ├── parser.test.ts    # SocketParser and BinaryProtocol tests
│   ├── socket.test.ts    # Socket class tests
│   ├── namespace.test.ts # Namespace class tests
│   ├── adapter.test.ts   # Adapter class tests
│   ├── broadcast.test.ts # BroadcastOperator tests
│   └── server.test.ts    # SocketServer tests
├── integration/        # Integration tests
│   └── websocket.test.ts # End-to-end WebSocket tests
├── smoke.test.ts       # Basic functionality tests
├── setup.ts           # Test utilities and configuration
└── README.md          # This file
```

## Test Categories

### Smoke Tests (`smoke.test.ts`)

Basic import and functionality verification:

-   ✅ Module imports
-   ✅ Basic API availability
-   ✅ Simple encode/decode
-   ✅ Binary protocol basics

### Unit Tests

**Parser Tests** (`unit/parser.test.ts`)

-   ✅ Simple event encoding without data
-   ✅ String event encoding with escaping
-   ✅ Complex object encoding
-   ✅ ACK response encoding/decoding
-   ✅ Binary protocol encoding/decoding
-   ✅ Cache management
-   ✅ Error handling for malformed packets

**Socket Tests** (`unit/socket.test.ts`)

-   ✅ Socket initialization and properties
-   ✅ Event emission (regular, binary, fast, batch)
-   ✅ Acknowledgment handling with timeouts
-   ✅ Room management (join/leave/leaveAll)
-   ✅ Packet handling for incoming events
-   ✅ Connection lifecycle management
-   ✅ Rate limiting (disabled in production)
-   ✅ Data sanitization (circular refs, functions)

**Namespace Tests** (`unit/namespace.test.ts`)

-   ✅ Middleware system with error handling
-   ✅ Socket connection/disconnection management
-   ✅ Broadcasting operations with flags
-   ✅ Room operations (join/leave/fetch)
-   ✅ Namespace-wide acknowledgments
-   ✅ Event forwarding and cleanup

**Adapter Tests** (`unit/adapter.test.ts`)

-   ✅ Room management (add/remove sockets)
-   ✅ Socket queries and filtering
-   ✅ Broadcasting with Bun.publish integration
-   ✅ Handling disconnected sockets
-   ✅ Room event emission
-   ✅ Performance with large datasets

**Broadcast Tests** (`unit/broadcast.test.ts`)

-   ✅ Room targeting (single/multiple)
-   ✅ Socket/room exclusion
-   ✅ Flags (binary, volatile, compress, timeout)
-   ✅ Batch operations
-   ✅ Socket management (join/leave/disconnect)
-   ✅ Data sanitization and error handling

**Server Tests** (`unit/server.test.ts`)

-   ✅ Namespace management and normalization
-   ✅ Bun server integration
-   ✅ Event forwarding from default namespace
-   ✅ Middleware delegation
-   ✅ Broadcasting delegation
-   ✅ Cleanup and resource management

### Integration Tests

**WebSocket Tests** (`integration/websocket.test.ts`)

-   ✅ Real WebSocket connection establishment
-   ✅ Socket.IO handshake process
-   ✅ Message exchange (events, ACKs, ping/pong)
-   ✅ Authentication flow
-   ✅ Room operations with multiple clients
-   ✅ Binary protocol integration
-   ✅ Error handling (malformed packets, disconnects)
-   ✅ Performance (rapid messages, multiple connections)

## Test Features

### Comprehensive Mocking

-   Full mock objects for WebSocket, Server, Adapter
-   Isolated unit testing environment
-   Predictable test conditions

### Type Safety

-   Full TypeScript support in tests
-   Type-safe event definitions
-   Generic type testing

### Performance Validation

-   Large-scale operation testing
-   Memory usage validation
-   Concurrent connection handling
-   Timeout management

### Error Handling Coverage

-   Malformed packet handling
-   Connection failure scenarios
-   Rate limiting validation
-   Proper cleanup verification

## Test Utilities

The `setup.ts` file provides utilities:

```typescript
import { testUtils } from './setup';

// Create timeouts
const timeout = testUtils.createTimeout(5000, 'Custom timeout message');

// Wait for conditions
await testUtils.waitFor(() => socket.connected, 3000);

// Mock WebSocket
const mockWs = testUtils.createMockWebSocket();
```

## Writing Tests

### Basic Unit Test

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';

describe('MyComponent', () => {
	beforeEach(() => {
		// Setup before each test
	});

	test('should do something', () => {
		expect(true).toBe(true);
	});
});
```

### Integration Test with WebSocket

```typescript
import { describe, test, expect } from 'bun:test';
import { io } from '../../ws';

describe('Integration Test', () => {
	test('should handle real connection', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

			io.on('connection', (socket) => {
				clearTimeout(timeout);
				expect(socket.connected).toBe(true);
				resolve();
			});

			// Trigger connection...
		});
	});
});
```

## Coverage Goals

-   **Unit Tests**: 100% coverage of core API methods
-   **Integration Tests**: End-to-end user scenarios
-   **Error Paths**: All error conditions tested
-   **Performance**: Stress testing under realistic load

## Dependencies

Tests use Bun's built-in test runner with:

-   Native `describe`, `test`, `expect` functions
-   Lifecycle hooks: `beforeEach`, `afterEach`, `beforeAll`, `afterAll`
-   Mocking: `mock`, `spyOn` functions
-   TypeScript support out of the box
-   No additional test dependencies needed
