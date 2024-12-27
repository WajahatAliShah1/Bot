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
const pLimit = require("p-limit");
const examplePayload = require("./example-listing-payload.json");
let newListingChannel,
  ninetyPlusChannel,
  eightyPlusChannel,
  seventyPlusChannel,
  twoFortyOverallPlusChannel,
  salesChannel,
  // comboKongChannel,
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
  // COMBO_KONGS_CHANNEL_ID: process.env.COMBO_KONGS_CHANNEL_ID,
  BELOW_FLOOR_LISTING_CHANNEL_ID: process.env.BELOW_FLOOR_LISTING_CHANNEL_ID,
  OPENSEA_API_KEY: process.env.OPENSEA_API_KEY,
  COLLECTION_SLUG: process.env.COLLECTION_SLUG,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  CRYPTOCOMPARE_API_KEY: process.env.CRYPTOCOMPARE_API_KEY,
  DEBUG_DISCORD: process.env.DEBUG_DISCORD,
  DEBUG_PAYLOAD: process.env.DEBUG_PAYLOAD,
  DEBUG_TELEGRAM: process.env.DEBUG_TELEGRAM,
  NODE_ENV: process.env.NODE_ENV,
};

const TelegramBot = require("node-telegram-bot-api");

// Initialize Telegram bot
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Send a Telegram notification
const sendTelegramNotification = async (chatId, message) => {
  try {
    await telegramBot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    logger.error("Error Sending telegram notification", error.message);
  }
};

// Let's allow at most 5 concurrent requests at a time
const limit = pLimit(5);

// Retry Helper
const retry = async (fn, retries = 3, delay = 3000) => {
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

const fetchLastSaleDetails = async (chain, contractAddress, tokenId) => {
  const url = `https://api.opensea.io/api/v2/events/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`;
  logger.info(
    `🔍 Fetching last sale details for NFT: ${contractAddress}/${tokenId} on chain: ${chain}`
  );

  const params = {
    event_type: "sale", // Filter only sale events
    limit: 1, // Fetch the most recent sale event
  };

  // Helper function to calculate years and months ago
  const calculateTimeAgo = (timestamp) => {
    const transactionDate = new Date(timestamp * 1000);
    const currentDate = new Date();

    let years = currentDate.getFullYear() - transactionDate.getFullYear();
    let months = currentDate.getMonth() - transactionDate.getMonth();
    let days = 0;

    if (months < 0) {
      years -= 1;
      months += 12;
    }

    if (years === 0 && months === 0) {
      // Calculate days difference
      const diffMs = currentDate - transactionDate;
      days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    return { years, months, days };
  };

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": CONFIG.OPENSEA_API_KEY,
      },
      params,
      timeout: 15000,
    });

    const events = response.data.asset_events || [];
    if (events.length === 0) {
      logger.info("No sales found for this NFT.");
      return null;
    }

    // Parse the first event (most recent sale)
    const lastSale = events[0];

    // Extract ETH price (convert from wei) and timestamp
    const ethPrice = Number(lastSale.payment.quantity) / 1e18; // Convert from wei to ETH
    const timestamp = Number(lastSale.event_timestamp); // Ensure it's a number

    // Calculate time ago
    const { years, months, days } = calculateTimeAgo(timestamp);

    // If days > 0 => "X days ago"
    // Else if years=0 => "X months ago"
    // Else => "X years and X months ago"

    let yearsMonthsAgo = "";
    if (days > 0) {
      yearsMonthsAgo = `${days} ${days === 1 ? "day" : "days"} ago`;
    } else if (years === 0 && months > 0) {
      yearsMonthsAgo = `${months} ${months === 1 ? "month" : "months"} ago`;
    } else {
      const yearText = years === 1 ? "year" : "years";
      const monthText = months === 1 ? "month" : "months";
      yearsMonthsAgo = `${years} ${yearText} and ${months} ${monthText} ago`;
    }

    logger.info(
      `✅ Last Sale: ${ethPrice} ETH on ${new Date(
        timestamp * 1000
      ).toLocaleDateString()} (${yearsMonthsAgo})`
    );

    return { ethPrice, timestamp, yearsMonthsAgo };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info("No last sale details found for this NFT (404).");
      return null;
    }
    logger.error("Error fetching last sale details:", error.message);
    return null;
  }
};

