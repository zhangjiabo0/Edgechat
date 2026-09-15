import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js/dist/sql-asm-debug.js";
import { Hono } from "hono";

import { registerChannelRoutes } from "../worker/src/api/channels.js";
import { registerDmRoutes } from "../worker/src/api/dm.js";
import { ensureDmChannel } from "../worker/src/data/dm-provisioning.js";

const SQL = await initSqlJs({
	locateFile(file) {
		return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
	},
});

function createTestDatabase() {
	const db = new SQL.Database();
	const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
	db.exec(schema);

	function wrapD1(sqliteDb) {
		return {
			prepare(query) {
				return {
					bind(...params) {
						return {
							async all() {
								const stmt = sqliteDb.prepare(query);
								stmt.bind(params);
								const results = [];
								while (stmt.step()) {
									results.push(stmt.getAsObject());
								}
								stmt.free();
								return { results };
							},
							async first() {
								const stmt = sqliteDb.prepare(query);
								stmt.bind(params);
								let result = null;
								if (stmt.step()) {
									result = stmt.getAsObject();
								}
								stmt.free();
								return result;
							},
							async run() {
								sqliteDb.run(query, params);
								const lastId = sqliteDb.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] || 0;
								const changes = sqliteDb.getRowsModified();
								return { meta: { last_row_id: lastId, changes } };
							},
						};
					},
					async all() {
						return this.bind().all();
					},
					async first() {
						return this.bind().first();
					},
					async run() {
						return this.bind().run();
					},
				};
			},
			async batch(statements) {
				const results = [];
				for (const statement of statements) {
					results.push(await statement.run());
				}
				return results;
			},
		};
	}

	return { raw: db, d1: wrapD1(db) };
}

test("群聊名称允许重复使用（无论未删除还是已删除）", async () => {
	const { d1 } = createTestDatabase();

	// 插入用户
	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'u1', 'User 1', 'h', 's')").run();

	// 插入第一个群组
	const g1 = await d1.prepare(
		"INSERT INTO channels (name, description, kind, created_by) VALUES (?, ?, ?, ?)"
	).bind("开发讨论群", "desc 1", "public", 1).run();
	assert.ok(g1.meta.last_row_id > 0);

	// 再次插入同名未删除群组，不再触发 UNIQUE 约束错误
	const g2 = await d1.prepare(
		"INSERT INTO channels (name, description, kind, created_by) VALUES (?, ?, ?, ?)"
	).bind("开发讨论群", "desc 2", "public", 1).run();
	assert.ok(g2.meta.last_row_id > 0);
	assert.notEqual(g1.meta.last_row_id, g2.meta.last_row_id);

	// 软删除第一个群组
	await d1.prepare("UPDATE channels SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(g1.meta.last_row_id).run();

	// 再次插入同名群组
	const g3 = await d1.prepare(
		"INSERT INTO channels (name, description, kind, created_by) VALUES (?, ?, ?, ?)"
	).bind("开发讨论群", "desc 3", "private", 1).run();
	assert.ok(g3.meta.last_row_id > 0);
});

