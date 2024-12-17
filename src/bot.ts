import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
} from "discord.js";
import { OpenSeaStreamClient, Network } from "@opensea/stream-js";
import { WebSocket } from "ws";
import axios, { AxiosError } from "axios";

// Configuration Object
const CONFIG = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN!,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID!,
  GOOD_DEALS_CHANNEL_ID: process.env.GOOD_DEALS_CHANNEL_ID!,
  SALES_CHANNEL_ID: process.env.SALES_CHANNEL_ID!,
  OPENSEA_API_KEY: process.env.OPENSEA_API_KEY!,
  COLLECTION_SLUG: process.env.COLLECTION_SLUG!,
};

// Retry Helper
const retry = async (
  fn: () => Promise<any>,
  retries: number = 3,
  delay: number = 2000
): Promise<any> => {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      logger.info(`🔄 Retrying in ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
      return retry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Fetch Asset Details
const fetchAssetDetails = async (
  chain: string,
  contractAddress: string,
  tokenId: string
) => {
  const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`;
  logger.info("🔍 Fetching asset details:", url);

  return retry(async () => {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": CONFIG.OPENSEA_API_KEY,
      },
      timeout: 10000,
    });
    return response.data.nft.traits || [];
  });
};

// Build Discord Embed Message
export const buildEmbedMessage = async (
  eventType: string,
  payload: any
): Promise<{ embed: EmbedBuilder; isGoodDeal: boolean }> => {
  const {
    item = {},
    base_price = null,
    payment_token = {},
    maker = {},
    taker = null,
    sale_price = null,
    transaction = {},
  } = payload || {};

  const nftName = item?.metadata?.name || "Unnamed NFT";
  const imageUrl =
    item?.metadata?.image_url ||
    "https://opensea.io/static/images/logos/opensea-logo.png";
  const assetUrl = item?.permalink || "https://opensea.io";
  const [contractAddress, tokenId] = item?.nft_id?.split("/").slice(1) || [
    "",
    "",
  ];

  const traits = await fetchAssetDetails("ethereum", contractAddress, tokenId);
  const findBoost = (key: string): number =>
    traits.find(
      (trait: any) => trait.trait_type?.toLowerCase() === key.toLowerCase()
    )?.value || 0;

  const shooting = findBoost("Shooting");
  const defense = findBoost("Defense");
  const finish = findBoost("Finish");
  const vision = findBoost("Vision");
  const overall = shooting + defense + finish + vision;

  const priceInETH =
    Number(eventType === "Item Sold" ? sale_price : base_price) / 1e18 || 0;
  const priceInUSD = payment_token?.usd_price
    ? `$${(priceInETH * payment_token.usd_price).toFixed(2)}`
    : "N/A";
  const isGoodDeal =
    priceInETH < 0.35 &&
    [shooting, defense, finish, vision].some((stat) => stat >= 90);

  const embed = new EmbedBuilder()
    .setColor(eventType === "Item Sold" ? "#ff4500" : "#0099ff")
    .setTitle(`${nftName} - ${eventType}`)
    .setURL(assetUrl)
    .setThumbnail(imageUrl)
    .addFields(
      {
        name: "Price (ETH)",
        value: `${priceInETH.toFixed(4)} ETH`,
        inline: true,
      },
      { name: "Price (USD)", value: priceInUSD, inline: true },
      { name: "Overall", value: `${overall}`, inline: false },
      { name: "Shooting", value: `${shooting}`, inline: true },
      { name: "Defense", value: `${defense}`, inline: true },
      { name: "Finish", value: `${finish}`, inline: true },
      { name: "Vision", value: `${vision}`, inline: true }
    );

  if (eventType === "Item Sold") {
    embed.addFields(
      { name: "From", value: maker.address || "N/A", inline: true },
      { name: "To", value: taker?.address || "N/A", inline: true },
      {
        name: "Transaction",
        value: transaction?.hash
          ? `[View Transaction](https://etherscan.io/tx/${transaction.hash})`
          : "N/A",
      }
    );
  }

  return { embed, isGoodDeal };
};

// OpenSea Stream Setup
const setupStreamClient = (
  onEvent: (eventType: string, payload: any) => void
) => {
  const client = new OpenSeaStreamClient({
    network: Network.MAINNET,
    token: CONFIG.OPENSEA_API_KEY,
    connectOptions: { transport: WebSocket },
  });

  const handleStreamEvent = async (eventType: string, payload: any) => {
    try {
      logger.info(`✅ ${eventType} Event Received`);
      await onEvent(eventType, payload);
    } catch (error) {
      logger.error(`Error handling ${eventType} event:`, error);
    }
  };

  client.onItemListed(CONFIG.COLLECTION_SLUG, (event) =>
    handleStreamEvent("Item Listed", event.payload)
  );
  client.onItemSold(CONFIG.COLLECTION_SLUG, (event) =>
    handleStreamEvent("Item Sold", event.payload)
  );

  client.connect();
  logger.success("Connected to OpenSea Stream API.");
};

// Logger Utility
const logger = {
  info: (message: string, ...args: any[]) =>
    console.log(`ℹ️  ${message}`, ...args),
  success: (message: string, ...args: any[]) =>
    console.log(`✅ ${message}`, ...args),
  error: (message: string, ...args: any[]) =>
    console.error(`❌ ${message}`, ...args),
};

// Main Discord Bot Setup
const setupDiscordBot = async () => {
  const discordBot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await discordBot.login(CONFIG.DISCORD_BOT_TOKEN);
  logger.success("Discord bot logged in successfully.");

  const mainChannel = (await discordBot.channels.fetch(
    CONFIG.DISCORD_CHANNEL_ID
  )) as TextChannel;
  const goodDealsChannel = (await discordBot.channels.fetch(
    CONFIG.GOOD_DEALS_CHANNEL_ID
  )) as TextChannel;
  const salesChannel = (await discordBot.channels.fetch(
    CONFIG.SALES_CHANNEL_ID
  )) as TextChannel;

  logger.success("Channels fetched successfully.");

  // Setup OpenSea Stream Event Handling
  setupStreamClient(async (eventType, payload) => {
    try {
      logger.info(`🔍 Recognized Event: "${eventType}"`);

      // Building embed message
      logger.info(`🚧 Building embed message for "${eventType}"...`);
      const { embed, isGoodDeal } = await buildEmbedMessage(eventType, payload);
      logger.success(`Created embed message for "${eventType}".`);

      // Send messages based on event type
      if (eventType === "Item Listed") {
        await mainChannel.send({ embeds: [embed] });
        logger.success(`Embed message sent to Main Channel.`);

        // Log for good deal if applicable
        if (isGoodDeal) {
          logger.success(`Recognized as a Good Deal! Sending to Good Deals Channel.`);
          await goodDealsChannel.send({ embeds: [embed] });
          logger.success(`Embed message sent to Good Deals Channel.`);
        }
      } else if (eventType === "Item Sold") {
        await salesChannel.send({ embeds: [embed] });
        logger.success(`Embed message sent to Sales Channel.`);
      }
    } catch (error) {
      logger.error("Error while processing event:", error);
    }
  });

  logger.success("Connected to OpenSea Stream API.");
  logger.success("Discord bot is connected and ready to receive events!");
};

// Start the Bot
setupDiscordBot().catch((error) => logger.error("Bot setup failed:", error));

