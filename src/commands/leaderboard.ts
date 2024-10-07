import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	ComponentType,
	SlashCommandBuilder,
} from 'discord.js';
import { components } from '../api/api.js';
import { FetchAccount, FetchLeaderboardRank, FetchLeaderboardSlice, UserSettings } from '../api/elite.js';
import { autocomplete as lbAuto, leaderboardOption } from '../autocomplete/leaderboard.js';
import { autocomplete as playerAuto, playerOption } from '../autocomplete/player.js';
import { Command, CommandAccess, CommandType } from '../classes/commands/index.js';
import { EliteEmbed, ErrorEmbed } from '../classes/embeds.js';

const command: Command = {
	name: 'leaderboard',
	description: 'Get a leaderboard',
	usage: '(username)',
	access: CommandAccess.Everywhere,
	type: CommandType.Slash,
	autocomplete: {
		player: playerAuto,
		name: lbAuto,
	},
	slash: new SlashCommandBuilder()
		.setName('leaderboard')
		.setDescription('Get a leaderboard!')
		.addStringOption(leaderboardOption())
		.addStringOption(playerOption())
		.addIntegerOption((option) =>
			option.setName('rank').setDescription('Jump to a specific rank!').setMinValue(1).setRequired(false),
		),
	execute: execute,
};

export default command;

async function execute(interaction: ChatInputCommandInteraction, settings?: UserSettings) {
	let playerName = interaction.options.getString('player', false) ?? undefined;
	const leaderboardId = interaction.options.getString('name', false) ?? '';

	await interaction.deferReply();

	let givenIndex = 0;

	if (playerName !== undefined) {
		const player = await FetchAccount(playerName)
			.then((res) => {
				return res.data;
			})
			.catch(() => undefined);
		const selectedProfile = player?.profiles?.find((p) => p?.selected) ?? player?.profiles?.[0];

		if (!selectedProfile?.profileId) {
			const embed = ErrorEmbed('Invalid User!').setDescription(`User "${playerName}" does not exist.`).addFields({
				name: 'Proper Usage:',
				value: '`/leaderboard` `player:`(player name)',
			});
			await interaction.deleteReply().catch(() => undefined);
			interaction.followUp({ embeds: [embed], ephemeral: true });
			return;
		}

		const rank = await FetchLeaderboardRank(leaderboardId, player?.id ?? '', selectedProfile?.profileId)
			.then((res) => {
				return res.data?.rank;
			})
			.catch(() => undefined);

		if (player) {
			givenIndex = rank ?? 0;
			playerName = player.name;
		}
	} else {
		givenIndex = (interaction.options.getInteger('rank', false) ?? 0) - 1;
	}

	let index = Math.max(Math.floor(givenIndex / 12) * 12, 0);
	let maxIndex = 1000;
	let entries: components['schemas']['LeaderboardEntryDto'][] = [];

	const lb = await FetchLeaderboard(leaderboardId, index, 12)
		.then((res) => {
			return res.data;
		})
		.catch(() => undefined);

	if (!lb) {
		const embed = ErrorEmbed('Failed to Fetch Leaderboard!').setDescription(
			'Please try again later. If this issue persists, contact `kaeso.dev` on Discord.',
		);
		await interaction.deleteReply().catch(() => undefined);
		interaction.followUp({ embeds: [embed], ephemeral: true });
		return;
	}
	const title = (lb.title ?? '') + ' Leaderboard';

	maxIndex = (lb.maxEntries ?? 1000) - 12;
	entries = lb.entries ?? [];

	const embed = await getEmbed(settings, index, maxIndex, leaderboardId, title, entries);
	if (!embed) {
		const errorEmbed = ErrorEmbed('Failed to Fetch Leaderboard!')
			.setDescription('Please try again later. If this issue persists, contact `kaeso.dev` on Discord.')
			.addFields({
				name: 'Proper Usage:',
				value: '`/leaderboard` `player:`(player name)',
			})
			.addFields({
				name: 'Want to view the leaderboard online?',
				value: 'Please go to [elitebot.dev/leaderboard/farmingweight](https://elitebot.dev/leaderboard/farmingweight)',
			});
		interaction.editReply({ embeds: [errorEmbed] });
		return;
	}

	const reply = await interaction.editReply({
		embeds: [embed],
		components: [getButtonRow(index, maxIndex)],
	});

	const collector = reply.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: 60_000,
	});

	collector.on('collect', async (i) => {
		if (i.user.id === interaction.user.id) {
			collector.resetTimer({ time: 30_000 });

			if (i.customId === 'first') {
				index = 0;
			} else if (i.customId === 'back') {
				if (index >= 12) {
					index -= 12;
				}
			} else if (i.customId === 'forward') {
				if (index < maxIndex) {
					index += 12;
				}
			} else if (i.customId === 'last') {
				if (index !== maxIndex) {
					index = maxIndex;
				}
			}

			const newEmbed = await getEmbed(settings, index, maxIndex, leaderboardId, title);

			if (!newEmbed) {
				const errorEmbed = ErrorEmbed('Failed to Fetch Leaderboard!')
					.setDescription('Please try again later. If this issue persists, contact `kaeso.dev` on Discord.')
					.addFields({
						name: 'Proper Usage:',
						value: '`/leaderboard` `player:`(player name)',
					})
					.addFields({
						name: 'Want to view the leaderboard online?',
						value: `Please go to [elitebot.dev/leaderboard/${leaderboardId}](https://elitebot.dev/leaderboard/${leaderboardId})`,
					});

				i.followUp({ embeds: [errorEmbed], ephemeral: true });
				collector.stop();
			} else {
				i.update({
					embeds: [newEmbed],
					components: [getButtonRow(index, maxIndex)],
				}).catch(() => {
					collector.stop();
				});
			}
		} else {
			i.reply({ content: `These buttons aren't for you!`, ephemeral: true });
		}
	});

	collector.on('end', async () => {
		interaction.editReply({ components: [] }).catch(() => undefined);
	});
}

