import 'dotenv/config';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { setupStreamClient } from './stream';
import { buildEmbedMessage } from './embed';

// Initialize Discord Client
const discordBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const setupDiscordBot = async () => {
  await discordBot.login(process.env.DISCORD_BOT_TOKEN);
  console.log('Discord bot connected successfully.');

  const mainChannel = await discordBot.channels.fetch(process.env.DISCORD_CHANNEL_ID!) as TextChannel;
  const offersChannel = await discordBot.channels.fetch(process.env.OFFERS_CHANNEL_ID!) as TextChannel;

  // Handle Stream API Events
  setupStreamClient(async (eventType, payload) => {
    const embed = buildEmbedMessage(eventType, payload);

    if (eventType === 'New Offer') {
      await offersChannel.send({ embeds: [embed] });
    } else if (eventType === 'Item Listed') {
      await mainChannel.send({ embeds: [embed] });
    }
  });
};

setupDiscordBot().catch(console.error);