test("普通群成员可以删除群聊中的自己，群主不可直接移除自己", async () => {
	const { d1 } = createTestDatabase();
	const notifications = [];
	const env = {
		DB: d1,
		USER_INBOX: {
			idFromName: (name) => name,
			get: () => ({
				fetch: async (_url, init) => {
					notifications.push(JSON.parse(init.body));
					return new Response(JSON.stringify({ ok: true }));
				},
			}),
		},
	};

	// 准备用户与群
	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'owner', 'Owner', 'h', 's')").run();
	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (2, 'member', 'Member', 'h', 's')").run();
	await d1.prepare("INSERT INTO channels (id, name, kind, created_by) VALUES (10, 'Team', 'public', 1)").run();
	await d1.prepare("INSERT INTO channel_members (channel_id, user_id, role) VALUES (10, 1, 'owner')").run();
	await d1.prepare("INSERT INTO channel_members (channel_id, user_id, role) VALUES (10, 2, 'member')").run();

	let session = { userId: 2, isAdmin: false, username: 'member', displayName: 'Member' };
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('session', session);
		c.env = env;
		await next();
	});
	registerChannelRoutes(app);

	// 1. 普通成员 (id: 2) 删除自己 (userId: 2) -> 应该成功
	const resSelf = await app.request('/api/channels/10/members/2', {
		method: 'DELETE',
	});
	assert.equal(resSelf.status, 200);
	const dataSelf = await resSelf.json();
	assert.equal(dataSelf.ok, true);
	assert.equal(dataSelf.members.length, 1);
	assert.equal(dataSelf.members[0].id, 1);
	// 验证向用户 2 发送了 room_deleted 通知
	assert.ok(notifications.some((n) => n.type === 'room_deleted' && n.room?.id === 10));

	// 2. 群主 (id: 1) 尝试移除自己 (userId: 1) -> 应该被拒绝
	session = { userId: 1, isAdmin: false, username: 'owner', displayName: 'Owner' };
	const resOwner = await app.request('/api/channels/10/members/1', {
		method: 'DELETE',
	});
	assert.equal(resOwner.status, 400);
	const dataOwner = await resOwner.json();
	assert.match(dataOwner.error, /不能移除群主/);
});

test("私聊会话双方均可删除，且对方收到通知，重开私聊正常建立", async () => {
	const { d1 } = createTestDatabase();
	const notifiedUsers = [];
	const env = {
		DB: d1,
		USER_INBOX: {
			idFromName: (name) => name,
			get: (id) => ({
				fetch: async (_url, init) => {
					notifiedUsers.push({ id, payload: JSON.parse(init.body) });
					return new Response(JSON.stringify({ ok: true }));
				},
			}),
		},
	};

	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's')").run();
	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (2, 'bob', 'Bob', 'h', 's')").run();
	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (3, 'stranger', 'Stranger', 'h', 's')").run();

	// Alice 与 Bob 开启私聊
	const dm1 = await ensureDmChannel(d1, 1, 2);
	assert.ok(dm1.id > 0);

	let session = { userId: 3, isAdmin: false, username: 'stranger', displayName: 'Stranger' };
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('session', session);
		c.env = env;
		await next();
	});
	registerDmRoutes(app);

	// 1. 无关的第三方 Stranger 尝试删除此私聊 -> 应该被 403 拒绝
	const resStranger = await app.request(`/api/dm/${dm1.id}`, { method: 'DELETE' });
	assert.equal(resStranger.status, 403);

	// 2. Bob (用户 2) 删除私聊 -> 应该成功
	session = { userId: 2, isAdmin: false, username: 'bob', displayName: 'Bob' };
	const resBob = await app.request(`/api/dm/${dm1.id}`, { method: 'DELETE' });
	assert.equal(resBob.status, 200);
	const dataBob = await resBob.json();
	assert.equal(dataBob.ok, true);

	// 验证双方都收到了 room_deleted 通知
	const deletedNotifications = notifiedUsers.filter((item) => item.payload.type === 'room_deleted' && item.payload.room?.id === dm1.id);
	assert.ok(deletedNotifications.length >= 2);

	// 验证旧 DM 的 dm_key 已被置空
	const oldDm = await d1.prepare("SELECT dm_key, deleted_at FROM channels WHERE id = ?").bind(dm1.id).first();
	assert.equal(oldDm.dm_key, null);
	assert.ok(oldDm.deleted_at !== null);

	// 3. 之后 Alice 与 Bob 再次开启私聊 -> 应能成功创建全新私聊，无 UNIQUE 冲突
	const dm2 = await ensureDmChannel(d1, 1, 2);
	assert.ok(dm2.id > 0);
	assert.notEqual(dm2.id, dm1.id);
});