async function getEmbed(
	settings: UserSettings | undefined = undefined,
	index: number,
	maxIndex: number,
	leaderboardId: string,
	title: string,
	entries?: components['schemas']['LeaderboardEntryDto'][],
) {
	if (!entries) {
		entries = await FetchLeaderboard(leaderboardId, index, 12)
			.then((res) => {
				return res.data?.entries;
			})
			.catch(() => undefined);
	}

	if (!entries) return undefined;

	const embed = EliteEmbed(settings)
		.setTitle(title)
		.setDescription(
			`Showing **${index + 1}** - **${index + entries.length}** of **${(maxIndex + 12).toLocaleString()}** entries! [⧉](https://elitebot.dev/leaderboard/${leaderboardId}/${index + 1})`,
		);

	const profileLb = entries[0]?.members?.length;
	if (profileLb) {
		embed.addFields(getProfileLbFields(entries, index));
	} else {
		embed.addFields(getPlayerLbFields(entries, index));
	}

	return embed;
}

function getPlayerLbFields(entries: components['schemas']['LeaderboardEntryDto'][], index: number) {
	return entries.map((entry, i) => ({
		name: `#${index + i + 1} ${entry.ign?.replaceAll('_', '\\_') ?? 'Unknown'}⠀`,
		value: `[⧉](https://elitebot.dev/@${entry.ign}/${encodeURIComponent(entry.profile ?? '')}) ${(entry.amount ?? 0).toLocaleString()}`,
		inline: true,
	}));
}

function getProfileLbFields(entries: components['schemas']['LeaderboardEntryDto'][], index: number) {
	return entries.map((entry, i) => {
		const firstMember = entry.members?.[0];
		const otherMembers = entry.members?.slice(1, 3);
		let members = '\n-# ';

		if (!otherMembers?.length) {
			members = '';
		} else {
			members += otherMembers.map((m) => m.ign.replaceAll('_', '\\_')).join(', ');
		}

		if (members.length > 24) {
			members = members.slice(0, 24) + '...';
		}

		if (entry.members?.length && entry.members.length > 3) {
			members += ' **+' + (entry.members.length - 3) + '**';
		}

		return {
			name: `#${index + i + 1} ${firstMember?.ign?.replaceAll('_', '\\_') ?? 'Unknown'}⠀`,
			value: `[⧉](https://elitebot.dev/@${firstMember?.ign}/${encodeURIComponent(entry.uuid ?? '')}/garden) ${(entry.amount ?? 0).toLocaleString()}${members}`,
			inline: true,
		};
	});
}

function getButtonRow(index: number, maxIndex = 1000) {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('first')
			.setLabel('First')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(index < 12),
		new ButtonBuilder()
			.setCustomId('back')
			.setLabel('Back')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(index < 12),
		new ButtonBuilder()
			.setCustomId('forward')
			.setLabel('Next')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(index + 12 > maxIndex),
		new ButtonBuilder()
			.setCustomId('last')
			.setLabel('Last')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(index + 12 > maxIndex),
		new ButtonBuilder()
			.setURL(`https://elitebot.dev/leaderboard/farmingweight/${index}`)
			.setStyle(ButtonStyle.Link)
			.setLabel('View Online'),
	);
}

function FetchLeaderboard(leaderboardId: string, offset: number, limit: number) {
	return FetchLeaderboardSlice(leaderboardId, offset, limit);
}
