/**
 * Custom Event Types for Specific Use Cases
 * Extend these interfaces for your specific application needs
 */

import type { EventsMap } from './socket.types';

// ==== Game Events Example ====
export interface GameClientEvents extends EventsMap {
	// Player actions
	player_move: (data: { x: number; y: number; direction: number }) => void;
	player_attack: (data: { targetId: string; damage: number }) => void;
	player_chat: (message: string) => void;

	// Game state
	join_game: (gameId: string, callback: (success: boolean) => void) => void;
	leave_game: () => void;
	ready_to_start: () => void;
}

export interface GameServerEvents extends EventsMap {
	// Game updates
	game_state: (state: GameState) => void;
	player_joined: (player: Player) => void;
	player_left: (playerId: string) => void;
	player_moved: (data: { playerId: string; x: number; y: number; direction: number }) => void;
	player_attacked: (data: { attackerId: string; targetId: string; damage: number }) => void;

	// Game lifecycle
	game_started: () => void;
	game_ended: (winner: string) => void;
	game_error: (error: string) => void;
}

interface Player {
	id: string;
	name: string;
	x: number;
	y: number;
	health: number;
	level: number;
}

interface GameState {
	id: string;
	players: Player[];
	status: 'waiting' | 'playing' | 'ended';
	startTime?: string;
}

// ==== Chat Application Events ====
export interface ChatClientEvents extends EventsMap {
	// Messages
	send_message: (data: { content: string; room: string; replyTo?: string }) => void;
	edit_message: (data: { messageId: string; newContent: string }) => void;
	delete_message: (messageId: string) => void;

	// Reactions
	add_reaction: (data: { messageId: string; emoji: string }) => void;
	remove_reaction: (data: { messageId: string; emoji: string }) => void;

	// Rooms
	create_room: (
		data: { name: string; isPrivate: boolean },
		callback: (roomId: string) => void
	) => void;
	join_room: (roomId: string) => void;
	leave_room: (roomId: string) => void;

	// User status
	set_typing: (roomId: string, isTyping: boolean) => void;
	set_status: (status: 'online' | 'away' | 'busy' | 'offline') => void;
}

export interface ChatServerEvents extends EventsMap {
	// Messages
	new_message: (message: ChatMessage) => void;
	message_edited: (data: { messageId: string; newContent: string; editedAt: string }) => void;
	message_deleted: (messageId: string) => void;

	// Reactions
	reaction_added: (data: { messageId: string; userId: string; emoji: string }) => void;
	reaction_removed: (data: { messageId: string; userId: string; emoji: string }) => void;

	// Room events
	room_created: (room: ChatRoom) => void;
	user_joined_room: (data: { userId: string; roomId: string; user: ChatUser }) => void;
	user_left_room: (data: { userId: string; roomId: string }) => void;

	// User status
	user_typing: (data: { userId: string; roomId: string; isTyping: boolean }) => void;
	user_status_changed: (data: { userId: string; status: string }) => void;

	// Notifications
	mention: (data: { messageId: string; roomId: string; fromUser: string }) => void;
	direct_message: (message: ChatMessage) => void;
}

interface ChatMessage {
	id: string;
	content: string;
	authorId: string;
	authorName: string;
	roomId: string;
	timestamp: string;
	replyTo?: string;
	reactions: Array<{ emoji: string; userIds: string[] }>;
	editedAt?: string;
}

interface ChatRoom {
	id: string;
	name: string;
	isPrivate: boolean;
	memberIds: string[];
	createdAt: string;
	createdBy: string;
}

interface ChatUser {
	id: string;
	name: string;
	avatar?: string;
	status: 'online' | 'away' | 'busy' | 'offline';
	lastSeen: string;
}

// ==== File Sharing Events ====
export interface FileClientEvents extends EventsMap {
	// File upload
	upload_file: (data: { name: string; size: number; type: string; roomId: string }) => void;
	file_chunk: (data: { fileId: string; chunk: Uint8Array; chunkIndex: number }) => void;
	upload_complete: (fileId: string) => void;

	// File download
	download_file: (fileId: string) => void;
	request_file_chunk: (data: { fileId: string; chunkIndex: number }) => void;
}

export interface FileServerEvents extends EventsMap {
	// File events
	file_upload_started: (data: {
		fileId: string;
		name: string;
		size: number;
		uploadedBy: string;
	}) => void;
	file_uploaded: (file: FileInfo) => void;
	file_chunk_received: (data: { fileId: string; chunk: Uint8Array; chunkIndex: number }) => void;
	upload_progress: (data: { fileId: string; progress: number }) => void;

	// Download events
	file_info: (file: FileInfo) => void;
	download_chunk: (data: {
		fileId: string;
		chunk: Uint8Array;
		chunkIndex: number;
		totalChunks: number;
	}) => void;
	download_complete: (fileId: string) => void;
}

interface FileInfo {
	id: string;
	name: string;
	size: number;
	type: string;
	uploadedBy: string;
	uploadedAt: string;
	roomId: string;
	url?: string;
}

// ==== Real-time Collaboration Events ====
export interface CollaborationClientEvents extends EventsMap {
	// Document operations
	join_document: (documentId: string) => void;
	leave_document: (documentId: string) => void;
	text_change: (data: { documentId: string; operations: TextOperation[] }) => void;
	cursor_position: (data: { documentId: string; position: CursorPosition }) => void;

	// Comments
	add_comment: (data: { documentId: string; position: number; text: string }) => void;
	resolve_comment: (commentId: string) => void;
	reply_comment: (data: { commentId: string; text: string }) => void;
}

export interface CollaborationServerEvents extends EventsMap {
	// Document events
	document_joined: (data: { documentId: string; content: string; version: number }) => void;
	user_joined_document: (data: {
		userId: string;
		documentId: string;
		user: CollaborationUser;
	}) => void;
	user_left_document: (data: { userId: string; documentId: string }) => void;

	// Operational transform
	text_operations: (data: {
		documentId: string;
		operations: TextOperation[];
		version: number;
		authorId: string;
	}) => void;
	cursor_moved: (data: { userId: string; documentId: string; position: CursorPosition }) => void;

	// Comments
	comment_added: (comment: DocumentComment) => void;
	comment_resolved: (commentId: string) => void;
	comment_replied: (data: { commentId: string; reply: CommentReply }) => void;
}

interface TextOperation {
	type: 'insert' | 'delete' | 'retain';
	text?: string;
	length?: number;
	position: number;
}

interface CursorPosition {
	start: number;
	end: number;
	userId: string;
}

interface CollaborationUser {
	id: string;
	name: string;
	color: string;
	cursor?: CursorPosition;
}

interface DocumentComment {
	id: string;
	documentId: string;
	authorId: string;
	authorName: string;
	text: string;
	position: number;
	createdAt: string;
	resolved: boolean;
	replies: CommentReply[];
}

interface CommentReply {
	id: string;
	authorId: string;
	authorName: string;
	text: string;
	createdAt: string;
}

// Export all event types for easy importing
export type {
	GameState,
	Player,
	ChatMessage,
	ChatRoom,
	ChatUser,
	TextOperation,
	CursorPosition,
	CollaborationUser,
	DocumentComment,
	CommentReply,
};
