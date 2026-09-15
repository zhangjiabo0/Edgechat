import { ensureDmChannel } from '../data/dm-provisioning.js';
import { listAdminDms, listUserDms } from '../data/dm-queries.js';
import { listRoomMemberIds } from '../data/unread.js';
import { notifyUserInbox } from '../do-bridge.js';
import { getChannelMembership } from '../room-access.js';
import { errorResponse, parseJsonRequest } from '../utils.js';
import { activeUserSql } from '../user-status.js';

export function registerDmRoutes(app) {
  app.get('/api/dm', async (c) => {
    const session = c.get('session');
    const dms = await listUserDms(c.env.DB, session.userId, c.env);
    return c.json({ dms });
  });

  app.post('/api/dm/open', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const targetUserId = Number(payload.userId);

    if (!Number.isFinite(targetUserId) || targetUserId === session.userId) {
      return errorResponse('请选择有效用户');
    }

    const targetUser = await c.env.DB.prepare(
      `SELECT id, username, display_name, avatar_key
       FROM users
       WHERE id = ?
         AND ${activeUserSql()}
         AND deleted_at IS NULL
       LIMIT 1`
    )
      .bind(targetUserId)
      .all();

    if (!targetUser.results[0]) {
      return errorResponse('目标用户不存在', 404);
    }

    const channel = await ensureDmChannel(c.env.DB, session.userId, targetUserId);
    return c.json({
      dm: {
        id: Number(channel.id),
        kind: 'dm',
        name: channel.dm_key,
        otherUser: {
          id: Number(targetUser.results[0].id),
          username: targetUser.results[0].username,
          displayName: targetUser.results[0].display_name,
          avatarUrl: targetUser.results[0].avatar_key
            ? `/files/${encodeURIComponent(targetUser.results[0].avatar_key)}`
            : ''
        }
      }
    });
  });

  app.delete('/api/dm/:channelId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    if (!Number.isFinite(channelId)) {
      return errorResponse('私聊不存在', 404);
    }

    const channel = await c.env.DB.prepare(
      `SELECT id, kind, dm_key FROM channels WHERE id = ? AND kind = 'dm' AND deleted_at IS NULL LIMIT 1`
    )
      .bind(channelId)
      .first();

    if (!channel) {
      return errorResponse('私聊不存在', 404);
    }

    const membership = await getChannelMembership(c.env.DB, channelId, session.userId);
    if (!membership && !session.isAdmin) {
      return errorResponse('无权删除此私聊', 403);
    }

    const memberIds = await listRoomMemberIds(c.env.DB, channelId);

    await c.env.DB.prepare(
      `UPDATE channels
       SET deleted_at = CURRENT_TIMESTAMP,
           dm_key = NULL,
           name = 'deleted:' || id || ':' || name
       WHERE id = ? AND kind = 'dm' AND deleted_at IS NULL`
    )
      .bind(channelId)
      .run();

    for (const userId of memberIds) {
      notifyUserInbox(c.env, userId, {
        protocolVersion: 1,
        type: 'room_deleted',
        room: {
          id: channelId,
          kind: 'dm'
        }
      }).catch(() => {});
    }

    return c.json({ ok: true });
  });

  app.get('/api/admin/dms', async (c) => {
    const dms = await listAdminDms(c.env.DB);
    return c.json({ dms });
  });
}
