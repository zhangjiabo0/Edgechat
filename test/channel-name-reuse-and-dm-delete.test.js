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

function createTestDatabase(options = {}) {
	const db = new SQL.Database();
	let schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
	if (options.withLegacyUniqueConstraint) {
		schema = schema.replace("name TEXT NOT NULL,", "name TEXT NOT NULL UNIQUE,");
	}
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

test("即使存在底层 UNIQUE 约束，添加同名群聊（已删除或未删除）也绝不报错 500", async () => {
	// 强制带有 UNIQUE 约束，模拟生产未迁移环境
	const { d1 } = createTestDatabase({ withLegacyUniqueConstraint: true });

	await d1.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'u1', 'User 1', 'h', 's')").run();

	const session = { userId: 1, isAdmin: false, username: 'u1', displayName: 'User 1' };
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('session', session);
		c.env = { DB: d1 };
		await next();
	});
	registerChannelRoutes(app);

	// 1. 创建第一个同名群聊
	const res1 = await app.request('/api/channels', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: '测试同名群', kind: 'public' }),
	});
	assert.equal(res1.status, 200);
	const data1 = await res1.json();
	assert.equal(data1.channel.name, '测试同名群');

	// 2. 创建第二个同名群聊（此时第一个未删除），绝不报 500
	const res2 = await app.request('/api/channels', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: '测试同名群', kind: 'public' }),
	});
	assert.equal(res2.status, 200);
	const data2 = await res2.json();
	assert.equal(data2.channel.name, '测试同名群');
	assert.notEqual(data1.channel.id, data2.channel.id);

	// 3. 删除第一个群聊后，再创建第三个同名群聊，绝不报 500
	const delRes = await app.request(`/api/channels/${data1.channel.id}`, { method: 'DELETE' });
	assert.equal(delRes.status, 200);

	const res3 = await app.request('/api/channels', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: '测试同名群', kind: 'public' }),
	});
	assert.equal(res3.status, 200);
	const data3 = await res3.json();
	assert.equal(data3.channel.name, '测试同名群');
});

test("普通群成员可以删除群聊中的自己，群主不可直接移除自己", async () => {
	const { d1 } = createTestDatabase({ withLegacyUniqueConstraint: true });
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

	// 1. 普通成员删除自己 -> 成功
	const resSelf = await app.request('/api/channels/10/members/2', {
		method: 'DELETE',
	});
	assert.equal(resSelf.status, 200);
	const dataSelf = await resSelf.json();
	assert.equal(dataSelf.ok, true);

	// 2. 群主尝试移除自己 -> 400 提示不能移除群主
	session = { userId: 1, isAdmin: false, username: 'owner', displayName: 'Owner' };
	const resOwner = await app.request('/api/channels/10/members/1', {
		method: 'DELETE',
	});
	assert.equal(resOwner.status, 400);
	const dataOwner = await resOwner.json();
	assert.match(dataOwner.error, /不能移除群主/);
});

test("删除私聊后再次添加私聊绝不报 500，且对方会话收到删除通知", async () => {
	// 强制包含 UNIQUE 约束测试生产容错
	const { d1 } = createTestDatabase({ withLegacyUniqueConstraint: true });
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

	let session = { userId: 1, isAdmin: false, username: 'alice', displayName: 'Alice' };
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('session', session);
		c.env = env;
		await next();
	});
	registerDmRoutes(app);

	// 1. 打开与 Bob 的私聊
	const openRes1 = await app.request('/api/dm/open', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId: 2 }),
	});
	assert.equal(openRes1.status, 200);
	const dm1 = (await openRes1.json()).dm;
	assert.ok(dm1.id > 0);

	// 2. Bob 删除私聊
	session = { userId: 2, isAdmin: false, username: 'bob', displayName: 'Bob' };
	const delRes = await app.request(`/api/dm/${dm1.id}`, { method: 'DELETE' });
	assert.equal(delRes.status, 200);

	// 3. 再次添加与 Bob 的私聊 -> 必须成功且绝不报 500！
	session = { userId: 1, isAdmin: false, username: 'alice', displayName: 'Alice' };
	const openRes2 = await app.request('/api/dm/open', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId: 2 }),
	});
	assert.equal(openRes2.status, 200);
	const dm2 = (await openRes2.json()).dm;
	assert.ok(dm2.id > 0);
	assert.notEqual(dm1.id, dm2.id);

	// 4. 重复多次删除与再次添加，均稳定无异常
	session = { userId: 1, isAdmin: false, username: 'alice', displayName: 'Alice' };
	const delRes2 = await app.request(`/api/dm/${dm2.id}`, { method: 'DELETE' });
	assert.equal(delRes2.status, 200);

	const openRes3 = await app.request('/api/dm/open', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId: 2 }),
	});
	assert.equal(openRes3.status, 200);
});
