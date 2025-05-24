import { Packet } from './parser';

export const DEFAULT_NAMESPACE = '/';
export const PING_MESSAGE = Packet.encode(JSON.stringify({ event: 'ping' }));
export const PING_INTERVAL = 5_000; // должен совпадать с Service.heartbeatInterval
export const PING_TIMEOUT = 20_000; // закрыть после 4 «пустых» ping-ов
