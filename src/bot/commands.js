/**
 * Slash command definitions and interaction handler for the wisdom companion.
 */

import { SlashCommandBuilder } from 'discord.js';
import { getWisdomReply } from './wisdom.js';
import { getHistory, appendTurn } from './memory.js';
import { check as rateLimitCheck } from './rate-limit.js';
import { retrieve } from '../rag/retrieve.js';

export function getCommands() {
  return [
    {
      data: new SlashCommandBuilder()
        .setName('wisdom')
        .setDescription('Pause, reflect, or orient within the Living Field. Share what you\'re noticing or ask for grounding.')
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Your question or reflection').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('How you\'d like to engage (optional)')
            .addChoices(
              { name: 'Help me integrate what I\'m noticing', value: 'integration' },
              { name: 'Ask me questions to deepen awareness', value: 'reflection' },
              { name: 'Help me understand this concept', value: 'orientation' },
              { name: 'Help me ground and come back into my space', value: 'stabilization' }
            )
        ),
      execute: handleWisdom,
    },
  ];
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleWisdom(interaction) {
  const userId = interaction.user.id;
  if (!rateLimitCheck(userId)) {
    await interaction.reply({
      content: 'You’re pausing to breathe—that’s wise. when you\'re ready, try again.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const message = interaction.options.getString('message', true);
  const mode = interaction.options.getString('mode') || null;
  const channelKey = interaction.channelId;
  const history = getHistory(channelKey);
  await interaction.deferReply();

  try {
    const styleExcerpts = await retrieve(message, 5);
    const reply = await getWisdomReply(message, history, styleExcerpts || null, mode);
    const questionText = message.slice(0, 400).replace(/\*/g, '\\*');
    const header = `You shared: *${questionText}*\n\n`;
    const maxReplyLen = Math.max(0, 2000 - header.length);
    const content = (header + reply).slice(0, 2000);
    await interaction.editReply({ content });
    appendTurn(channelKey, message, reply);
  } catch (err) {
    console.error('Wisdom reply error:', err);
    await interaction.editReply({
      content: 'Something shifted in the field—please try again in a moment.',
    }).catch(() => {});
  }
}
