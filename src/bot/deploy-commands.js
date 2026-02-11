/**
 * Register slash commands with Discord. Run once after adding/changing commands: npm run deploy
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { getCommands } from './commands.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

const commands = getCommands().map((c) => c.data.toJSON());
const rest = new REST().setToken(token);

try {
  console.log(`Registering ${commands.length} slash command(s)...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('Done.');
} catch (e) {
  console.error(e);
  process.exit(1);
}
