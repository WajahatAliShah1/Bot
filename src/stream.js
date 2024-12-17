"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupStreamClient = void 0;
const stream_js_1 = require("@opensea/stream-js");
const ws_1 = require("ws");
const node_localstorage_1 = require("node-localstorage");
// Initialize OpenSea Stream Client
const setupStreamClient = (onEvent) => {
    const client = new stream_js_1.OpenSeaStreamClient({
        network: stream_js_1.Network.MAINNET, // Switch to TESTNET for test events
        token: process.env.OPENSEA_API_KEY,
        connectOptions: {
            transport: ws_1.WebSocket,
            sessionStorage: node_localstorage_1.LocalStorage,
        },
    });
    const collectionSlug = process.env.COLLECTION_SLUG;
    // Subscribe to Item Listed
    client.onItemListed(collectionSlug, (event) => {
        onEvent('Item Listed', event.payload);
    });
    // Subscribe to Item Received Offer
    client.onItemReceivedOffer(collectionSlug, (event) => {
        onEvent('New Offer', event.payload);
    });
    // Connect
    client.connect();
    console.log('Connected to OpenSea Stream API...');
};
exports.setupStreamClient = setupStreamClient;
