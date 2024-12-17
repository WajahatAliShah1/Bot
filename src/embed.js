"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEmbedMessage = void 0;
const discord_js_1 = require("discord.js");
const buildEmbedMessage = (eventType, payload) => {
    var _a, _b;
    const { item, base_price, maker } = payload;
    const priceInETH = base_price ? (Number(base_price) / 1e18).toFixed(4) : 'N/A';
    const nftName = ((_a = item === null || item === void 0 ? void 0 : item.metadata) === null || _a === void 0 ? void 0 : _a.name) || 'Unnamed NFT';
    const imageUrl = ((_b = item === null || item === void 0 ? void 0 : item.metadata) === null || _b === void 0 ? void 0 : _b.image_url) || '';
    const assetUrl = (item === null || item === void 0 ? void 0 : item.permalink) || 'https://opensea.io';
    return new discord_js_1.EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`${nftName} - ${eventType}`)
        .setURL(assetUrl)
        .setThumbnail(imageUrl)
        .addFields({ name: 'Price', value: `${priceInETH} ETH`, inline: true }, { name: 'Maker', value: (maker === null || maker === void 0 ? void 0 : maker.address) || 'Unknown', inline: true })
        .setTimestamp()
        .setFooter({ text: 'OpenSea Stream API', iconURL: 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png' });
};
exports.buildEmbedMessage = buildEmbedMessage;
