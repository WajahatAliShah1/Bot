import { OpenSeaStreamClient, Network, EventType } from '@opensea/stream-js';
import { WebSocket } from 'ws';
import { LocalStorage } from 'node-localstorage';

// Stream API Setup
export const setupStreamClient = (onEvent: (eventType: string, payload: any) => void) => {
  const client = new OpenSeaStreamClient({
    network: Network.MAINNET, // Use TESTNET for testing
    token: process.env.OPENSEA_API_KEY!,
    connectOptions: {
      transport: WebSocket,
      sessionStorage: LocalStorage,
    },
  });

  const collectionSlug = process.env.COLLECTION_SLUG!;

  console.log('🔄 Connecting to OpenSea Stream API...');

  // Subscribe to Item Listed
  client.onItemListed(collectionSlug, (event) => {
    console.log('✅ Item Listed Event Received');
    console.log('✅ Item Listed Event:', JSON.stringify(event, null, 2));
    onEvent('Item Listed', event.payload);
  });

  // Subscribe to Item Received Offer
  client.onItemReceivedOffer(collectionSlug, (event) => {
    console.log('💰 New Offer Event Received');
    console.log('💰 New Offer Event:', JSON.stringify(event, null, 2));
    onEvent('Item Received Offer', event.payload);
  });

  // Connect
  client.connect();
  console.log('✅ Connected to OpenSea Stream API.');
};
