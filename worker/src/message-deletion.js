import { softDeleteMessage } from "./data/messages.js";
import { authorizeRoom } from "./room-access.js";

export class MessageDeletionError extends Error {
	constructor(message) {
		super(message);
		this.name = "MessageDeletionError";
	}
}

export function createMessageDeletion({
	authorize = authorizeRoom,
	persistDeletion = softDeleteMessage,
} = {}) {
	return async function deleteRoomMessage(env, meta, payload) {
		const messageId = Number(payload.messageId);
		if (!Number.isInteger(messageId) || messageId <= 0) {
			throw new MessageDeletionError("消息不存在");
		}

		const access = await authorize(
			env.DB,
			meta.principal,
			meta.room?.kind || "private",
			meta.room?.id || 0,
		);
		if (!access.ok) {
			throw new MessageDeletionError("无权删除该消息");
		}

		let targetMessage = null;
		if (typeof env.DB?.prepare === "function") {
			const { results } = await env.DB.prepare(
				`SELECT sender_id, attachment_key
				 FROM messages
				 WHERE id = ?
				   AND channel_id = ?
				   AND deleted_at IS NULL
				 LIMIT 1`
			)
				.bind(messageId, Number(meta.room.id))
				.all();
			targetMessage = results[0];
		}

		if (targetMessage) {
			const isSender = Number(targetMessage.sender_id) === Number(meta.principal?.userId);
			const isAdmin = Boolean(meta.principal?.isAdmin);

			let isOwner = false;
			if (meta.room?.kind !== "dm" && typeof env.DB?.prepare === "function") {
				const { results: memberRes } = await env.DB.prepare(
					`SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1`
				)
					.bind(Number(meta.room.id), Number(meta.principal?.userId))
					.all();
				if (memberRes[0]?.role === "owner") {
					isOwner = true;
				}
			}

			if (!isSender && !isAdmin && !isOwner) {
				throw new MessageDeletionError("无权删除该消息");
			}
		}

		const deleted = await persistDeletion(env.DB, {
			channelId: meta.room.id,
			messageId,
		});
		if (!deleted) {
			throw new MessageDeletionError("消息不存在或已被删除");
		}

		const attachmentKey = targetMessage?.attachment_key;
		if (attachmentKey) {
			if (env.FILES) {
				try {
					await env.FILES.delete(attachmentKey);
				} catch (err) {
					console.error(`物理删除 R2 文件 ${attachmentKey} 失败:`, err);
				}
			}
			if (typeof env.DB?.prepare === "function") {
				await env.DB.prepare(`DELETE FROM uploaded_files WHERE object_key = ?`).bind(attachmentKey).run().catch(() => {});
			}
		}

		return {
			messageId,
			packet: JSON.stringify({ protocolVersion: 1, type: "message_deleted", messageId }),
		};
	};
}

export const deleteRoomMessage = createMessageDeletion();
