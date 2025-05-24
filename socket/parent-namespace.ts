import type { BroadcastOptions, RemoteSocket } from './broadcast';
import { Namespace } from './namespace';
import type { Server } from './server';
import type { DefaultEventsMap, EventNamesWithoutAck, EventParams, EventsMap } from './types';

export type ParentNspNameMatchFn = (name: string, auth: { [key: string]: any }, fn: (err: Error | null, success: boolean) => void) => void;

/**
 * A parent namespace is a special {@link Namespace} that holds a list of child namespaces which were created either
 * with a regular expression or with a function.
 *
 * @example
 * const parentNamespace = io.of(/\/dynamic-\d+/);
 *
 * parentNamespace.on("connection", (socket) => {
 *   const childNamespace = socket.nsp;
 * }
 *
 * // will reach all the clients that are in one of the child namespaces, like "/dynamic-101"
 * parentNamespace.emit("hello", "world");
 *
 */
export class ParentNamespace<
	// Types for the events received from the clients.
	ListenEvents extends EventsMap = DefaultEventsMap,
	// Types for the events sent to the clients.
	EmitEvents extends EventsMap = ListenEvents,
	// Types for the events received from the server.
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	// Additional properties that can be attached to the socket instance
	SocketData = any,
> extends Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
	private static count: number = 0;

	private readonly children: Set<Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Set();

	constructor(server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) {
		super(server, '/_' + ParentNamespace.count++);
	}

	public emit<Ev extends EventNamesWithoutAck<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		this.children.forEach((nsp) => {
			nsp.emit(ev, ...args);
		});
		return true;
	}

	/**
	 * @private
	 */
	_initAdapter(): void {
		this.adapter = new ParentBroadcastAdapter(this);
	}

	createChild(name: string): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		// _debug('creating child namespace %s', name);
		const namespace = new Namespace(this.server, name);
		this['_fns'].forEach((fn) => namespace.use(fn));
		this.listeners('connect').forEach((listener) => namespace.on('connect', listener));
		this.listeners('connection').forEach((listener) => namespace.on('connection', listener));
		this.children.add(namespace);

		// if (this.server._opts.cleanupEmptyChildNamespaces) {
		const remove = namespace._remove;
		namespace._remove = (socket) => {
			remove.call(namespace, socket);
			if (namespace.sockets.size === 0) {
				// _debug('closing child namespace %s', name);
				namespace.adapter.close();
				this.server.namespaces.delete(namespace.name);
				this.children.delete(namespace);
			}
		};
		// }

		this.server.namespaces.set(name, namespace);

		// @ts-ignore
		this.server.sockets.emitReserved('new_namespace', namespace);

		return namespace;
	}

	fetchSockets(): Promise<RemoteSocket<EmitEvents, SocketData>[]> {
		// note: we could make the fetchSockets() method work for dynamic namespaces created with a regex (by sending the
		// regex to the other Socket.IO servers, and returning the sockets of each matching namespace for example), but
		// the behavior for namespaces created with a function is less clear
		// note²: we cannot loop over each children namespace, because with multiple Socket.IO servers, a given namespace
		// may exist on one node but not exist on another (since it is created upon client connection)
		throw new Error('fetchSockets() is not supported on parent namespaces');
	}
}

/**
 * A dummy adapter that only supports broadcasting to child (concrete) namespaces.
 * @private file
 */
class ParentBroadcastAdapter extends Adapter {
	broadcast(packet: any, opts: BroadcastOptions) {
		this.nsp.children.forEach((nsp) => {
			nsp.adapter.broadcast(packet, opts);
		});
	}
}
