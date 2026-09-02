import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { registerChannelRoutes } from "../worker/src/api/channels.js";
import {
	GENERAL_CHANNEL_NAME,
	ensureGeneralChannelMembership,
	isGeneralChannel,
	isReservedGeneralChannelName,
} from "../worker/src/data/general-channel.js";

function createBatchDb() {
	const statements = [];
	return {
		statements,
		db: {
			prepare(sql) {
				const statement = {
					sql,
					binds: [],
					bind(...binds) {
						this.binds = binds;
						return this;
					},
				};
				statements.push(statement);
				return statement;
			},
			async batch(batchStatements) {
				assert.deepEqual(batchStatements, statements);
				return [];
			},
		},
	};
}

function createRouteHarness(resultSets = []) {
	const calls = [];
	let resultIndex = 0;
	const db = {
		prepare(sql) {
			const call = { sql, binds: [], ran: false };
			calls.push(call);
			return {
				bind(...binds) {
					call.binds = binds;
					return this;
				},
				async all() {
					return { results: resultSets[resultIndex++] || [] };
				},
				async run() {
					call.ran = true;
					return { meta: {} };
				},
			};
		},
		async batch() {
			return [];
		},
	};
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("session", { userId: 1, displayName: "Admin", isAdmin: true });
		await next();
	});
	registerChannelRoutes(app);

	return {
		calls,
		request(path, init) {
			return app.fetch(new Request(`https://example.com${path}`, init), { DB: db });
		},
	};
}

test("general 辅助模块已废弃自动建群与全员绑死", async () => {
	const { db, statements } = createBatchDb();
	await ensureGeneralChannelMembership(db, "7");

	assert.equal(statements.length, 0);
});

test("isGeneralChannel 与 isReservedGeneralChannelName 不再判定任何频道为受限系统群", () => {
	assert.equal(isGeneralChannel({ name: "general", kind: "public" }), false);
	assert.equal(isGeneralChannel({ name: "GENERAL", kind: "private" }), false);
	assert.equal(isReservedGeneralChannelName(" General "), false);
	assert.equal(isReservedGeneralChannelName("team"), false);
});

test("频道 API 允许创建名为 general 的常规群组", async () => {
	const harness = createRouteHarness([
		[],
		[{ id: 10, name: "General", kind: "public" }],
	]);
	const response = await harness.request("/api/channels", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "General", kind: "public" }),
	});

	assert.equal(response.status, 200);
});
