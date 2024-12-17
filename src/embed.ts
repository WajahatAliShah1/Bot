import { EmbedBuilder } from 'discord.js';

export const buildEmbedMessage = (eventType: string, payload: any): EmbedBuilder => {
  // Safely destructure payload with fallback values
  const { item = {}, base_price = null, maker = {} } = payload || {};

  const priceInETH = base_price ? (Number(base_price) / 1e18).toFixed(4) : 'N/A';
  const nftName = item?.metadata?.name || 'Unnamed NFT';
  const imageUrl = item?.metadata?.image_url || 'https://opensea.io/static/images/logos/opensea-logo.png';
  const assetUrl = item?.permalink || 'https://opensea.io';

  return new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${nftName} - ${eventType}`)
    .setURL(assetUrl)
    .setThumbnail(imageUrl)
    .addFields(
      { name: 'Price', value: `${priceInETH} ETH`, inline: true },
      { name: 'Maker', value: maker?.address || 'Unknown', inline: true }
    )
    .setTimestamp(new Date()) // Ensure timestamp is always valid
    .setFooter({
      text: 'OpenSea Stream API',
      iconURL: 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png',
    });
};
