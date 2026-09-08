export async function getSiteSettings(db) {
	const { results } = await db
		.prepare("SELECT setting_key, setting_value FROM site_settings")
		.all();
	const map = Object.fromEntries(
		results.map((row) => [row.setting_key, row.setting_value]),
	);
	return {
		siteName: String(map.site_name || "Edgechat"),
		siteIconUrl: String(map.site_icon_url || ""),
		messageRetentionDays: map.message_retention_days !== undefined ? Number(map.message_retention_days) : 7,
	};
}

export async function updateSiteSettings(db, { siteName, siteIconUrl, messageRetentionDays }) {
	const statements = [];
	if (siteName !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('site_name', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(siteName || "Edgechat").trim() || "Edgechat"),
		);
	}
	if (siteIconUrl !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('site_icon_url', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(siteIconUrl || "").trim()),
		);
	}
	if (messageRetentionDays !== undefined) {
		const days = Math.max(1, Math.floor(Number(messageRetentionDays) || 7));
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('message_retention_days', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(days)),
		);
	}
	if (statements.length) {
		await db.batch(statements);
	}
	return getSiteSettings(db);
}
