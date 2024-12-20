require("dotenv/config");
const {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
} = require("discord.js");
const { OpenSeaStreamClient, Network } = require("@opensea/stream-js");
const { WebSocket } = require("ws");
const axios = require("axios");
const examplePayload = require("./example-payload.json");
let newListingChannel, goodDealsChannel, salesChannel, belowFloorChannel;

// Configuration Object
const CONFIG = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  NEW_LISTINGS_CHANNEL_ID: process.env.NEW_LISTINGS_CHANNEL_ID,
  NINETYPLUS_DEAL_CHANNEL_ID: process.env.NINETYPLUS_DEAL_CHANNEL_ID,
  SALES_CHANNEL_ID: process.env.SALES_CHANNEL_ID,
  BELOW_FLOOR_LISTING_CHANNEL_ID: process.env.BELOW_FLOOR_LISTING_CHANNEL_ID,
  OPENSEA_API_KEY: process.env.OPENSEA_API_KEY,
  COLLECTION_SLUG: process.env.COLLECTION_SLUG,
};

// Retry Helper
const retry = async (fn, retries = 3, delay = 2000) => {
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

const fetchCollectionFloorPrice = async (collectionSlug) => {
  const url = `https://api.opensea.io/api/v2/collections/${collectionSlug}/stats`;
  console.info("🔍 Fetching collection stats:", url);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": process.env.OPENSEA_API_KEY,
      },
      timeout: 10000,
    });
    return response.data.total.floor_price || null;
  } catch (error) {
    console.error("❌ Error fetching collection stats:", error);
    return null;
  }
};

// Fetch Asset Details
const fetchAssetDetails = async (chain, contractAddress, tokenId) => {
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
const buildEmbedMessage = async (eventType, payload) => {
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
  const findBoost = (key) =>
    traits.find(
      (trait) => trait.trait_type?.toLowerCase() === key.toLowerCase()
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

  const floorPrice = await fetchCollectionFloorPrice(CONFIG.COLLECTION_SLUG);
  const tolerance = 0.0001;
  const isBelowFloor =
    eventType === "Item Listed" &&
    floorPrice !== null &&
    priceInETH < floorPrice - tolerance;
  const isGoodNinety =
    priceInETH < 1 &&
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
      { name: "Vision", value: `${vision}`, inline: true },
      {
        name: "Floor Price",
        value: floorPrice !== null ? `${floorPrice.toFixed(4)} ETH` : "N/A",
        inline: false,
      }
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

  return { embed, isGoodNinety, isBelowFloor };
};

// Cache to Track Processed Listings (Per Unique NFT ID)
const listingCache = new Map();

// Helper to Generate Unique Key for Listings
const generateKey = (nftId) => nftId;

// OpenSea Stream Setup with Duplicate Detection
const setupStreamClient = (onEvent) => {
  const client = new OpenSeaStreamClient({
    network: Network.MAINNET,
    token: CONFIG.OPENSEA_API_KEY,
    connectOptions: { transport: WebSocket },
  });

  const handleStreamEvent = async (eventType, payload) => {
    try {
      const nftId = payload?.item?.nft_id || "";
      const price = payload?.base_price || payload?.sale_price || "0";
      const seller = payload?.maker?.address || "unknown";

      if (!nftId) return;

      const key = nftId;
      const cachedEntry = listingCache.get(key);

      if (
        cachedEntry &&
        cachedEntry.price === price &&
        cachedEntry.seller === seller
      ) {
        logger.info(
          `🔄 Duplicate listing detected for NFT ID: ${nftId}. Skipping.`
        );
        return;
      }

      listingCache.set(key, { price, seller });
      logger.info(`✅ Processing new listing for NFT ID: ${nftId}.`);

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
  info: (message, ...args) => console.log(`ℹ️  ${message}`, ...args),
  success: (message, ...args) => console.log(`✅ ${message}`, ...args),
  error: (message, ...args) => console.error(`❌ ${message}`, ...args),
};

// Main Discord Bot Setup
const setupDiscordBot = async () => {
  const discordBot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await discordBot.login(CONFIG.DISCORD_BOT_TOKEN);
  logger.success("Discord bot logged in successfully.");

  newListingChannel = await discordBot.channels.fetch(
    CONFIG.NEW_LISTINGS_CHANNEL_ID
  );
  goodDealsChannel = await discordBot.channels.fetch(
    CONFIG.NINETYPLUS_DEAL_CHANNEL_ID
  );
  salesChannel = await discordBot.channels.fetch(CONFIG.SALES_CHANNEL_ID);
  belowFloorChannel = await discordBot.channels.fetch(
    CONFIG.BELOW_FLOOR_LISTING_CHANNEL_ID
  );

  logger.success("Channels fetched successfully.");

  setupStreamClient(async (eventType, payload) => {
    try {
      logger.info(`🔍 Recognized Event: "${eventType}"`);

      logger.info(`🚧 Building embed message for "${eventType}"...`);
      const { embed, isGoodNinety, isBelowFloor } = await buildEmbedMessage(
        eventType,
        payload
      );
      logger.success(`Created embed message for "${eventType}".`);

      if (eventType === "Item Listed") {
        await newListingChannel.send({ embeds: [embed] });
        logger.success(`Send embed message to New Listing Channel Channel.`);

        if (isGoodNinety) {
          logger.success(
            `Recognized as a Good Deal 90! Sending to Good Deals 90 Channel.`
          );
          await goodDealsChannel.send({ embeds: [embed] });
          logger.success(`Send embed message to Good Deal 90 Channel.`);
        }
      }
      if (isBelowFloor) {
        logger.success(
          `Listing is below floor price! Sending to Below Floor Listings Channel.`
        );
        await belowFloorChannel.send({ embeds: [embed] });
        logger.success(`Sent embed message to Below Floor Listings Channel.`);
      } else if (eventType === "Item Sold") {
        await salesChannel.send({ embeds: [embed] });
        logger.success(`Send embed message to Sales Channel.`);
      }
    } catch (error) {
      logger.error("Error while processing event:", error);
    }
  });
  logger.success("Discord bot is connected and ready to receive events!");
};

const simulateEvent = async (eventType, payload) => {
  logger.info(`Simulating event: "${eventType}"`);

  // Build the embed message
  const { embed, isGoodNinety, isBelowFloor } = await buildEmbedMessage(
    eventType,
    payload
  );

  if (eventType === "Item Listed") {
    await newListingChannel.send({ embeds: [embed] });
    if (isGoodNinety) {
      await goodDealsChannel.send({ embeds: [embed] });
    }
    if (isBelowFloor) {
      await belowFloorChannel.send({ embeds: [embed] });
    }
  } else if (eventType === "Item Sold") {
    await salesChannel.send({ embeds: [embed] });
  }
};

if (process.env.NODE_ENV === "simulate") {
  const simulate = async () => {
    logger.info("Simulating Item Listed Event with Example Payload...");

    try {
      // Ensure channels are initialized
      await setupDiscordBot();

      // Simulate the event with the example payload
      await simulateEvent("Item Listed", examplePayload.payload);
    } catch (error) {
      logger.error("Simulation failed with error:", error);
    }
  };

  simulate();
} else if (process.env.NODE_ENV !== "test") {
  // Run the bot normally
  setupDiscordBot().catch((error) => logger.error("Bot setup failed:", error));
}

module.exports = { buildEmbedMessage, CONFIG };
