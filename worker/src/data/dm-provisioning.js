export async function ensureDmChannel(db, actorId, targetUserId) {
	const dmKey = [Number(actorId), Number(targetUserId)]
		.sort((left, right) => left - right)
		.join(":");
	const existing = await db
		.prepare(
			`SELECT id, name, dm_key FROM channels
			 WHERE kind = 'dm' AND dm_key = ? AND deleted_at IS NULL LIMIT 1`,
		)
		.bind(dmKey)
		.all();
	if (existing.results[0]) {
		return existing.results[0];
	}

	// 清理可能遗留的已删除同key旧私聊，释放dm_key与name的UNIQUE约束
	await db
		.prepare(
			`UPDATE channels
			 SET dm_key = NULL, name = 'deleted:' || id || ':' || name
			 WHERE kind = 'dm' AND (dm_key = ? OR name = ? OR name LIKE ?) AND deleted_at IS NOT NULL`,
		)
		.bind(dmKey, dmKey, `dm:${dmKey}:%`)
		.run();

	const uniqueName = `dm:${dmKey}:${Date.now()}`;
	const created = await db
		.prepare(
			`INSERT INTO channels (name, description, kind, dm_key, created_by)
			 VALUES (?, '', 'dm', ?, ?)`,
		)
		.bind(uniqueName, dmKey, Number(actorId))
		.run();
	const channelId = created.meta.last_row_id;
	await db.batch([
		db
			.prepare(
				`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
				 VALUES (?, ?, 'member', ?)`,
			)
			.bind(channelId, Number(actorId), Number(actorId)),
		db
			.prepare(
				`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
				 VALUES (?, ?, 'member', ?)`,
			)
			.bind(channelId, Number(targetUserId), Number(actorId)),
	]);
	return { id: channelId, name: dmKey, dm_key: dmKey };
}
