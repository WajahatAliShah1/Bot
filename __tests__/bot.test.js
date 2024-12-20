const nock = require("nock");
const { buildEmbedMessage } = require("../bot"); // Adjust based on file structure
const payloads = require("../test-data/opensea-payloads.json");

const { CONFIG } = require("../bot");

console.log("API Key in Mock:", CONFIG.OPENSEA_API_KEY);


beforeAll(() => {
  // Mock Fetch Asset Details API for Listed Item
  nock("https://api.opensea.io")
    .get(
      "/api/v2/chain/ethereum/contract/0x495f947276749ce646f68ac8c248420045cb7b5e/nfts/74630152366364009569833059154376861594951644105207272687495389092116791558145"
    )
    .matchHeader("x-api-key", CONFIG.OPENSEA_API_KEY) // Match the x-api-key header
    .reply(200, {
      nft: { traits: [] }, // Mock empty traits for simplicity
    });

  // Mock Fetch Asset Details API for Sold Item
  nock("https://api.opensea.io")
    .get(
      "/api/v2/chain/ethereum/contract/0x8dc7b6ec6fafa36085ee9ec8e39112428d3360aa/nfts/3884"
    )
    .matchHeader("x-api-key", CONFIG.OPENSEA_API_KEY) // Match the x-api-key header
    .reply(200, {
      nft: { traits: [] }, // Mock empty traits for simplicity
    });

  // Mock Fetch Collection Floor Price API
  nock("https://api.opensea.io")
    .get("/api/v2/collections/rumble-kong-league/stats")
    .matchHeader("x-api-key", CONFIG.OPENSEA_API_KEY) // Match the x-api-key header
    .reply(200, {
      total: { floor_price: 0.23 }, // Mocked floor price
    })
    .persist(); // Ensure this mock persists for multiple uses
});

describe("Discord Bot - Event Handling", () => {
  test("Handles Item Listed event and builds correct embed", async () => {
    const { embed } = await buildEmbedMessage(
      "Item Listed",
      payloads.item_listed.payload.payload
    );

    console.log(embed.data); // Debugging to verify structure

    // Validate embed structure and data
    expect(embed.data.title).toBe("Devil Frens #18682 - Item Listed");
    expect(embed.data.url).toBe(
      "https://opensea.io/assets/ethereum/0x495f947276749ce646f68ac8c248420045cb7b5e/74630152366364009569833059154376861594951644105207272687495389092116791558145"
    );
    expect(embed.data.thumbnail.url).toBe(
      "https://i.seadn.io/gae/6X_iRBPw33gDSZFlHxBBs6pSfQU8Z8c1ECpRV_Nru-fDvO6ORUky5GhpXeAtTR2ZNvkf8vElpW5-4NbdVOBOPr3aF1P_1Z-Mid6LLF8?w=500&auto=format"
    );
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        { name: "Price (ETH)", value: "0.0050 ETH", inline: true },
        { name: "Price (USD)", value: "$6.44", inline: true },
        { name: "Floor Price", value: "0.2300 ETH", inline: false },
      ])
    );
  }, 15000); // Set a timeout of 15 seconds
  test("Handles Item Sold event and builds correct embed", async () => {
    const { embed } = await buildEmbedMessage(
      "Item Sold",
      payloads.item_sold.payload.payload
    );

    console.log(embed.data); // Debugging to verify structure

    // Validate embed structure and data
    expect(embed.data.title).toBe("SNEAKERHEADS #3884 - Item Sold");
    expect(embed.data.url).toBe(
      "https://opensea.io/assets/ethereum/0x8dc7b6ec6fafa36085ee9ec8e39112428d3360aa/3884"
    );
    expect(embed.data.thumbnail.url).toBe(
      "https://i.seadn.io/gae/7k408lJucpd0xYOlfvucW50zsXfa53YvdhsRZ_Y_mkmR1mUcNxPKoUphLbgHjLE7-qd5fvnYKBkyGxPsIyV2zQhLy2jjH4KVr8gqeg?w=500&auto=format"
    );
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        { name: "Price (ETH)", value: "0.1500 ETH", inline: true },
        { name: "Price (USD)", value: "$193.07", inline: true },
        {
          name: "From",
          value: "0x16ce6c6662510faf7c34bb1406fd8c20641db9e3",
          inline: true,
        },
        {
          name: "To",
          value: "0xa16f1cba10737adff9b7ed6f12bd3fcfe93c2d8e",
          inline: true,
        },
        {
          name: "Transaction",
          value:
            "[View Transaction](https://etherscan.io/tx/0x27b04793393f06f5529bed99bfb35f8af2487a478a7ace121ebc1f057c77c6b1)",
        },
      ])
    );
  }, 15000); // Set a timeout of 15 seconds
});
