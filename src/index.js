/**
 * AngelBot — Fifth-Dimensional Wisdom Companion (Discord)
 * Entry: load env, create client, register commands, login.
 */

import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getCommands } from './bot/commands.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commandList = getCommands();
const commandMap = new Map(commandList.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, (c) => {
  console.log(`Ready as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (cmd) await cmd.execute(interaction);
});

client.login(token);