const fetchHistoricalEthPrice = async (date) => {
  const url = `https://min-api.cryptocompare.com/data/pricehistorical`;
  logger.info(`🔍 Fetching historical ETH price for date: ${date}`);

  const params = {
    fsym: "ETH", // Symbol for Ethereum
    tsyms: "USD", // Target currency
    ts: date, // Unix timestamp in seconds
    api_key: CONFIG.CRYPTOCOMPARE_API_KEY,
  };

  try {
    const response = await axios.get(url, { params, timeout: 15000 });
    const usdPrice = response.data.ETH?.USD;

    if (!usdPrice) {
      logger.info("Historical USD price not found.");
      return null;
    }

    logger.info(`✅ Historical ETH price: $${usdPrice}`);
    return usdPrice;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info(" No historical price found (404).");
      return null;
    }
    logger.error("Error fetching historical ETH price:", error.message);
    return null;
  }
};

let floorPriceCache = {
  value: null,
  timestamp: 0,
};

async function fetchCollectionFloorPriceCached(slug) {
  const now = Date.now();
  // If <60 seconds old, use cached value
  if (floorPriceCache.value && now - floorPriceCache.timestamp < 60_000) {
    return floorPriceCache.value;
  }

  // Otherwise, fetch fresh
  const freshFloor = await fetchCollectionFloorPrice(slug);
  if (freshFloor !== null) {
    floorPriceCache.value = freshFloor;
    floorPriceCache.timestamp = now;
  } else {
    // Log an error if the floor price fetch returned null
    logger.error(`fetchCollectionFloorPriceCached null for slug="${slug}".`);
  }
  return floorPriceCache.value; // Could be null if the fetch failed
}

const fetchCollectionFloorPrice = async (collectionSlug) => {
  const url = `https://api.opensea.io/api/v2/collections/${collectionSlug}/stats`;
  logger.info("🔍 Fetching collection stats:", url);

  const fetchFloorPrice = async () => {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": process.env.OPENSEA_API_KEY,
      },
      timeout: 15000,
    });

    if (!response.data || !response.data.total?.floor_price) {
      logger.info("No floor price data found for this collection.");
      return null;
    }

    const floorPrice = response.data.total.floor_price;
    logger.info(`✅ Floor Price: ${floorPrice.toFixed(4)} ETH`);
    return floorPrice;
  };

  try {
    return await retry(fetchFloorPrice, 3, 2000); // Retries 3 times with exponential backoff
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info("Collection floor price not found (404).");
      return null;
    }
    logger.error("Error fetching collection floor price:", error.message);
    return null;
  }
};

