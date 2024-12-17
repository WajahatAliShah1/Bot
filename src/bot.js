"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const stream_1 = require("./stream");
const embed_1 = require("./embed");
// Initialize Discord Client
const discordBot = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
    ],
});
const setupDiscordBot = () => __awaiter(void 0, void 0, void 0, function* () {
    yield discordBot.login(process.env.DISCORD_BOT_TOKEN);
    console.log('Discord bot connected successfully.');
    const mainChannel = yield discordBot.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    const offersChannel = yield discordBot.channels.fetch(process.env.OFFERS_CHANNEL_ID);
    // Handle Stream API Events
    (0, stream_1.setupStreamClient)((eventType, payload) => __awaiter(void 0, void 0, void 0, function* () {
        const embed = (0, embed_1.buildEmbedMessage)(eventType, payload);
        if (eventType === 'New Offer') {
            yield offersChannel.send({ embeds: [embed] });
        }
        else if (eventType === 'Item Listed') {
            yield mainChannel.send({ embeds: [embed] });
        }
    }));
});
setupDiscordBot().catch(console.error);
