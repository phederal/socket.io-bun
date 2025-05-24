# Binary Protocol API

Socket.IO-Bun поддерживает опциональный бинарный протокол для повышения производительности при отправке простых событий. По умолчанию все сообщения отправляются в текстовом формате JSON, но бинарный формат можно включить по требованию.

## Поддерживаемые события

Бинарный протокол поддерживает следующие события:

-   `ping`
-   `pong`
-   `message`
-   `notification`
-   `user_joined`
-   `user_left`
-   `typing_start`
-   `typing_stop`
-   `room_joined`
-   `room_left`

## API методы

### Socket уровень

#### `socket.emit()` - Обычная отправка (текстовый формат)

```typescript
socket.emit('message', 'Hello World'); // Текстовый JSON
socket.emit('ping'); // Текстовый JSON
```

#### `socket.emitBinary()` - Принудительный бинарный формат

```typescript
socket.emitBinary('message', 'Hello World'); // Бинарный если поддерживается
socket.emitBinary('ping'); // Бинарный если поддерживается
```

#### `socket.emitUltraFast()` - Контроль формата

```typescript
socket.emitUltraFast('message', 'Hello', false); // Текстовый
socket.emitUltraFast('message', 'Hello', true); // Бинарный
```

#### `socket.emitBatchPooled()` - Batch с контролем формата

```typescript
socket.emitBatchPooled([
	{ event: 'message', data: 'Text message' }, // Текстовый по умолчанию
	{ event: 'ping', binary: true }, // Бинарный
	{ event: 'notification', data: 'Text', binary: false }, // Явно текстовый
	{ event: 'message', data: 'Binary', binary: true }, // Бинарный
]);
```

### Namespace/Server уровень

#### `namespace.emit()` - Обычный broadcast (текстовый)

```typescript
io.emit('message', 'Hello everyone'); // Текстовый JSON
namespace.emit('notification', 'Update available'); // Текстовый JSON
```

#### `namespace.emitBinary()` - Принудительный бинарный broadcast

```typescript
io.emitBinary('ping'); // Бинарный если поддерживается
namespace.emitBinary('message', 'Binary broadcast'); // Бинарный если поддерживается
```

#### `namespace.binary` - Бинарный broadcast operator

```typescript
io.binary.emit('ping'); // Бинарный broadcast
io.binary.to('room1').emit('message', 'Binary to room'); // Бинарный в комнату
io.binary.except('room2').emit('notification', 'Binary except room2'); // Бинарный кроме комнаты
```

### Room operations с бинарным форматом

```typescript
// Текстовый формат
io.to('room1').emit('message', 'Hello room1');

// Бинарный формат
io.to('room1').binary.emit('message', 'Binary hello room1');
io.binary.to('room1').emit('ping');

// Комбинированные операции
io.to(['room1', 'room2']).except('room3').binary.emit('notification', 'Multi-room binary');
```

### Bulk operations

```typescript
io.emitBulk([
	{ event: 'message', data: 'Text message' },
	{ event: 'ping', binary: true },
	{ event: 'notification', data: 'Binary notification', binary: true },
	{ event: 'message', data: 'Text to room', rooms: 'room1' },
	{ event: 'ping', rooms: ['room1', 'room2'], binary: true },
]);
```

## Автоматическое определение формата

### Отправка

-   По умолчанию все события отправляются в **текстовом** формате JSON
-   Бинарный формат включается только при явном указании через:
    -   `emitBinary()`
    -   `.binary.emit()`
    -   `emitUltraFast(..., true)`
    -   `{ binary: true }` в batch операциях

### Получение

-   Парсер автоматически определяет формат входящих сообщений
-   Поддерживает как текстовые JSON пакеты, так и бинарные
-   Прозрачно для пользователя - `socket.on()` работает одинаково

## Производительность

### Когда использовать бинарный формат:

-   Высокочастотные простые события (`ping`, `pong`, короткие сообщения)
-   Массовые broadcast операции
-   Низкоуровневые уведомления (typing indicators, presence updates)

### Когда использовать текстовый формат:

-   Сложные объекты данных
-   События с acknowledgments
-   Отладка и разработка
-   Интеграция с существующими Socket.IO клиентами

### Benchmark результаты:

```
Text Format: 125ms (1000 iterations)
Binary Format: 89ms (1000 iterations) - ~29% faster
Ultra-fast Text: 67ms (1000 iterations)
Ultra-fast Binary: 45ms (1000 iterations) - ~33% faster
```

## Совместимость

-   **Сервер → Клиент**: Бинарный формат работает только с нашим парсером
-   **Клиент → Сервер**: Поддерживает оба формата автоматически
-   **Socket.IO клиенты**: Получат текстовые сообщения (fallback)
-   **Namespace**: Бинарный формат доступен только в default namespace (`/`)

## Примеры использования

### Чат приложение

```typescript
// Обычные сообщения - текстовый формат для совместимости
socket.emit('chat_message', { user: 'John', message: 'Hello!', timestamp: Date.now() });

// Typing indicators - бинарный для скорости
socket.emitBinary('typing_start', 'room1');
socket.emitBinary('typing_stop', 'room1');

// Presence updates - бинарный batch
socket.emitBatchPooled([
	{ event: 'user_joined', data: 'room1', binary: true },
	{ event: 'user_count', data: '5', binary: true },
]);
```

### Gaming application

```typescript
// Player movement - ultra-fast binary
socket.emitUltraFast('player_move', `${x},${y}`, true);

// Game events - бинарный broadcast
io.binary.to(`game_${gameId}`).emit('ping');

// Chat messages - текстовый для сложных данных
io.to(`game_${gameId}`).emit('game_chat', {
	player: playerId,
	message: text,
	timestamp: Date.now(),
});
```

### Monitoring system

```typescript
// Frequent metrics - binary
io.binary.emit('heartbeat');
io.binary.to('monitoring').emit('metric_update', cpuUsage.toString());

// Alerts - text для структурированных данных
io.to('alerts').emit('system_alert', {
	level: 'warning',
	service: 'database',
	message: 'High CPU usage detected',
	timestamp: Date.now(),
});
```

## Отладка

```typescript
// Включить логирование формата сообщений
process.env.NODE_ENV = 'development';

// Проверить поддержку бинарного формата для события
import { BinaryProtocol } from './socket/object-pool';
console.log(BinaryProtocol.supportsBinaryEncoding('ping')); // true
console.log(BinaryProtocol.supportsBinaryEncoding('custom_event')); // false

// Получить статистику кешей
import { SocketParser } from './socket/parser';
console.log(SocketParser.getCacheStats());
```
