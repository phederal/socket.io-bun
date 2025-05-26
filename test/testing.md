# Socket.IO-Bun Testing Guide

## 🎯 Testing Approaches

### 1. Traditional Unit Tests

Standard unit tests with mocks for external dependencies.

```bash
# Run unit tests
bun test

# Watch mode
bun test --watch

# Coverage
bun test --coverage
```

### 2. 🔥 Live Browser Testing (Recommended)

**Real WebSocket connections** with real-time test execution in browser.

```bash
# Start live test server
bun run test:live

# Open browser to:
# http://localhost:8443
```

## 🌟 Live Testing Features

### Real-World Testing

-   **Actual WebSocket connections** (no mocks!)
-   **Real Browser environment**
-   **Live test execution** with visual feedback
-   **Performance testing** with real network latency
-   **Binary protocol testing** with actual binary data

### Visual Dashboard

-   📊 **Real-time progress** indicators
-   ✅ **Pass/fail status** for each test
-   ⏱️ **Performance metrics** and timing
-   📝 **Live logging** of all events
-   🎨 **Beautiful UI** with responsive design

### Comprehensive Test Coverage

-   **Basic Events** - emit/receive testing
-   **Acknowledgments** - callback testing with timeouts
-   **Room Operations** - join/leave/broadcast testing
-   **Binary Protocol** - binary message testing
-   **Performance** - rapid message handling
-   **Error Handling** - graceful error recovery
-   **Namespaces** - multiple namespace testing

## 🚀 Quick Start

1. **Start the live test server:**

    ```bash
    bun run test:live
    ```

2. **Open your browser:**

    ```
    http://localhost:8443
    ```

3. **Watch tests run automatically:**
    - Tests start when you connect
    - Real-time visual feedback
    - Detailed error reporting
    - Performance metrics

## 📊 Test Categories

### Core Socket.IO Tests

-   ✅ **Connection Management** - connect/disconnect lifecycle
-   ✅ **Event System** - emit/on event handling
-   ✅ **Acknowledgments** - callback system with timeouts
-   ✅ **Room System** - join/leave/broadcast operations
-   ✅ **Binary Protocol** - high-performance binary messages
-   ✅ **Error Handling** - graceful error recovery
-   ✅ **Performance** - rapid message throughput

### Namespace Tests

-   ✅ **Default Namespace** (`/`) - basic functionality
-   ✅ **Custom Namespaces** (`/chat`) - isolated communication
-   ✅ **Cross-Namespace** - namespace isolation verification

### Performance Tests

-   ✅ **Rapid Messages** - 100+ messages/second
-   ✅ **Binary Throughput** - binary protocol performance
-   ✅ **Room Broadcasting** - multi-socket message delivery
-   ✅ **Memory Usage** - leak detection and cleanup

## 🛠️ Test Implementation

### Browser-Side Tests

```javascript
// Example test implementation
socket.emit('test_echo', 'hello world');

socket.on('test_response', (data) => {
	// Verify: data === 'Echo: hello world'
	testPassed = true;
});
```

### Server-Side Handlers

```typescript
socket.on('test_echo', (data) => {
	socket.emit('test_response', `Echo: ${data}`);
});
```

### Real Binary Testing

```javascript
socket.emit('test_binary', 'binary test');

socket.on('binary_response', (data) => {
	// Receives actual binary data via emitBinary()
	// Tests real binary protocol implementation
});
```

## 🎯 Why Live Testing?

### Advantages over Mock Testing

1. **Real Network Conditions**

    - Actual WebSocket handshake
    - Real network latency
    - Browser WebSocket implementation

2. **No Mock Complexity**

    - Tests real library code
    - No maintenance of mock objects
    - Real-world behavior validation

3. **Visual Feedback**

    - See tests running in real-time
    - Interactive debugging
    - Beautiful visual results

4. **Performance Validation**
    - Real performance metrics
    - Actual memory usage
    - Network throughput testing

### Traditional Unit Tests Still Available

```bash
# Parser tests
bun test test/unit/parser-simple.test.ts

# Adapter tests
bun test test/unit/adapter-simple.test.ts

# Server tests
bun test test/unit/server-simple.test.ts
```

## 🔧 Development Workflow

### 1. Live Testing During Development

```bash
# Terminal 1: Start live test server
bun run test:live

# Terminal 2: Keep browser open
# http://localhost:8443

# Code changes trigger automatic retesting
```

### 2. CI/CD Integration

```bash
# Headless unit tests for CI
bun test

# Optional: Automated browser testing
# (can be added with Puppeteer/Playwright)
```

### 3. Manual Testing

-   Open multiple browser tabs
-   Test different scenarios
-   Verify real user experience

## 📈 Test Results

### Success Criteria

-   ✅ All tests pass in live environment
-   ✅ Performance meets benchmarks
-   ✅ Memory usage within limits
-   ✅ Error handling works correctly

### Performance Benchmarks

-   **Event Throughput**: >1000 events/second
-   **Binary Performance**: >95% of text performance
-   **Room Broadcasting**: <10ms latency
-   **Memory Usage**: No leaks detected

## 🎨 Browser Interface Features

### Dashboard Components

-   **Connection Status** - real-time connection state
-   **Test Progress** - visual progress indicators
-   **Results Summary** - pass/fail counts with timing
-   **Detailed Results** - individual test results
-   **Live Logs** - real-time event logging
-   **Performance Metrics** - throughput and latency data

### Interactive Controls

-   **Connect/Disconnect** - manual connection control
-   **Run Tests Again** - re-run test suite
-   **Clear Results** - reset dashboard
-   **Auto-connect** - automatic connection on load

## 🚀 Benefits

1. **Confidence** - Tests real library behavior
2. **Speed** - Faster than complex mocking setup
3. **Visual** - See exactly what's happening
4. **Debug** - Easy troubleshooting with live logs
5. **Performance** - Real-world performance validation
6. **User Experience** - Test actual user scenarios

## 🎯 Recommendation

**Use live testing as your primary testing method** for Socket.IO-Bun development. It provides:

-   ✅ **Real-world validation**
-   ✅ **Visual feedback**
-   ✅ **Performance insights**
-   ✅ **Easy debugging**
-   ✅ **No mock maintenance**

Traditional unit tests remain available for specific component testing when needed.
