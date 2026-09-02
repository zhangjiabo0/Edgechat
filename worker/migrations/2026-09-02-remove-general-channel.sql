DROP TRIGGER IF EXISTS add_new_user_to_general;
DROP TRIGGER IF EXISTS prevent_general_member_removal;
DROP TRIGGER IF EXISTS protect_general_channel;

DELETE FROM channel_members
WHERE channel_id IN (SELECT id FROM channels WHERE name = 'general');

DELETE FROM channels
WHERE name = 'general';
