require("dotenv/config");
const {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
} = require("discord.js");
const { sendSMSViaEmail } = require("./sms");
const { OpenSeaStreamClient, Network } = require("@opensea/stream-js");
const { WebSocket } = require("ws");
const axios = require("axios");
const examplePayload = require("./example-listing-payload.json");
let newListingChannel,
  ninetyPlusChannel,
  eightyPlusChannel,
  seventyPlusChannel,
  twoFortyOverallPlusChannel,
  salesChannel,
  belowFloorChannel;

// Configuration Object
const CONFIG = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  NEW_LISTINGS_CHANNEL_ID: process.env.NEW_LISTINGS_CHANNEL_ID,
  NINETYPLUS_CHANNEL_ID: process.env.NINETYPLUS_CHANNEL_ID,
  EIGHTYPLUS_CHANNEL_ID: process.env.EIGHTYPLUS_CHANNEL_ID,
  SEVENTYPLUS_CHANNEL_ID: process.env.SEVENTYPLUS_CHANNEL_ID,
  TWOFORTY_OVERALLPLUS_CHANNEL_ID: process.env.TWOFORTY_OVERALLPLUS_CHANNEL_ID,
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

const fetchBestOffer = async (collectionSlug, tokenId) => {
  const url = `https://api.opensea.io/api/v2/offers/collection/${collectionSlug}/nfts/${tokenId}/best`;
  logger.info(`🔍 Fetching best offer for NFT: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": CONFIG.OPENSEA_API_KEY,
      },
      timeout: 10000,
    });

    // Extract best offer data from the response
    const bestOffer = response.data || null;

    if (!bestOffer) {
      logger.info("ℹ️ No best offer found for this NFT.");
      return null;
    }

    // Ensure the offer is in WETH
    if (
      bestOffer.price?.currency?.toUpperCase() === "WETH" &&
      bestOffer.price?.value
    ) {
      const bestOfferETH = Number(bestOffer.price.value) / 1e18;
      logger.info(`✅ Best WETH Offer: ${bestOfferETH.toFixed(4)} ETH`);
      return bestOfferETH;
    } else {
      logger.info("ℹ️ Best offer is not in WETH.");
      return null;
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info("ℹ️ No best offer found for this NFT (404).");
      return null;
    }
    logger.error("❌ Error fetching best offer:", error.message);
    return null;
  }
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

  // Fetch Best WETH Offer
  const bestWethOffer = await fetchBestOffer(CONFIG.COLLECTION_SLUG, tokenId);
  const bestWethOfferText =
    bestWethOffer !== null
      ? `${bestWethOffer.toFixed(4)} ETH`
      : "No WETH offers found";

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
  const isGoodEighty =
    priceInETH < 1 &&
    [shooting, defense, finish, vision].some((stat) => stat >= 80 && stat < 90);
  const isGoodSeventy =
    priceInETH < 1 &&
    [shooting, defense, finish, vision].some((stat) => stat >= 70 && stat < 80);
  const isGoodTwoFortyPlus = priceInETH < 1 && overall >= 240;

  const floorPriceInUSD = payment_token?.usd_price
    ? `$${(floorPrice * payment_token.usd_price).toFixed(2)}`
    : "N/A";

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
      { name: "\u000A", value: "\u000A" },
      {
        name: "Floor Price (ETH)",
        value: floorPrice !== null ? `${floorPrice.toFixed(4)} ETH` : "N/A",
        inline: true,
      },
      {
        name: "Floor Price (USD)",
        value: floorPriceInUSD,
        inline: true,
      },
      { name: "\u000A", value: "\u000A" },
      { name: "Best WETH Offer", value: bestWethOfferText, inline: false },
      { name: "\u000A", value: "\u000A" },
      { name: "Shooting", value: `${shooting}`, inline: true },
      { name: "Defense", value: `${defense}`, inline: true },
      { name: "\u000A", value: "\u000A" },
      { name: "Finish", value: `${finish}`, inline: true },
      { name: "Vision", value: `${vision}`, inline: true },
      { name: "\u000A", value: "\u000A" },
      { name: "Overall", value: `${overall}`, inline: false },
      { name: "\u000A", value: "\u000A" }
    );

  if (eventType === "Item Sold") {
    embed.addFields(
      {
        name: "From Wallet",
        value: maker.address
          ? `[${maker.address.slice(0, 6)}](https://opensea.io/${
              maker.address
            })`
          : "N/A",
        inline: true,
      },
      {
        name: "To Wallet",
        value: taker?.address
          ? `[${taker.address.slice(0, 6)}](https://opensea.io/${
              taker.address
            })`
          : "N/A",
        inline: true,
      },
      { name: "\u000A", value: "\u000A" },
      {
        name: "From Etherscan",
        value: maker.address
          ? `[${maker.address.slice(0, 6)}](https://etherscan.io/address/${
              maker.address
            })`
          : "N/A",
        inline: true,
      },
      {
        name: "To Etherscan",
        value: taker?.address
          ? `[${taker.address.slice(0, 6)}](https://etherscan.io/address/${
              taker.address
            })`
          : "N/A",
        inline: true,
      },
      {
        name: "Transaction",
        value: transaction?.hash
          ? `[View Transaction](https://etherscan.io/tx/${transaction.hash})`
          : "N/A",
      }
    );
  } else if (eventType === "Item Listed") {
    embed.addFields(
      {
        name: "Lister Etherscan",
        value: maker.address
          ? `[${maker.address.slice(0, 6)}](https://etherscan.io/address/${
              maker.address
            })`
          : "N/A",
        inline: true,
      },
      {
        name: "Lister Wallet",
        value: maker.address
          ? `[${maker.address.slice(0, 6)}](https://opensea.io/${
              maker.address
            })`
          : "N/A",
        inline: true,
      }
    );
  }

  return {
    embed,
    isGoodNinety,
    isBelowFloor,
    isGoodEighty,
    isGoodSeventy,
    isGoodTwoFortyPlus,
  };
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
      // Log the payload with clear separation
      console.log("\n====================");
      console.log(`🔍 Event Type: ${eventType}`);
      console.log("Full Payload:", JSON.stringify(payload, null, 2));
      console.log("====================\n");

      const nftId = payload?.item?.nft_id || "";
      const price = BigInt(payload?.base_price || payload?.sale_price || "0");
      const seller = payload?.maker?.address || "unknown";

      if (!nftId) return;

      const priceChangeThreshold = BigInt(20000000000000000); // 0.02 ETH in wei

      // Initialize or retrieve the history for this NFT ID
      if (!listingCache.has(nftId)) {
        listingCache.set(nftId, []);
      }
      const history = listingCache.get(nftId);

      // Check for exact duplicates
      const isDuplicate = history.some(
        (entry) => entry.seller === seller && entry.price === price
      );

      if (isDuplicate) {
        logger.info(
          `🔄 Duplicate listing detected for NFT ID: ${nftId}. Skipping.`
        );
        return;
      }

      // Check for minor price changes using absolute threshold in ETH
      const isMinorChange = history.some((entry) => {
        if (entry.seller === seller) {
          const priceDifference =
            price > entry.price ? price - entry.price : entry.price - price;
          return priceDifference < priceChangeThreshold;
        }
        return false;
      });

      if (isMinorChange) {
        logger.info(
          `🔄 Minor price change detected for NFT ID: ${nftId}. Skipping.`
        );
        return;
      }

      // Add the new listing to the history
      history.push({ price, seller });

      // Prune old entries to maintain a fixed history size
      if (history.length > 5) {
        history.shift(); // Remove the oldest entry
      }

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
  ninetyPlusChannel = await discordBot.channels.fetch(
    CONFIG.NINETYPLUS_CHANNEL_ID
  );
  eightyPlusChannel = await discordBot.channels.fetch(
    CONFIG.EIGHTYPLUS_CHANNEL_ID
  );
  seventyPlusChannel = await discordBot.channels.fetch(
    CONFIG.SEVENTYPLUS_CHANNEL_ID
  );
  twoFortyOverallPlusChannel = await discordBot.channels.fetch(
    CONFIG.TWOFORTY_OVERALLPLUS_CHANNEL_ID
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
      const {
        embed,
        isGoodNinety,
        isBelowFloor,
        isGoodEighty,
        isGoodSeventy,
        isGoodTwoFortyPlus,
      } = await buildEmbedMessage(eventType, payload);
      logger.success(`Created embed message for "${eventType}".`);

      if (eventType === "Item Listed") {
        await newListingChannel.send({ embeds: [embed] });
        logger.success(`Send embed message to New Listing Channel Channel.`);

        if (isGoodNinety) {
          logger.success(
            `Recognized as a Good Deal 90! Sending to Good Deals 90 Channel.`
          );
          // Send SMS for 90+ Boost
          const nftName = payload.item?.metadata?.name || "Unnamed NFT";
          const price = Number(payload.base_price || 0) / 1e18;
          const link = payload.item?.permalink || "https://opensea.io";
          const message = `${nftName} is listed with a 90+ boost for ${price.toFixed(
            4
          )} ETH. Check it out here: ${link}\n`;

          await sendSMSViaEmail(
            process.env.RECIPIENT_PHONE_NUMBER, // Phone number from .env
            "txt.att.net", // Carrier gateway (e.g., AT&T)
            message
          );
          logger.success(`📱 SMS sent for 90+ Boost: ${message}`);

          await ninetyPlusChannel.send({ embeds: [embed] });
          logger.success(`Send embed message to Good Deal 90 Channel.`);
        }
        if (isGoodEighty) {
          logger.success(
            `Recognized as a Good Deal 80! Sending to Good Deals 80 Channel.`
          );
          await eightyPlusChannel.send({ embeds: [embed] });
          logger.success(`Send embed message to Good Deal 80 Channel.`);
        }
        if (isGoodSeventy) {
          logger.success(
            `Recognized as a Good Deal 70! Sending to Good Deals 70 Channel.`
          );
          await seventyPlusChannel.send({ embeds: [embed] });
          logger.success(`Send embed message to Good Deal 70 Channel.`);
        }
        if (isGoodTwoFortyPlus) {
          logger.success(
            `Recognized as a Good Deal 240 Plus! Sending to Good Deals 240 Plus Channel.`
          );
          await twoFortyOverallPlusChannel.send({ embeds: [embed] });
          logger.success(`Send embed message to Good Deal 240 Plus Channel.`);
        }
        if (isBelowFloor) {
          logger.success(
            `Listing is below floor price! Sending to Below Floor Listings Channel.`
          );
          await belowFloorChannel.send({ embeds: [embed] });
          logger.success(`Sent embed message to Below Floor Listings Channel.`);
        }
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
  const {
    embed,
    isGoodNinety,
    isBelowFloor,
    isGoodEighty,
    isGoodSeventy,
    isGoodTwoFortyPlus,
  } = await buildEmbedMessage(eventType, payload);

  if (eventType === "Item Listed") {
    // await newListingChannel.send({ embeds: [embed] });
    if (isGoodNinety) {
      // Send SMS for 90+ Boost
      const nftName = payload.item?.metadata?.name || "Unnamed NFT";
      const price = Number(payload.base_price || 0) / 1e18;
      const link = payload.item?.permalink || "https://opensea.io";
      const message = `${nftName} is listed with a 90+ boost for ${price.toFixed(
        4
      )} ETH. Check it out here: ${link}`;

      await sendSMSViaEmail(
        process.env.RECIPIENT_PHONE_NUMBER, // Phone number from .env
        "txt.att.net", // Carrier gateway (e.g., AT&T)
        message
      );
      logger.success(`📱 SMS sent for 90+ Boost: ${message}`);
      // await ninetyPlusChannel.send({ embeds: [embed] });
    }
    if (isGoodEighty) {
      // await eightyPlusChannel.send({ embeds: [embed] });
    }
    if (isGoodSeventy) {
      // await seventyPlusChannel.send({ embeds: [embed] });
    }
    if (isGoodTwoFortyPlus) {
      // await twoFortyOverallPlusChannel.send({ embeds: [embed] });
    }
    if (isBelowFloor) {
      // await belowFloorChannel.send({ embeds: [embed] });
    }
  } else if (eventType === "Item Sold") {
    // await salesChannel.send({ embeds: [embed] });
  }
};

if (process.env.NODE_ENV === "simulate") {
  const simulate = async () => {
    logger.info("Simulating OpenSea Event with Example Payload...");

    try {
      // Ensure channels are initialized
      await setupDiscordBot();

      // Extract the event type from the payload
      const eventType = examplePayload.payload.event_type; // Correct path to event type

      if (!eventType || !["item_sold", "item_listed"].includes(eventType)) {
        throw new Error(
          `Invalid or missing "event_type" field in the example payload: ${eventType}`
        );
      }

      // Convert event_type to human-readable form (optional)
      const eventTypeReadable =
        eventType === "item_sold" ? "Item Sold" : "Item Listed";

      logger.info(
        `Simulating "${eventTypeReadable}" event with example payload...`
      );

      // Simulate the event with the extracted event type
      await simulateEvent(eventTypeReadable, examplePayload.payload.payload);

      logger.info("Simulation completed successfully. Exiting...");

      // Exit the process after simulation is complete
      process.exit(0);
    } catch (error) {
      logger.error("Simulation failed with error:", error);

      // Exit the process with an error code
      process.exit(1);
    }
  };

  simulate();
} else if (process.env.NODE_ENV !== "test") {
  // Run the bot normally
  setupDiscordBot().catch((error) => logger.error("Bot setup failed:", error));
}

module.exports = { buildEmbedMessage, CONFIG };
