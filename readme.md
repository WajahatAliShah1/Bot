# Discord NFT Monitor Bot

This bot integrates with the OpenSea API to monitor NFT events such as listings and sales for a specific collection. It sends notifications to designated Discord channels with detailed embed messages.

---

## Features

- **New Listings Alerts**: Posts a detailed embed to the configured channel for every new listing in the collection.
- **Good Deals Alerts**: Detects NFTs with specific traits (e.g., stats over 90) and posts in a separate channel.
- **Below Floor Price Alerts**: Identifies listings below the collection floor price and posts in the "Below Floor" channel.
- **Sales Alerts**: Notifies about completed sales with transaction details.
- **Retry Mechanism**: Automatically retries API requests in case of failures.
- **Simulation Mode**: Allows testing of the bot using a sample payload without interacting with the OpenSea API.

---

## Installation

### Prerequisites

1. **Node.js**: Ensure you have Node.js installed on your system. [Download Node.js](https://nodejs.org/)
2. **npm**: Comes bundled with Node.js for managing dependencies.

### Steps to Install

1. **Clone the repository**:

    From github main project page.

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up the `.env` file**:  
   Create a `.env` file in the root directory with the following variables:

   ```env
   DISCORD_BOT_TOKEN=your-discord-bot-token
   NEW_LISTINGS_CHANNEL_ID=new-listings-channel-id
   NINETYPLUS_DEAL_CHANNEL_ID=good-deals-channel-id
   SALES_CHANNEL_ID=sales-channel-id
   BELOW_FLOOR_LISTING_CHANNEL_ID=below-floor-channel-id
   OPENSEA_API_KEY=your-opensea-api-key
   COLLECTION_SLUG=your-collection-slug
   NODE_ENV=development
   ```

   Replace each placeholder with your actual values:
   - **Discord Bot Token**: Obtain this from the Discord Developer Portal.
   - **Channel IDs**: Retrieve these from your Discord server.
   - **OpenSea API Key**: [Generate an API key](https://docs.opensea.io/reference/request-an-api-key).
   - **Collection Slug**: The slug of the collection you wish to monitor on OpenSea.

4. **Run the bot**:
   ```bash
   node bot.js
   ```

---

## Testing and Simulation

### Test the Bot in Your Environment
1. Set `NODE_ENV=development` in your `.env` file.
2. Ensure that your Discord bot token and channel IDs are properly configured.
3. Run the bot:
   ```bash
   node bot.js
   ```

### Simulate Events
1. Set `NODE_ENV=simulate` in your `.env` file.
2. Change the example-payload import at the top from example-sale-payload or example-listing-payload to test either one.
3. Run the bot to simulate an event:
   ```bash
   node bot.js
   ```

   The bot will process the payload and post simulated event messages to the configured channels.

---

## Hosting the Bot Online

To host the bot online, you can use a cloud service such as AWS, Google Cloud, Heroku, or any VPS.

## File Descriptions

- **`bot.js`**: Main bot logic, including Discord and OpenSea API integration.
- **`example-payload.json`**: Sample payload used for testing or simulation.
- **`.env`**: Configuration file for environment variables (not included in the repo; create manually).
- **`package.json`**: Contains the dependencies and scripts for the project.

---

## Contributing

Contributions are welcome! To contribute:
1. Fork the repository.
2. Create a new branch:
   ```bash
   git checkout -b feature-name
   ```
3. Make your changes and test thoroughly.
4. Push to your fork:
   ```bash
   git push origin feature-name
   ```
5. Open a pull request.

---

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

---

## Acknowledgments

- **[Discord.js](https://discord.js.org/)**: Used for Discord bot functionality.
- **[OpenSea Stream API](https://docs.opensea.io/reference/stream-api-overview)**: For real-time NFT event streaming.
- **[Axios](https://axios-http.com/)**: For making HTTP requests.

---