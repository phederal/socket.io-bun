import { EventEmitter } from 'events';
import base64id from 'base64id';
import debugModule from 'debug';
import { BinaryProtocol, SocketParser } from './parser';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketId,
	Room,
	AckCallback,
	DisconnectReason,
	Handshake,
	SocketData as DefaultSocketData,
	EventsMap,
	DefaultEventsMap,
} from '../types/socket.types';
import type { Adapter } from './adapter';
import type { Namespace } from './namespace';
import type { Server } from './server';

const debug = debugModule('socket.io:socket');

const isProduction = process.env.NODE_ENV === 'production';

interface AcksData {
	callback: AckCallback;
	timeoutId: NodeJS.Timeout;
	createdAt: number;
}

export class Socket<
	ListenEvents extends EventsMap = ClientToServerEvents,
	EmitEvents extends EventsMap = ServerToClientEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData
> extends EventEmitter {
	public readonly id: SocketId;
	public readonly handshake: Handshake;
	public readonly data: SocketData = {} as SocketData;

	private heartbeatTimer?: NodeJS.Timeout;
	private readonly heartbeatInterval = 30000;
	private _connected: boolean = true;
	private _sessionId: string;

	public readonly ws: ServerWebSocket<WSContext>;
	private readonly adapter: Adapter<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	private readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;

	// Исправленная система ACK callbacks с правильной очисткой
	private acks = new Map<string, AcksData>();

	// Отключенный rate limiting для тестов
	private messageRateLimit = {
		count: 0,
		lastReset: Date.now(),
		maxPerSecond: 100000,
	};

	constructor(
		id: SocketId,
		ws: ServerWebSocket<WSContext>,
		readonly nsp: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		handshake: Handshake
	) {
		super();
		this.server = nsp.server;
		this.id = base64id.generateId();
		this.ws = ws;
		this.adapter = this.nsp.adapter;
		this.handshake = handshake;
		this._sessionId = SocketParser.generateSessionId();

		// Join default room (socket's own ID)
		// this.rooms.add(this.id); // TODO for bug uws subscribe us
		this.startHeartbeat();
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this._connected && this.ws.readyState === 1) {
				if (this.checkRateLimit(1)) {
					try {
						this.ws.send('2'); // Engine.IO ping
					} catch (error) {
						console.error(`[Socket] ${this.id} heartbeat error:`, error);
						this._handleClose('transport error');
					}
				}
			}
		}, this.heartbeatInterval);

		if (!isProduction) {
			console.log(
				`[Socket] ${this.id} heartbeat started with ${this.heartbeatInterval}ms interval`
			);
		}
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	private checkRateLimit(messageCount: number = 1): boolean {
		// Отключаем rate limiting в test режиме
		if (process.env.NODE_ENV === 'test') {
			return true;
		}

		const now = Date.now();
		if (now - this.messageRateLimit.lastReset >= 1000) {
			this.messageRateLimit.count = 0;
			this.messageRateLimit.lastReset = now;
		}

		if (this.messageRateLimit.count + messageCount > this.messageRateLimit.maxPerSecond) {
			console.warn(
				`[Socket] ${this.id} rate limit exceeded: ${this.messageRateLimit.count}/sec`
			);
			return false;
		}

		this.messageRateLimit.count += messageCount;
		return true;
	}

	get connected(): boolean {
		return this._connected && this.ws.readyState === 1;
	}

	get sessionId(): string {
		return this._sessionId;
	}

	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	override removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.removeListener(event, listener);
	}

	override off(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.off(event, listener);
	}

	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg?: Parameters<EmitEvents[Ev]>[0],
		ack?: AckCallback
	): boolean {
		if (!this._connected) return false;

		try {
			let ackId: string | undefined;
			let data: any;

			if (typeof dataOrArg === 'function') {
				ack = dataOrArg;
				data = undefined;
			} else if (typeof ack === 'function') {
				data = dataOrArg;
			} else {
				data = dataOrArg;
				if (data && typeof data === 'object') {
					data = this.sanitizeData(data);
				}
			}

			if (typeof ack === 'function') {
				ackId = SocketParser.generateAckId();

				// Простой timeout без сложных проверок состояния
				const timeoutId = setTimeout(() => {
					const ackData = this.acks.get(ackId!);
					if (ackData) {
						this.acks.delete(ackId!);
						ack!(new Error('Acknowledgement timeout'));
					}
				}, 5000);

				// Сохраняем в Map с метаданными
				this.acks.set(ackId, {
					callback: ack,
					timeoutId,
					createdAt: Date.now(),
				});
			}

			const packet = SocketParser.encode(event as any, data, ackId, this.nsp.name);

			if (!packet || typeof packet !== 'string') {
				return false;
			}

			if (this.ws.readyState !== 1) {
				return false;
			}

			const result = this.ws.send(packet);
			return result !== 0 && result !== -1;
		} catch (error) {
			console.error('[Socket] Emit error:', error);
			return false;
		}
	}

	emitWithAck(
		event: string,
		data: any,
		callback: AckCallback,
		options: {
			timeout?: number;
			priority?: 'low' | 'normal' | 'high';
			binary?: boolean;
		} = {}
	): boolean {
		if (!this._connected || this.ws.readyState !== 1) {
			callback(new Error('Socket not connected'));
			return false;
		}

		if (!this.checkRateLimit(1)) {
			callback(new Error('Rate limit exceeded'));
			return false;
		}

		const ackId = SocketParser.generateAckId();

		let timeout = options.timeout;
		if (!timeout) {
			switch (options.priority) {
				case 'high':
					timeout = 1000;
					break;
				case 'low':
					timeout = 15000;
					break;
				default:
					timeout = 5000;
					break;
			}
		}

		const timeoutId = setTimeout(() => {
			const ack = this.acks.get(ackId);
			if (ack) {
				this.acks.delete(ackId);
				callback(new Error(`Acknowledgement timeout after ${timeout}ms`));
			}
		}, timeout);

		this.acks.set(ackId, {
			callback,
			timeoutId,
			createdAt: Date.now(),
		});

		try {
			let packet: string | Uint8Array;

			if (options.binary && BinaryProtocol.supportsBinaryEncoding(event)) {
				const binaryPacket = BinaryProtocol.encode(event, data);
				if (binaryPacket) {
					packet = binaryPacket;
				} else {
					packet = SocketParser.encode(event, data, ackId, this.nsp.name);
				}
			} else {
				packet = SocketParser.encode(event, data, ackId, this.nsp.name);
			}

			const success = this.ws.send(packet) > 0;

			if (!success) {
				this.cleanupAck(ackId);
				callback(new Error('Failed to send packet'));
			}

			return success;
		} catch (error) {
			this.cleanupAck(ackId);
			callback(error as Error);
			return false;
		}
	}

	emitBinary<Ev extends keyof EmitEvents>(
		event: Ev,
		data?: Parameters<EmitEvents[Ev]>[0]
	): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		if (!this.checkRateLimit(1)) return false;

		const binaryPacket = SocketParser.encodeBinary(event, data, this.nsp);
		if (binaryPacket) {
			try {
				return this.ws.send(binaryPacket) > 0;
			} catch {
				return false;
			}
		}

		return this.emit(event, data as any);
	}

	emitFast(event: string, data?: string): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		if (!this.checkRateLimit(1)) return false;

		let packet: string;
		if (data) {
			packet = SocketParser.encode(event, data, undefined, this.nsp.name);
		} else {
			packet = SocketParser.encode(event, undefined, undefined, this.nsp.name);
		}

		return this.ws.send(packet) > 0;
	}

	join(rooms: Room | Array<Room>): Promise<void> | void {
		debug('join room %s', rooms);
		return this.adapter.addAll(this.id, new Set(Array.isArray(rooms) ? rooms : [rooms]));
	}

	leave(room: Room): Promise<void> | void {
		debug('leave room %s', room);
		return this.adapter.del(this.id, room);
	}

	leaveAll(): Promise<void> | void {
		return this.adapter.delAll(this.id);
	}

	get broadcast(): any {
		return this.nsp.except(this.id);
	}

	to(room: Room | Room[]): any {
		return this.nsp.to(room);
	}

	in(room: Room | Room[]): any {
		return this.to(room);
	}

	timeout(timeout: number): any {
		return this.nsp.timeout(timeout);
	}

	disconnect(close: boolean = false): this {
		this.stopHeartbeat();
		if (!this._connected) return this;

		this._connected = false;
		this.emit('disconnecting' as any, 'server namespace disconnect');

		// Очищаем все ACK callbacks
		for (const [ackId, ackData] of this.acks) {
			clearTimeout(ackData.timeoutId);
			try {
				ackData.callback(new Error('Socket disconnected'));
			} catch (error) {
				// Ignore callback errors during disconnect
			}
		}
		this.acks.clear();

		try {
			const disconnectPacket = SocketParser.encodeDisconnect(this.nsp.name);
			this.ws.send(disconnectPacket);
		} catch (error) {
			console.warn('[Socket] Failed to send disconnect packet:', error);
		}

		this.leaveAll();
		this.nsp.removeSocket(this);
		this.emit('disconnect' as any, 'server namespace disconnect');

		if (close && this.ws.readyState === 1) {
			this.ws.close();
		}

		return this;
	}

	/**
	 * ИСПРАВЛЕННАЯ обработка входящих пакетов
	 */
	_handlePacket(packet: any): void {
		if (!packet || !packet.event) return;

		if (!isProduction) {
			console.log(
				`[Socket] Handling packet: ${packet.event} from ${this.id}, ackId: ${packet.ackId}`
			);
		}

		try {
			if (packet.event === '__connect') return;
			if (packet.event === '__disconnect') {
				this._handleClose('client namespace disconnect');
				return;
			}

			if (packet.event === '__ack' && packet.ackId) {
				if (!isProduction) {
					console.log(`[Socket] Received ACK response: ${packet.ackId} from ${this.id}`);
				}
				this._handleAck(packet.ackId, packet.data);
				return;
			}

			if (packet.event === 'ping') {
				if (this.ws.readyState === 1) {
					this.ws.send('3');
				}
				return;
			}
			if (packet.event === 'pong') return;

			// ИСПРАВЛЕНО: Правильная обработка событий с ACK запросом от клиента
			if (packet.ackId && typeof packet.ackId === 'string') {
				if (!isProduction) {
					console.log(
						`[Socket] Event ${packet.event} requires ACK response: ${packet.ackId}`
					);
				}

				const listeners = this.listeners(packet.event);

				if (listeners.length > 0) {
					const listener = listeners[0] as Function;

					const ackWrapper = (...args: any[]) => {
						try {
							if (!this._connected || this.ws.readyState !== 1) {
								return;
							}

							const ackResponse = SocketParser.encodeAckResponse(
								packet.ackId!,
								args,
								this.nsp.name
							);

							const success = this.ws.send(ackResponse);

							if (!isProduction && !success) {
								console.warn(
									`[Socket] Failed to send ACK response for ${packet.ackId}`
								);
							}
						} catch (error) {
							if (!isProduction) {
								console.warn(`[Socket] ACK response error:`, error);
							}
						}
					};

					try {
						// ИСПРАВЛЕНО: Правильное определение типа события с ACK
						if (packet.data !== undefined) {
							// Событие с данными и callback
							listener.call(this, packet.data, ackWrapper);
						} else {
							// Событие без данных, только callback
							listener.call(this, ackWrapper);
						}
					} catch (error) {
						if (!isProduction) {
							console.error(
								`[Socket] Error in ACK event handler for ${packet.event}:`,
								error
							);
						}
						ackWrapper({ error: 'Internal server error' });
					}
					return;
				} else {
					if (!isProduction) {
						console.warn(`[Socket] No handler for ACK event: ${packet.event}`);
					}

					try {
						const ackResponse = SocketParser.encodeAckResponse(
							packet.ackId!,
							{
								error: `No handler for event: ${packet.event}`,
							},
							this.nsp
						);
						this.ws.send(ackResponse);
					} catch (error) {
						if (!isProduction) {
							console.error(`[Socket] Failed to send error ACK:`, error);
						}
					}
					return;
				}
			}

			// ИСПРАВЛЕНО: Обычное событие без ACK - используем super.emit для EventEmitter
			if (!isProduction) {
				console.log(`[Socket] Emitting regular event: ${packet.event}`);
			}

			if (packet.data !== undefined) {
				super.emit(packet.event, packet.data);
			} else {
				super.emit(packet.event);
			}
		} catch (error) {
			if (!isProduction) {
				console.error(`[Socket] Error handling packet ${packet.event}:`, error);
			}
		}
	}

	_handleAck(ackId: string, data: any): void {
		if (!isProduction) {
			console.log(`[Socket] Handling ACK ${ackId} with data:`, data);
		}

		const ackData = this.acks.get(ackId);
		if (ackData) {
			// Очищаем timeout
			clearTimeout(ackData.timeoutId);
			// Удаляем из Map
			this.acks.delete(ackId);

			// Извлекаем данные из Socket.IO массива
			const responseData = Array.isArray(data) && data.length > 0 ? data[0] : data;

			// Выполняем callback
			try {
				ackData.callback(responseData);
			} catch (error) {
				if (!isProduction) {
					console.warn(`[Socket] Error in ACK callback:`, error);
				}
			}
		}
	}

	private cleanupAck(ackId?: string): void {
		if (!ackId) return;

		const ackData = this.acks.get(ackId);
		if (ackData) {
			clearTimeout(ackData.timeoutId);
			this.acks.delete(ackId);
		}
	}

	_handleClose(reason: DisconnectReason): void {
		this.stopHeartbeat();
		if (this._connected) {
			this._connected = false;
			this.leaveAll();

			// Очищаем все ACK callbacks перед эмитом disconnect
			for (const [ackId, ackData] of this.acks) {
				clearTimeout(ackData.timeoutId);
				try {
					ackData.callback(new Error('Socket disconnected'));
				} catch (error) {
					// Ignore callback errors during disconnect
				}
			}
			this.acks.clear();

			this.nsp.removeSocket(this);
			super.emit('disconnect', reason);
		}
	}

	_handleError(error: Error): void {
		super.emit('error', error);
	}

	private sanitizeData(data: any, seen = new WeakSet()): any {
		if (data === null || data === undefined) return data;

		if (typeof data === 'function') return undefined;

		if (typeof data === 'object' && seen.has(data)) {
			return '[Circular]';
		}

		if (Array.isArray(data)) {
			seen.add(data);
			const result = data.map((item) => this.sanitizeData(item, seen));
			seen.delete(data);
			return result;
		}

		if (typeof data === 'object') {
			seen.add(data);
			const sanitized: any = {};
			for (const [key, value] of Object.entries(data)) {
				if (typeof value !== 'function') {
					sanitized[key] = this.sanitizeData(value, seen);
				}
			}
			seen.delete(data);
			return sanitized;
		}

		return data;
	}

	getAckStats() {
		return {
			total: this.acks.size,
			oldestAge:
				this.acks.size > 0
					? Date.now() -
					  Math.min(...Array.from(this.acks.values()).map((a) => a.createdAt))
					: 0,
		};
	}
}

export function warmupPerformanceOptimizations(): void {
	SocketParser.encode('test', undefined, undefined, '/');
	SocketParser.encode('test', 'warmup', undefined, '/');
	BinaryProtocol.encode('ping');
	BinaryProtocol.encode('message', 'test');
}
