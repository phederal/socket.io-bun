export const debugConfig = {
	adapter: as(false),
	client: as(false),
	connection: as(false),
	namespace: as(false),
	parentNamespace: as(false),
	server: as(false),
	socket: as(false),
	engine: as(false),
	engine_socket: as(false),
	engine_transport: as(false),
};

function as(bool: boolean) {
	const all = false;
	return all ?? bool;
}
