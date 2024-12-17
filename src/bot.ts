import 'dotenv/config';
import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { OpenSeaStreamClient, Network } from '@opensea/stream-js';
import { WebSocket } from 'ws';
import axios, { AxiosError } from 'axios';
import fs from 'fs';

// Discord Bot Initialization
const discordBot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Function to Build Discord Embed Message

const fetchAssetDetails = async (chain: string, contractAddress: string, tokenId: string) => {
  try {
    const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`;
    console.log('🔍 Fetching asset details from OpenSea API v2:', url);

    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'x-api-key': process.env.OPENSEA_API_KEY || '', // Use OpenSea API key
      },
    });

    return response.data.nft.traits || [];
  } catch (error) {
    if (error instanceof AxiosError) {
      // Safely access AxiosError properties
      console.error('❌ Failed to fetch asset details:', error.response?.status, error.response?.data);
    } else {
      console.error('❌ Unknown error:', error);
    }
    return [];
  }
};



const findBoost = (traits: any[], key: string) => {
  const boost = traits.find(
    (trait: any) => trait.trait_type?.toLowerCase() === key.toLowerCase()
  );
  return boost ? `${boost.value}` : 'N/A';
};

export const buildEmbedMessage = async (eventType: string, payload: any): Promise<EmbedBuilder> => {
  console.log('🔍 Building Embed - Event Type:', eventType);

  const { item = {}, base_price = null, payment_token = {} } = payload || {};
  const nftName = item?.metadata?.name || 'Unnamed NFT';
  const imageUrl =
    item?.metadata?.image_url || 'https://opensea.io/static/images/logos/opensea-logo.png';
  const assetUrl = item?.permalink || 'https://opensea.io';

  // Extract Chain, Contract Address, and Token ID
  const chain = 'ethereum'; // Replace with correct chain, e.g., 'amoy' for testnet
  const contractAddress = item?.nft_id?.split('/')[1] || '';
  const tokenId = item?.nft_id?.split('/')[2] || '';

  console.log('🔍 Contract Address:', contractAddress, 'Token ID:', tokenId);

  // Fetch traits dynamically
  const traits = await fetchAssetDetails(chain, contractAddress, tokenId);

  const findBoost = (key: string) => {
    const boost = traits.find((trait: any) => trait.trait_type?.toLowerCase() === key.toLowerCase());
    return boost ? `${boost.value}` : 'N/A';
  };

  const shooting = findBoost('Shooting');
  const defense = findBoost('Defense');
  const finish = findBoost('Finish');
  const vision = findBoost('Vision');

  console.log(`✅ Boosts - Shooting: ${shooting}, Defense: ${defense}, Finish: ${finish}, Vision: ${vision}`);

  // Price calculations
  const priceInETH = base_price ? (Number(base_price) / 1e18).toFixed(4) : 'N/A';
  const usdPricePerETH = payment_token?.usd_price ? Number(payment_token.usd_price) : 0;
  const priceInUSD =
    base_price && usdPricePerETH > 0
      ? `$${(Number(base_price) / 1e18 * usdPricePerETH).toFixed(2)}`
      : 'N/A';

  // Build Embed
  return new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${nftName} - ${eventType}`)
    .setURL(assetUrl)
    .setThumbnail(imageUrl)
    .addFields(
      { name: 'Price (ETH)', value: `${priceInETH} ETH`, inline: true },
      { name: 'Price (USD)', value: priceInUSD, inline: true },
      { name: 'Shooting', value: shooting, inline: true },
      { name: 'Defense', value: defense, inline: true },
      { name: 'Finish', value: finish, inline: true },
      { name: 'Vision', value: vision, inline: true }
    )
    .setTimestamp(new Date())
    .setFooter({
      text: 'OpenSea Stream API',
      iconURL: 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png',
    });
};



// Function to Setup OpenSea Stream
const setupStreamClient = (onEvent: (eventType: string, payload: any) => void) => {
  const client = new OpenSeaStreamClient({
    network: Network.MAINNET,
    token: process.env.OPENSEA_API_KEY!,
    connectOptions: { transport: WebSocket },
  });

  const collectionSlug = process.env.COLLECTION_SLUG!;

  console.log('🔄 Connecting to OpenSea Stream API...');
  client.onItemListed(collectionSlug, async (event) => {
    try {
      console.log('✅ Item Listed Event Received');
      console.log('🔍 Event Payload:', JSON.stringify(event, null, 2));

      // Save payload to file for debugging
      fs.writeFileSync('payload.txt', JSON.stringify(event, null, 2));

      await onEvent('Item Listed', event.payload);
    } catch (error) {
      console.error('❌ Error handling Item Listed event:', error);
    }
  });

  client.connect();
  console.log('✅ Connected to OpenSea Stream API.');
};

// Main Bot Setup
const setupDiscordBot = async () => {
  await discordBot.login(process.env.DISCORD_BOT_TOKEN);
  console.log('✅ Discord bot connected successfully.');

  const mainChannel = (await discordBot.channels.fetch(
    process.env.DISCORD_CHANNEL_ID!
  )) as TextChannel;

  if (!mainChannel) {
    throw new Error('❌ Main channel not found.');
  }

  // Handle Stream Events
  setupStreamClient(async (eventType, payload) => {
    let embed;
  
    try {
      console.log('🚧 Building Embed for Event...');
      embed = await buildEmbedMessage(eventType, payload); // Await here
      console.log('✅ Embed built successfully.');
    } catch (error) {
      console.error('❌ Error building embed:', error);
      return;
    }
  
    try {
      console.log('📨 Sending embed to Discord...');
      if (eventType === 'Item Listed') {
        await mainChannel.send({ embeds: [embed] });
        console.log('✅ Embed sent to main channel.');
      }
    } catch (error) {
      console.error('❌ Error sending embed to Discord:', error);
    }
  });  
};

// Start the Bot
setupDiscordBot().catch((error) => console.error('❌ Bot setup failed:', error));
