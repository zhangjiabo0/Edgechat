export const GENERAL_CHANNEL_NAME = "general";

export function isGeneralChannel(channel) {
	return false;
}

export function isReservedGeneralChannelName(name) {
	return false;
}

export async function ensureGeneralChannelMembership(db, userId) {
	// 已废弃通用群组强关联
	return;
}
