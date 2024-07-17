import { ErrorEmbed } from "../classes/embeds.js";
import { RefreshUserEntitlements } from "../api/elite.js";
import { Entitlement, Events } from "discord.js";
import { GetPurchaseUpdateChannel } from "../classes/Util.js";

const settings = {
	event: Events.EntitlementDelete,
	execute: execute
}

export default settings;

async function execute(entitlement: Entitlement) {
	if (entitlement.userId) {
		await RefreshUserEntitlements(entitlement.userId);
	}

	const embed = ErrorEmbed('Purchase Refunded!')
		.setDescription(`A purchase was refunded by <@${entitlement.userId}>!`)
		.addFields({
			name: 'Product',
			value: `https://discord.com/application-directory/${entitlement.applicationId}/shop/${entitlement.skuId}`,
		}, {
			name: 'User ID',
			value: '`' + entitlement.userId + '`',
		});

	const channel = await GetPurchaseUpdateChannel(entitlement.client);

	if (channel) {
		channel.send({
			content: `<@${entitlement.userId}>`,
			embeds: [embed]
		});
	}
}