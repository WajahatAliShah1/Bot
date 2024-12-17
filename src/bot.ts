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
import fs from "fs";

// Discord Bot Initialization
const discordBot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const fetchAssetDetails = async (
  chain: string,
  contractAddress: string,
  tokenId: string
) => {
  try {
    const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`;
    console.log("🔍 Fetching asset details from OpenSea API v2:", url);

    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": process.env.OPENSEA_API_KEY || "", // Use OpenSea API key
      },
    });

    return response.data.nft.traits || [];
  } catch (error) {
    if (error instanceof AxiosError) {
      // Safely access AxiosError properties
      console.error(
        "❌ Failed to fetch asset details:",
        error.response?.status,
        error.response?.data
      );
    } else {
      console.error("❌ Unknown error:", error);
    }
    return [];
  }
};

export const buildEmbedMessage = async (
  eventType: string,
  payload: any
): Promise<{ embed: EmbedBuilder; isGoodDeal: boolean }> => {
  console.log("🔍 Building Embed - Event Type:", eventType);

  const { item = {}, base_price = null, payment_token = {} } = payload || {};
  const nftName = item?.metadata?.name || "Unnamed NFT";
  const imageUrl =
    item?.metadata?.image_url ||
    "https://opensea.io/static/images/logos/opensea-logo.png";
  const assetUrl = item?.permalink || "https://opensea.io";

  const contractAddress = item?.nft_id?.split("/")[1] || "";
  const tokenId = item?.nft_id?.split("/")[2] || "";

  console.log("🔍 Contract Address:", contractAddress, "Token ID:", tokenId);

  // Fetch full asset details to get Boosts
  const traits = await fetchAssetDetails("ethereum", contractAddress, tokenId);

  const findBoost = (key: string): number => {
    const boost = traits.find(
      (trait: any) => trait.trait_type?.toLowerCase() === key.toLowerCase()
    );
    return boost ? Number(boost.value) || 0 : 0; // Default to 0 if not found
  };

  const shooting = findBoost("Shooting");
  const defense = findBoost("Defense");
  const finish = findBoost("Finish");
  const vision = findBoost("Vision");

  // Calculate Overall Score
  const overall = shooting + defense + finish + vision;

  console.log(
    `✅ Boosts - Shooting: ${shooting}, Defense: ${defense}, Finish: ${finish}, Vision: ${vision}`
  );
  console.log(`✅ Calculated Overall: ${overall}`);

  // Price calculations
  const priceInETH = base_price ? Number(base_price) / 1e18 : 0;
  const priceInETHString = priceInETH.toFixed(4);
  const usdPricePerETH = payment_token?.usd_price
    ? Number(payment_token.usd_price)
    : 0;
  const priceInUSD =
    priceInETH && usdPricePerETH > 0
      ? `$${(priceInETH * usdPricePerETH).toFixed(2)}`
      : "N/A";

  // Determine if it's a good deal
  const isGoodDeal =
    priceInETH < 0.35 &&
    (shooting >= 90 || defense >= 90 || finish >= 90 || vision >= 90);

  console.log(`🟢 Is this a Good Deal? ${isGoodDeal ? "YES" : "NO"}`);

  // Build Embed
  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle(`${nftName} - ${eventType}`)
    .setURL(assetUrl)
    .setThumbnail(imageUrl)
    .addFields(
      { name: "Price (ETH)", value: `${priceInETHString} ETH`, inline: true },
      { name: "Price (USD)", value: priceInUSD, inline: true },
      { name: "Overall", value: `${overall}`, inline: false }
    )
    .addFields(
      { name: "Shooting", value: `${shooting}`, inline: true },
      { name: "Defense", value: `${defense}`, inline: true }
    )
    .addFields(
      { name: "Finish", value: `${finish}`, inline: true },
      { name: "Vision", value: `${vision}`, inline: true }
    )
    .setTimestamp(new Date())
    .setFooter({
      text: "OpenSea Stream API",
      iconURL:
        "https://files.readme.io/566c72b-opensea-logomark-full-colored.png",
    });

  return { embed, isGoodDeal };
};

// Function to Setup OpenSea Stream
// Function to Setup OpenSea Stream
const setupStreamClient = (
  onEvent: (eventType: string, payload: any) => void
) => {
  const client = new OpenSeaStreamClient({
    network: Network.MAINNET,
    token: process.env.OPENSEA_API_KEY!,
    connectOptions: { transport: WebSocket },
  });

  const collectionSlug = process.env.COLLECTION_SLUG!;

  console.log("🔄 Connecting to OpenSea Stream API...");

  // Listen for Item Listed
  client.onItemListed(collectionSlug, async (event) => {
    try {
      console.log("✅ Item Listed Event Received");
      console.log("🔍 Event Payload:", JSON.stringify(event, null, 2));
      fs.writeFileSync("payload.txt", JSON.stringify(event, null, 2)); // Save payload
      await onEvent("Item Listed", event.payload);
    } catch (error) {
      console.error("❌ Error handling Item Listed event:", error);
    }
  });

  // Listen for Item Sold
  client.onItemSold(collectionSlug, async (event) => {
    try {
      console.log("✅ Item Sold Event Received");
      console.log("🔍 Event Payload:", JSON.stringify(event, null, 2));
      fs.writeFileSync("payload_sold.txt", JSON.stringify(event, null, 2)); // Save payload
      await onEvent("Item Sold", event.payload);
    } catch (error) {
      console.error("❌ Error handling Item Sold event:", error);
    }
  });

  client.connect();
  console.log("✅ Connected to OpenSea Stream API.");
};


// Main Bot Setup
const setupDiscordBot = async () => {
  await discordBot.login(process.env.DISCORD_BOT_TOKEN);
  console.log("✅ Discord bot connected successfully.");

  const mainChannel = (await discordBot.channels.fetch(
    process.env.DISCORD_CHANNEL_ID!
  )) as TextChannel;

  const goodDealsChannel = (await discordBot.channels.fetch(
    process.env.GOOD_DEALS_CHANNEL_ID!
  )) as TextChannel;

  if (!mainChannel) throw new Error("❌ Main channel not found.");
  if (!goodDealsChannel) throw new Error("❌ Good Deals channel not found.");

  // Handle Stream Events
  setupStreamClient(async (eventType, payload) => {
    let embed, isGoodDeal;

    try {
      console.log("🚧 Building Embed for Event...");
      const result = await buildEmbedMessage(eventType, payload); // Await for embed and good deal flag
      embed = result.embed;
      isGoodDeal = result.isGoodDeal;
      console.log("✅ Embed built successfully.");
    } catch (error) {
      console.error("❌ Error building embed:", error);
      return;
    }

    try {
      console.log("📨 Sending embed to Discord...");
      if (eventType === "Item Listed") {
        // Send to Main Channel
        await mainChannel.send({ embeds: [embed] });
        console.log("✅ Embed sent to main channel.");

        // Send to Good Deals Channel if criteria are met
        if (isGoodDeal) {
          console.log("🟢 Sending embed to Good Deals channel...");
          await goodDealsChannel.send({ embeds: [embed] });
          console.log("✅ Embed sent to Good Deals channel.");
        }
      }
    } catch (error) {
      console.error("❌ Error sending embed to Discord:", error);
    }
  });
};

// Start the Bot
setupDiscordBot().catch((error) =>
  console.error("❌ Bot setup failed:", error)
);
