import { createClient, SanityClient } from '@sanity/client';
import { PredictionMarketAPI, MarketData } from './api.js';
import { Player } from './api.js';
import { ZKWasmAppRpc } from 'zkwasm-minirollup-rpc';
import { get_server_admin_key } from 'zkwasm-ts-server/src/config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Sanity market interface
interface SanityMarket {
  _id: string;
  _type: 'market';
  id: number;
  name: string;
  landing?: {
    _type: 'image';
    asset: {
      _ref: string;
      _type: 'reference';
    };
  };
  start: number;
  end: number;
  resolve: number;
  yes: number;
  no: number;
  b: number;
}

class SanitySyncService {
  private sanityClient: SanityClient;
  private predictionAPI: PredictionMarketAPI;
  private adminPlayer: Player;

  constructor() {
    // Initialize Sanity client
    this.sanityClient = createClient({
      projectId: 'vjx6z54y',
      dataset: 'markets',
      apiVersion: '2023-01-01',
      useCdn: true,
      token: process.env.SANITY_TOKEN // Optional, for write operations
    });

    // Initialize backend API
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    this.predictionAPI = new PredictionMarketAPI(baseUrl);

    // Initialize admin player for creating markets
    const adminKey = get_server_admin_key();
    const rpc = new ZKWasmAppRpc(baseUrl);
    this.adminPlayer = new Player(adminKey, rpc);
  }

  // Get all markets from Sanity
  async getSanityMarkets(): Promise<SanityMarket[]> {
    try {
      const query = `
        *[_type == "market"] | order(id asc) {
          _id,
          _type,
          id,
          name,
          landing,
          start,
          end,
          resolve,
          yes,
          no
        }
      `;
      
      const markets: SanityMarket[] = await this.sanityClient.fetch(query);
      console.log(`📊 Retrieved ${markets.length} markets from Sanity`);
      return markets;
    } catch (error) {
      console.error('❌ Error fetching markets from Sanity:', error);
      throw error;
    }
  }

  // Get all markets from backend
  async getBackendMarkets(): Promise<MarketData[]> {
    try {
      const markets = await this.predictionAPI.getAllMarkets();
      console.log(`🔧 Retrieved ${markets.length} markets from backend`);
      return markets;
    } catch (error) {
      console.error('❌ Error fetching markets from backend:', error);
      throw error;
    }
  }

  // Compare market data between Sanity and backend
  compareMarketData(sanityMarket: SanityMarket, backendMarket: MarketData): boolean {
    const sanityTitle = sanityMarket.name;
    const backendTitle = backendMarket.titleString || backendMarket.title;
    
    // Compare basic fields
    const fieldsMatch = {
      name: sanityTitle === backendTitle,
      start: sanityMarket.start.toString() === backendMarket.startTime,
      end: sanityMarket.end.toString() === backendMarket.endTime,
      resolve: sanityMarket.resolve.toString() === backendMarket.resolutionTime
    };

    const allMatch = Object.values(fieldsMatch).every(match => match);

    if (!allMatch) {
      console.error(`❌ Market ${sanityMarket.id} data mismatch:`);
      console.error('Sanity data:', {
        name: sanityTitle,
        start: sanityMarket.start,
        end: sanityMarket.end,
        resolve: sanityMarket.resolve
      });
      console.error('Backend data:', {
        name: backendTitle,
        start: backendMarket.startTime,
        end: backendMarket.endTime,
        resolve: backendMarket.resolutionTime
      });
      console.error('Field comparison:', fieldsMatch);
    }

    return allMatch;
  }

  // Create new market in backend based on Sanity data
  async createMarketFromSanity(sanityMarket: SanityMarket): Promise<void> {
    try {
      console.log(`🔨 Creating market ${sanityMarket.id}: "${sanityMarket.name}"`);
      
      const result = await this.adminPlayer.createMarket(
        sanityMarket.name,
        BigInt(sanityMarket.start),
        BigInt(sanityMarket.end),
        BigInt(sanityMarket.resolve),
        BigInt(sanityMarket.yes),
        BigInt(sanityMarket.no),
        BigInt(sanityMarket.b)
      );
      
      console.log(`✅ Successfully created market ${sanityMarket.id}`);
      console.log('Transaction result:', result);
    } catch (error) {
      console.error(`❌ Failed to create market ${sanityMarket.id}:`, error);
      throw error;
    }
  }

  // Install admin player (ignore if already exists)
  async installAdminPlayer(): Promise<void> {
    try {
      console.log('🔧 Installing admin player...');
      await this.adminPlayer.installPlayer();
      console.log('✅ Admin player installed successfully');
    } catch (error) {
      if (error instanceof Error && error.message === "PlayerAlreadyExists") {
        console.log('ℹ️  Admin player already exists, continuing...');
      } else {
        console.error('❌ Failed to install admin player:', error);
        throw error;
      }
    }
  }

  // Main sync function
  async syncMarkets(): Promise<void> {
    console.log('🚀 Starting Sanity-Backend market synchronization...\n');

    try {
      // Install admin player first (ignore if already exists)
      await this.installAdminPlayer();
      
      // Fetch data from both sources
      const [sanityMarkets, backendMarkets] = await Promise.all([
        this.getSanityMarkets(),
        this.getBackendMarkets()
      ]);

      // Extract market IDs
      const sanityMarketIds = sanityMarkets.map(m => m.id);
      const existedMarketIds = backendMarkets.map(m => parseInt(m.marketId));

      console.log(`\n📈 Sanity market IDs: [${sanityMarketIds.join(', ')}]`);
      console.log(`🔧 Backend market IDs: [${existedMarketIds.join(', ')}]`);

      // Process each Sanity market
      for (const sanityMarket of sanityMarkets) {
        const marketId = sanityMarket.id;
        console.log(`\n🔍 Processing market ${marketId}...`);

        if (existedMarketIds.includes(marketId)) {
          // Market exists in backend - verify data consistency
          console.log(`✅ Market ${marketId} exists in backend, verifying data...`);
          
          const backendMarket = backendMarkets.find(m => parseInt(m.marketId) === marketId);
          if (!backendMarket) {
            console.error(`❌ Backend market ${marketId} not found (unexpected error)`);
            process.exit(1);
          }

          const dataMatches = this.compareMarketData(sanityMarket, backendMarket);
          if (!dataMatches) {
            console.error(`❌ Data mismatch for market ${marketId}. Aborting sync.`);
            process.exit(1);
          }
          
          console.log(`✅ Market ${marketId} data is consistent`);
        } else {
          // Market doesn't exist in backend - create new market
          console.log(`🆕 Market ${marketId} not found in backend, creating new market...`);
          await this.createMarketFromSanity(sanityMarket);
        }
      }

      console.log('\n🎉 Synchronization completed successfully!');
    } catch (error) {
      console.error('\n💥 Synchronization failed:', error);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const syncService = new SanitySyncService();
  await syncService.syncMarkets();
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Script execution failed:', error);
    process.exit(1);
  });
}

export default SanitySyncService; 