const fetchAssetDetails = async (chain, contractAddress, tokenId) => {
  const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`;
  logger.info("🔍 Fetching asset details:", url);

  const fetchDetails = async () => {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": CONFIG.OPENSEA_API_KEY,
      },
      timeout: 15000,
    });

    if (!response.data || !response.data.nft || !response.data.nft.traits) {
      logger.info("No asset details or traits found for this NFT.");
      return [];
    }

    const traits = response.data.nft.traits;
    logger.info(`✅ Asset Traits Fetched: ${traits.length} traits found.`);
    return traits;
  };

  try {
    return await retry(fetchDetails, 3, 2000); // Retries 3 times with exponential backoff
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info("Asset details not found (404).");
      return [];
    }
    logger.error("Error fetching asset details:", error.message);
    return [];
  }
};

const fetchBestOffer = async (collectionSlug, tokenId) => {
  const url = `https://api.opensea.io/api/v2/offers/collection/${collectionSlug}/nfts/${tokenId}/best`;
  logger.info(`🔍 Fetching best offer for NFT: ${url}`);

  const fetchOffer = async () => {
    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": CONFIG.OPENSEA_API_KEY,
      },
      timeout: 15000,
    });

    // Extract best offer data from the response
    const bestOffer = response.data || null;

    if (!bestOffer) {
      logger.info("No best offer found for this NFT.");
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
      logger.info("Best offer is not in WETH.");
      return null;
    }
  };

  try {
    return await retry(fetchOffer, 3, 2000); // Retries 3 times with exponential backoff
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.info("No best offer found for this NFT (404).");
      return null;
    }
    logger.error("Error fetching best offer:", error.message);
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

  const chain = "ethereum";
  const nftName = item?.metadata?.name || "Unnamed NFT";
  const imageUrl =
    item?.metadata?.image_url ||
    "https://opensea.io/static/images/logos/opensea-logo.png";
  const assetUrl = item?.permalink || "https://opensea.io";
  const [contractAddress, tokenId] = item?.nft_id?.split("/").slice(1) || [
    "",
    "",
  ];

  const lastSaleDetails = await limit(() =>
    fetchLastSaleDetails(chain, contractAddress, tokenId)
  );

  if (!lastSaleDetails) {
    logger.info(
      `fetchLastSaleDetails FAILED for NFT: ${contractAddress}/${tokenId}`
    );
  }

  const ethPrice = lastSaleDetails?.ethPrice || null;
  const timestamp = lastSaleDetails?.timestamp || null;
  const yearsMonthsAgo = lastSaleDetails?.yearsMonthsAgo || "N/A";

  let lastSaleUsd = "N/A";
  let lastSaleDate = "N/A";
  let lastSaleEth = "N/A";

  if (ethPrice && timestamp) {
    lastSaleEth = `${ethPrice.toFixed(4)} ETH`;
    lastSaleDate = `${new Date(
      timestamp * 1000
    ).toLocaleDateString()} \n(${yearsMonthsAgo})`;

    // Fetch historical ETH/USD price
    const historicalUsdPrice = await limit(() =>
      fetchHistoricalEthPrice(timestamp)
    );
    if (historicalUsdPrice) {
      lastSaleUsd = `$${(ethPrice * historicalUsdPrice).toFixed(2)}`;
    } else {
      logger.info(`fetchHistoricalEthPrice FAILED for timestamp: ${timestamp}`);
    }
  }

  // Asset Details
  const traits = await limit(() =>
    fetchAssetDetails("ethereum", contractAddress, tokenId)
  );
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
  const bestWethOffer = await limit(() =>
    fetchBestOffer(CONFIG.COLLECTION_SLUG, tokenId)
  );
  const bestWethOfferText =
    bestWethOffer !== null
      ? `${bestWethOffer.toFixed(4)} ETH`
      : "No WETH offers found";

  const priceInETH =
    Number(eventType === "Item Sold" ? sale_price : base_price) / 1e18 || 0;
  const priceInUSD = payment_token?.usd_price
    ? `$${(priceInETH * payment_token.usd_price).toFixed(2)}`
    : "N/A";

  const floorPrice = await limit(() =>
    fetchCollectionFloorPriceCached(CONFIG.COLLECTION_SLUG)
  );

  const tolerance = 0.0001;
  const isBelowFloor =
    eventType === "Item Listed" &&
    floorPrice !== null &&
    priceInETH < floorPrice - tolerance;
  const isGoodNinety =
    priceInETH < 5 &&
    [shooting, defense, finish, vision].some((stat) => stat >= 90 && stat <= 100);
  const isGoodEighty =
    priceInETH < 5 &&
    [shooting, defense, finish, vision].some((stat) => stat >= 80 && stat < 90);
  const isGoodSeventy =
    priceInETH < 5 &&
    [shooting, defense, finish, vision].some((stat) => stat >= 70 && stat < 80);
  const isGoodTwoFortyPlus = priceInETH < 1 && overall >= 240;

  // const is90Shooting = priceInETH < 1 && shooting >= 90;
  // const is90Vision = priceInETH < 1 && vision >= 90;
  // const is90Defense = priceInETH < 1 && defense >= 90;

  // const is80Shooting = priceInETH < 1 && shooting >= 80;
  // const is80Vision = priceInETH < 1 && vision >= 80;
  // const is80Defense = priceInETH < 1 && defense >= 80;

  // const is70Shooting = priceInETH < 1 && shooting >= 70;
  // const is70Vision = priceInETH < 1 && vision >= 70;
  // const is70Defense = priceInETH < 1 && defense >= 70;

  // const is60VisionAnd80Shooting = priceInETH < 1 && vision >= 60 && shooting >= 80;

  const floorPriceInUSD = payment_token?.usd_price
    ? `$${(floorPrice * payment_token.usd_price).toFixed(2)}`
    : "N/A";

  const embed = new EmbedBuilder()
    .setColor(eventType === "Item Sold" ? "#ff4500" : "#0099ff")
    .setTitle(`${nftName} - ${eventType}`)
    .setURL(assetUrl)
    .setImage(imageUrl)
    .addFields(
      {
        name: "Price",
        value: `${priceInETH.toFixed(4)} ETH`,
        inline: true,
      },
      { name: "Price (USD)", value: priceInUSD, inline: true },
      { name: "\u000A", value: "\u000A" },
      {
        name: "Floor Price",
        value: floorPrice !== null ? `${floorPrice.toFixed(4)} ETH` : "N/A",
        inline: true,
      },
      {
        name: "Floor Price (USD)",
        value: floorPriceInUSD,
        inline: true,
      },
      { name: "\u000A", value: "\u000A" },
      {
        name: "Best Current Offer",
        value: bestWethOfferText,
        inline: false,
      },
      { name: "\u000A", value: "\u000A" },
      { name: "\u000A", value: "\u000A" },
      { name: "Shooting", value: `**${shooting}**`, inline: true },
      { name: "Defense", value: `**${defense}**`, inline: true },
      { name: "\u000A", value: "\u000A" },
      { name: "Finish", value: `**${finish}**`, inline: true },
      { name: "Vision", value: `**${vision}**`, inline: true },
      { name: "\u000A", value: "\u000A" },
      { name: "Overall", value: `**${overall}**`, inline: false },
      { name: "\u000A", value: "\u000A" },
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
      { name: "\u000A", value: "\u000A" },
      { name: "Last Sale", value: lastSaleEth, inline: true },
      { name: "Past USD", value: lastSaleUsd, inline: true },
      {
        name: "Date",
        value: lastSaleDate,
        inline: false,
      },
      { name: "\u000A", value: "\u000A" },
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
      const debugPayload = process.env.DEBUG_PAYLOAD === "true";
      if (debugPayload) {
        // Log the payload with clear separation
        console.log("\n====================");
        console.log(`🔍 Event Type: ${eventType}`);
        console.log("Full Payload:", JSON.stringify(payload, null, 2));
        console.log("====================\n");
      }

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
          const diff =
            price > entry.price ? price - entry.price : entry.price - price;
          return diff < priceChangeThreshold;
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

  // Connect
  logger.info("Attempting to connect...");
  try {
    client.connect();
    logger.success("Connected to OpenSea Stream API.");
  } catch (err) {
    logger.error("client.connect() error:", err?.message || err);
  }
};

