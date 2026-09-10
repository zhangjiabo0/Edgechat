import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";
import { runScheduledGc } from "../worker/src/gc.js";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();

function createEnvironment(hasR2 = true) {
	const database = new SQL.Database();
	database.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
	const r2Files = new Map();

	return {
		database,
		env: {
			DB: createD1Adapter(database),
			FILES: hasR2
				? {
						async delete(key) {
							r2Files.delete(key);
						},
				  }
				: undefined,
		},
		r2Files,
	};
}

test("定时 GC 清理过期消息时同步删除 uploaded_files 表中的关联记录（即使没有 R2 绑定）", async () => {
	const { database, env } = createEnvironment(false);

	// 插入用户和频道
	database.run("INSERT INTO users (username, display_name, password_hash, password_salt) VALUES ('alice', 'Alice', 'hash', 'salt')");
	database.run("INSERT INTO channels (name, kind) VALUES ('general', 'public')");

	// 插入上传文件记录
	database.run("INSERT INTO uploaded_files (object_key, owner_user_id, filename) VALUES ('file-123', 1, 'test.pdf')");

	// 插入包含该附件的旧消息（10 天前）
	database.run(
		"INSERT INTO messages (channel_id, sender_id, content, attachment_key, created_at) VALUES (1, 1, 'hello', 'file-123', datetime('now', '-10 day'))"
	);

	// 确保运行前 uploaded_files 存在该记录
	const beforeCount = database.exec("SELECT COUNT(*) FROM uploaded_files WHERE object_key = 'file-123'")[0].values[0][0];
	assert.equal(beforeCount, 1);

	// 执行 GC，设置保留 7 天
	const summary = await runScheduledGc({
		...env,
		MESSAGE_RETENTION_DAYS: "7",
		GC_BATCH_SIZE: "10",
	});

	assert.equal(summary.expiredMessagesDeleted, 1);
	assert.equal(summary.uploadedFilesDeleted, 1);

	// 验证 uploaded_files 表中的关联记录已被删除
	const afterCount = database.exec("SELECT COUNT(*) FROM uploaded_files WHERE object_key = 'file-123'")[0].values[0][0];
	assert.equal(afterCount, 0);
});

test("定时 GC 清理未关联任何消息/头像的孤儿 uploaded_files 记录", async () => {
	const { database, env } = createEnvironment(true);

	database.run("INSERT INTO users (username, display_name, password_hash, password_salt) VALUES ('bob', 'Bob', 'hash', 'salt')");
	database.run("INSERT INTO uploaded_files (object_key, owner_user_id, filename) VALUES ('orphan-file', 1, 'orphan.png')");

	const summary = await runScheduledGc({
		...env,
		MESSAGE_RETENTION_DAYS: "7",
		GC_BATCH_SIZE: "10",
	});

	assert.equal(summary.uploadedFilesDeleted, 1);

	const count = database.exec("SELECT COUNT(*) FROM uploaded_files WHERE object_key = 'orphan-file'")[0].values[0][0];
	assert.equal(count, 0);
});
