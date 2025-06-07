import type {
	AllButLast,
	DecorateAcknowledgements,
	EventNames,
	EventNamesWithError,
	EventParams,
	EventsMap,
	FirstNonErrorArg,
	Last,
	TypedEventBroadcaster,
} from '#types/typed-events';
import { type SocketData as DefaultSocketData, type Handshake, RESERVED_EVENTS } from '../types/socket-types';
import type { Adapter, SocketId, Room } from './socket.io-adapter';
import { PacketType, type Packet } from './socket.io-parser';
import type { Socket } from './socket';

export interface BroadcastFlags {
	volatile?: boolean;
	compress?: boolean;
	local?: boolean;
	broadcast?: boolean;
	timeout?: number;
	binary?: boolean;
}

/**
 * Simplified BroadcastOperator with only emit and emitWithAck
 */
export class BroadcastOperator<
	/** {@link TypedEventBroadcaster} */
	EmitEvents extends EventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData,
> implements TypedEventBroadcaster<EmitEvents>
{
	constructor(
		private readonly adapter: Adapter,
		private readonly rooms: Set<Room> = new Set<Room>(),
		private readonly exceptRooms: Set<Room> = new Set<Room>(),
		private readonly flags: BroadcastFlags & {
			expectSingleResponse?: boolean;
		} = {},
		private readonly socket?: Socket,
	) {}

	/**
	 * Target specific room(s)
	 */
	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		const rooms = new Set(this.rooms);
		if (Array.isArray(room)) {
			room.forEach((r) => rooms.add(r));
		} else {
			rooms.add(room);
		}
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter, rooms, this.exceptRooms, this.flags);
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.to(room);
	}

	/**
	 * Exclude specific room(s) or socket(s)
	 */
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		const exceptRooms = new Set(this.exceptRooms);
		if (Array.isArray(room)) {
			room.forEach((r) => exceptRooms.add(r));
		} else {
			exceptRooms.add(room);
		}
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter, this.rooms, exceptRooms, this.flags);
	}

	/**
	 * Set compress flag
	 */
	compress(compress: boolean): BroadcastOperator<EmitEvents, SocketData> {
		const flags = Object.assign({}, this.flags, { compress });
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter, this.rooms, this.exceptRooms, flags);
	}

	/**
	 * Set volatile flag
	 */
	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		const flags = Object.assign({}, this.flags, { volatile: true });
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter, this.rooms, this.exceptRooms, flags);
	}

	/**
	 * Set local flag
	 */
	get local(): BroadcastOperator<EmitEvents, SocketData> {
		const flags = Object.assign({}, this.flags, { local: true });
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter, this.rooms, this.exceptRooms, flags);
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		const flags = Object.assign({}, this.flags, { timeout });
		return new BroadcastOperator<DecorateAcknowledgements<EmitEvents>, SocketData>(this.adapter, this.rooms, this.exceptRooms, flags);
	}

	/**
	 * Set binary flag for forced binary protocol usage
	 */
	get binary(): BroadcastOperator<EmitEvents, SocketData> {
		const flags = Object.assign({}, this.flags, { binary: true });
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter, this.rooms, this.exceptRooms, flags);
	}

	/**
	 * Main emit method with full Socket.IO compatibility
	 */
	emit<Ev extends EventNames<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		if (RESERVED_EVENTS.has(ev)) {
			throw new Error(`"${String(ev)}" is a reserved event name`);
		}
		// set up packet object
		const data = [ev, ...args];
		// type without nsp.name because it added by adapter
		const packet = {
			type: PacketType.EVENT,
			data: data,
		};

		const withAck = typeof data[data.length - 1] === 'function';

		if (!withAck) {
			this.adapter.broadcast(packet as Packet, {
				rooms: this.rooms,
				except: this.exceptRooms,
				flags: this.flags,
				socket: this.socket,
			});

			return true;
		}

		const ack = data.pop() as (...args: any[]) => void;
		let timedOut = false;
		let responses: any[] = [];

		const timer = setTimeout(() => {
			timedOut = true;
			ack.apply(this, [new Error('operation has timed out'), this.flags.expectSingleResponse ? null : responses]);
		}, this.flags.timeout);

		let expectedServerCount = -1;
		let actualServerCount = 0;
		let expectedClientCount = 0;

		const checkCompleteness = () => {
			if (!timedOut && expectedServerCount === actualServerCount && responses.length === expectedClientCount) {
				clearTimeout(timer);
				ack.apply(this, [null, this.flags.expectSingleResponse ? responses[0] : responses]);
			}
		};

		this.adapter.broadcastWithAck(
			packet,
			{
				rooms: this.rooms,
				except: this.exceptRooms,
				flags: this.flags,
			},
			(clientCount) => {
				// each Socket.IO server in the cluster sends the number of clients that were notified
				expectedClientCount += clientCount;
				actualServerCount++;
				checkCompleteness();
			},
			(clientResponse) => {
				// each client sends an acknowledgement
				responses.push(clientResponse);
				checkCompleteness();
			},
		);

		this.adapter.serverCount().then((serverCount) => {
			expectedServerCount = serverCount;
			checkCompleteness();
		});

		return true;
	}

	/**
	 * Emit with acknowledgement callback
	 */
	emitWithAck<Ev extends EventNamesWithError<EmitEvents>>(
		ev: Ev,
		...args: AllButLast<EventParams<EmitEvents, Ev>>
	): Promise<FirstNonErrorArg<Last<EventParams<EmitEvents, Ev>>>> {
		return new Promise((resolve, reject) => {
			// @ts-ignore
			args.push((err, responses) => {
				if (err) {
					err.responses = responses;
					return reject(err);
				} else {
					return resolve(responses);
				}
			});
			this.emit(ev, ...(args as any[] as EventParams<EmitEvents, Ev>));
		});
	}

	/**
	 * Get all matching socket instances
	 */
	fetchSockets(): Promise<Socket<EmitEvents, SocketData>[]> {
		return this.adapter
			.fetchSockets({
				rooms: this.rooms,
				except: this.exceptRooms,
				flags: this.flags,
			})
			.then((sockets) => {
				return sockets.map((socket) => socket as Socket<EmitEvents, SocketData>);
			});
	}

	/**
	 * Make all matching sockets join room(s)
	 */
	socketsJoin(room: Room | Room[]): void {
		this.adapter.addSockets(
			{
				rooms: this.rooms,
				except: this.exceptRooms,
				flags: this.flags,
			},
			Array.isArray(room) ? room : [room],
		);
	}

	/**
	 * Make all matching sockets leave room(s)
	 */
	socketsLeave(room: Room | Room[]): void {
		this.adapter.delSockets(
			{
				rooms: this.rooms,
				except: this.exceptRooms,
				flags: this.flags,
			},
			Array.isArray(room) ? room : [room],
		);
	}

	/**
	 * Disconnect all matching sockets
	 */
	disconnectSockets(close: boolean = false): void {
		this.adapter.disconnectSockets(
			{
				rooms: this.rooms,
				except: this.exceptRooms,
				flags: this.flags,
			},
			close,
		);
	}
}