// Logger Utility
const logger = {
  info: (message, ...args) => console.log(`ℹ️  ${message}`, ...args),
  success: (message, ...args) => console.log(`✅ ${message}`, ...args),
  error: (message, ...args) => {
    // If the message (or any arg) matches 'Unexpected server response'
    const shortMessage =
      message &&
      typeof message === "string" &&
      message.includes("Unexpected server response:")
        ? `WS handshake error: ${message.replace(
            "Unexpected server response: ",
            ""
          )}`
        : message;

    console.error(`❌ ${shortMessage}`, ...args);
  },
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
  // comboKongChannel = await discordBot.channels.fetch(
  //   CONFIG.COMBO_KONGS_CHANNEL_ID
  // );

  logger.success(
    `Fetched newListingChannel: ${newListingChannel?.name} (ID: ${newListingChannel?.id})`
  );

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

      // Send Telegram Msg for 90+ Boost
      const nftName = payload.item?.metadata?.name || "Unnamed NFT";
      const price = Number(payload.base_price || 0) / 1e18;
      const priceInUSDTele = payload.payment_token?.usd_price
        ? `$${(price * payload.payment_token.usd_price).toFixed(2)}`
        : "N/A";
      const link = payload.item?.permalink || "https://opensea.io";
      // FOR FUTURE TELEGRAM MSGS
      // const message = `${nftName} is listed for ${price.toFixed(
      //   4
      // )} ETH. Or ${priceInUSDTele} USD. [Check it out here](${link}).\n`;

      if (eventType === "Item Listed") {
        await newListingChannel.send({ embeds: [embed] });
        logger.success(`Sent embed message to New Listing Channel Channel.`);

        if (isGoodNinety) {
          logger.success(
            `Recognized as a Good Deal 90! Sending to Good Deals 90 Channel.`
          );
          // Send Telegram Msg for 90+ Boost
          const nftName = payload.item?.metadata?.name || "Unnamed NFT";
          const price = Number(payload.base_price || 0) / 1e18;
          const priceInUSDTele = payload.payment_token?.usd_price
            ? `$${(price * payload.payment_token.usd_price).toFixed(2)}`
            : "N/A";
          const link = payload.item?.permalink || "https://opensea.io";
          const message = `${nftName} is listed with a 90+ boost for ${price.toFixed(
            4
          )} ETH. Or ${priceInUSDTele} USD. [Check it out here](${link}).\n`;

          // Send Telegram notification
          const telegramChatId = process.env.TELEGRAM_CHAT_ID; // Set your Telegram Chat ID
          await sendTelegramNotification(telegramChatId, message);
          logger.success(`📱 Telegram notification sent: ${message}`);

          await ninetyPlusChannel.send({ embeds: [embed] });
          logger.success(`Sent embed message to Good Deal 90 Channel.`);
        }
        if (isGoodEighty) {
          logger.success(
            `Recognized as a Good Deal 80! Sending to Good Deals 80 Channel.`
          );
          // Send Telegram notification
          const message = `${nftName} is listed with a 90+ boost for ${price.toFixed(
            4
          )} ETH. Or ${priceInUSDTele} USD. [Check it out here](${link}).\n`;
          const telegramChatId = process.env.TELEGRAM_CHAT_ID; // Set your Telegram Chat ID
          await sendTelegramNotification(telegramChatId, message);
          logger.success(`📱 Telegram notification sent: ${message}`);

          await eightyPlusChannel.send({ embeds: [embed] });
          logger.success(`Sent embed message to Good Deal 80 Channel.`);
        }
        if (isGoodSeventy) {
          logger.success(
            `Recognized as a Good Deal 70! Sending to Good Deals 70 Channel.`
          );
          await seventyPlusChannel.send({ embeds: [embed] });
          logger.success(`Sent embed message to Good Deal 70 Channel.`);
        }
        if (isGoodTwoFortyPlus) {
          logger.success(
            `Recognized as a Good Deal 240 Plus! Sending to Good Deals 240 Plus Channel.`
          );
          await twoFortyOverallPlusChannel.send({ embeds: [embed] });
          logger.success(`Sent embed message to Good Deal 240 Plus Channel.`);
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
        logger.success(`Sent embed message to Sales Channel.`);
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

  const debugTelegram = process.env.DEBUG_TELEGRAM === "true";
  const debugDiscord = process.env.DEBUG_DISCORD === "true";

  const nftName = payload.item?.metadata?.name || "Unnamed NFT";
  const price = Number(payload.base_price || 0) / 1e18;
  const priceInUSDTele = payload.payment_token?.usd_price
    ? `$${(price * payload.payment_token.usd_price).toFixed(2)}`
    : "N/A";
  const link = payload.item?.permalink || "https://opensea.io";
  // FOR FUTURE TELEGRAM MSGS
  // const message = `${nftName} is listed for ${price.toFixed(
  //   4
  // )} ETH. Or ${priceInUSDTele} USD. [Check it out here](${link}).\n`;

  if (eventType === "Item Listed") {
    if (debugDiscord) {
      await newListingChannel.send({ embeds: [embed] });
      logger.success(`Sent embed message to New Listing Channel Channel.`);
    }
    if (isGoodNinety) {
      if (debugDiscord) {
        await ninetyPlusChannel.send({ embeds: [embed] });
        logger.success(`Sent embed message to Good Deal 90 Channel.`);
      }
      // Send Telegram Notification if debugTelegram is true
      if (debugTelegram) {
        const message = `${nftName} is listed with a 90+ boost for ${price.toFixed(
          4
        )} ETH. Or ${priceInUSDTele} USD. [Check it out here](${link}).\n`;
        const telegramChatId = process.env.TELEGRAM_CHAT_ID; // Set your Telegram Chat ID
        await sendTelegramNotification(telegramChatId, message);
        logger.success(`📱 Telegram notification sent: ${message}`);
      }
    }
    if (isGoodEighty && debugDiscord) {
      await eightyPlusChannel.send({ embeds: [embed] });
      logger.success(`Sent embed message to Good Deal 80 Channel.`);
    }
    if (isGoodSeventy && debugDiscord) {
      await seventyPlusChannel.send({ embeds: [embed] });
      logger.success(`Sent embed message to Good Deal 70 Channel.`);
    }
    if (isGoodTwoFortyPlus && debugDiscord) {
      await twoFortyOverallPlusChannel.send({ embeds: [embed] });
      logger.success(`Sent embed message to Good Deal 240 Plus Channel.`);
    }
    if (isBelowFloor && debugDiscord) {
      await belowFloorChannel.send({ embeds: [embed] });
      logger.success(`Sent embed message to Below Floor Listings Channel.`);
    }
  } else if (eventType === "Item Sold" && debugDiscord) {
    await salesChannel.send({ embeds: [embed] });
    logger.success(`Sent embed message to Sales Channel.`);
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

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM. Gracefully shutting down...");
  // e.g., discordBot.destroy(), close DB connections, etc.
  process.exit(0);
});

module.exports = { buildEmbedMessage, CONFIG };
