# AngelBot — Fifth-Dimensional Wisdom Companion

A Discord bot that speaks as a fifth-dimensional wisdom companion: supportive, empowering, and non-authoritarian. It uses a fixed system identity plus optional RAG over your own transcribed or channeled style-guide documents.

## Requirements

- Node.js 18+
- A [Discord application](https://discord.com/developers/applications) (Bot token + Application ID)
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

1. **Clone or open the project** and install dependencies:

   ```bash
   npm install
   ```

2. **Configure environment**

   Copy the example env file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set:

   - `DISCORD_BOT_TOKEN` — Bot token from Discord Developer Portal → your app → Bot → Reset Token / Copy
   - `DISCORD_CLIENT_ID` — Application ID from Discord Developer Portal → your app → General Information → Application ID
   - `OPENAI_API_KEY` — Your OpenAI API key

   Optional (see `.env.example`):

   - `OPENAI_CHAT_MODEL` — Chat model (default: `gpt-4o-mini`)
   - `OPENAI_EMBEDDING_MODEL` — For RAG (default: `text-embedding-3-small`)
   - `STYLE_GUIDES_PATH` — Folder for style-guide files (default: `data/style-guides`)
   - `MAX_HISTORY_TURNS` — Conversation history length per channel (default: 10)
   - `RATE_LIMIT_PER_MINUTE` — Max `/wisdom` requests per user per minute (default: 5)

3. **Register the slash command**

   Run once (and again if you change commands):

   ```bash
   npm run deploy
   ```

4. **Invite the bot to your server**

   In Discord Developer Portal → your app → OAuth2 → URL Generator:

   - Scopes: **bot**
   - Bot permissions: **Use Application Commands**, **Send Messages**, **Read Message History** (and any you need for the channels it will use)

   Open the generated URL in your browser and select the server to invite the bot.

5. **Start the bot**

   ```bash
   npm start
   ```

   In Discord, use the `/wisdom` command and enter your message to talk to the companion.

## Style guides (RAG)

To shape the bot’s tone with your own material (transcripts, channeled text, etc.):

1. Add `.txt` or `.md` files into `data/style-guides/` (or the path set in `STYLE_GUIDES_PATH`).
2. Run ingestion so the bot can use them:

   ```bash
   npm run ingest
   ```

   This chunks the files, computes embeddings, and saves them to `data/embeddings.json`. Re-run after adding or editing style-guide files.

The bot will use the written system prompt plus up to 5 relevant excerpts from these files when answering.

## Scripts

| Command        | Description                                      |
|----------------|--------------------------------------------------|
| `npm start`    | Start the Discord bot                            |
| `npm run deploy` | Register slash commands with Discord (run once) |
| `npm run ingest` | Chunk and embed style-guide files for RAG       |

## DM usage

The bot works in any channel where it can read and send messages. For private reflection, invite the bot and open a DM; use `/wisdom` there. Conversation history is kept per channel (including each DM channel).

## Troubleshooting

- **“OPENAI_API_KEY is not set”** — Ensure `.env` exists and contains `OPENAI_API_KEY`.
- **Slash command not visible** — Run `npm run deploy` and wait a few minutes; ensure the bot has “Use Application Commands” and is in the server.
- **Empty or generic style** — Add files to `data/style-guides/` and run `npm run ingest`.
