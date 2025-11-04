import { Player, PredictionMarketAPI } from "./api.js";
//import { LeHexBN, ZKWasmAppRpc} from "zkwasm-minirollup-rpc";
import { LeHexBN, query, ZKWasmAppRpc } from "zkwasm-ts-server";

const adminAccount = "1234";  // Admin account for creating markets
const player1Key = "456789789";
const player2Key = "987654321";

const rpc: any = new ZKWasmAppRpc("http://127.0.0.1:3000");
const adminPlayer = new Player(adminAccount, rpc);
const player1 = new Player(player1Key, rpc);
const player2 = new Player(player2Key, rpc);
const api = new PredictionMarketAPI("http://127.0.0.1:3000");

// Function to pause execution for a given duration
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const adminPubkey = new LeHexBN(query(adminAccount).pkx).toU64Array();
  const pubkey1 = new LeHexBN(query(player1Key).pkx).toU64Array();
  const pubkey2 = new LeHexBN(query(player2Key).pkx).toU64Array();
  
  console.log("Admin pubkey:", adminPubkey);
  console.log("Player 1 pubkey:", pubkey1);
  console.log("Player 2 pubkey:", pubkey2);

  try {
    console.log("=== Simplified Multi-Market User Testing ===\n");

    // Step 1: Install players
    console.log("1. Installing players...");
  try {
      await adminPlayer.installPlayer();
      console.log("  Admin installed");
    } catch (e) {
      console.log("  Admin already exists");
    }

    try {
      await player1.installPlayer();
      console.log("  Player 1 installed");
    } catch (e) {
      console.log("  Player 1 already exists");
    }

    try {
      await player2.installPlayer();
      console.log("  Player 2 installed");
    } catch (e) {
      console.log("  Player 2 already exists");
    }
    await delay(2000);

    // Step 2: Create a new market (admin only)
    console.log("\n2. Creating a new market...");
    try {
      const marketTitle = "Will Bitcoin reach $100K by 2025?";
      // Using relative time offsets (relative to current counter)
      const startTimeOffset = 0n;    // Start immediately 
      const endTimeOffset = 100n;    // End after 100 counter ticks
      const resolutionTimeOffset = 120n; // Resolve after 120 counter ticks
      const initialLiquidity = 50000n; // 50,000 units initial liquidity
      
      console.log(`  Creating market: "${marketTitle}"`);
      console.log(`  Initial liquidity: ${initialLiquidity} each side`);
      console.log(`  Time offsets: start=${startTimeOffset}, end=${endTimeOffset}, resolve=${resolutionTimeOffset}`);
      
      await adminPlayer.createMarket(
        marketTitle,
        startTimeOffset,
        endTimeOffset,
        resolutionTimeOffset,
        initialLiquidity,
        initialLiquidity,
        initialLiquidity
      );
      console.log("  Market created successfully!");
  } catch (e) {
      console.log("  Market creation failed:", e);
  }
    await delay(3000);

    // Step 3: Get all markets
    console.log("\n3. Fetching available markets...");
    const markets = await api.getAllMarkets();
    console.log(`  Found ${markets.length} markets`);
    
    if (markets.length === 0) {
      console.log("  No markets available for testing");
      return;
    }

    // Use the first available market for testing
    const testMarket = markets[0];
    const marketId = BigInt(testMarket.marketId);
    console.log(`  Using market ${testMarket.marketId}: "${testMarket.titleString || 'No title'}"`);
    console.log(`  YES Liquidity: ${testMarket.yesLiquidity}`);
    console.log(`  NO Liquidity: ${testMarket.noLiquidity}`);
    console.log(`  Prize Pool: ${testMarket.prizePool}`);
    console.log(`  Total Volume: ${testMarket.totalVolume}`);
    await delay(1000);

    // Step 4: Player 1 places a YES bet
    console.log("\n4. Player 1 placing YES bet...");
  try {
      const betAmount = 5000n;
      console.log(`  Betting ${betAmount} on YES`);
      
      const result = await player1.placeBet(marketId, 1, betAmount); // 1 = YES
      console.log("  YES bet placed successfully!");
      console.log("  Transaction result:", result);
    } catch (e) {
      console.log("  YES bet failed:", e);
    }
    await delay(3000);

    // Step 5: Player 2 places a NO bet
    console.log("\n5. Player 2 placing NO bet...");
    try {
      const betAmount = 3000n;
      console.log(`  Betting ${betAmount} on NO`);
      
      const result = await player2.placeBet(marketId, 0, betAmount); // 0 = NO
      console.log("  NO bet placed successfully!");
      console.log("  Transaction result:", result);
    } catch (e) {
      console.log("  NO bet failed:", e);
    }
    await delay(3000);

    // Step 6: Check updated market state
    console.log("\n6. Checking updated market state...");
    const updatedMarket = await api.getMarket(testMarket.marketId);
    console.log("  Updated market data:");
    console.log(`    Title: ${updatedMarket.titleString || 'No title'}`);
    console.log(`    YES Liquidity: ${updatedMarket.yesLiquidity}`);
    console.log(`    NO Liquidity: ${updatedMarket.noLiquidity}`);
    console.log(`    Prize Pool: ${updatedMarket.prizePool}`);
    console.log(`    Total Volume: ${updatedMarket.totalVolume}`);
    console.log(`    Total YES Shares: ${updatedMarket.totalYesShares}`);
    console.log(`    Total NO Shares: ${updatedMarket.totalNoShares}`);
    console.log(`    Fees Collected: ${updatedMarket.totalFeesCollected}`);

    // Calculate new prices
    const yesLiq = BigInt(updatedMarket.yesLiquidity);
    const noLiq = BigInt(updatedMarket.noLiquidity);
    const prices = api.calculatePrices(yesLiq, noLiq, BigInt(updatedMarket.yesLiquidity));
    console.log(`    Current prices: YES=${(prices.yesPrice * 100).toFixed(2)}%, NO=${(prices.noPrice * 100).toFixed(2)}%`);
    await delay(1000);

    // Step 8: Check player positions
    console.log("\n8. Checking player positions...");
    
    console.log("  Player 1 position in this market:");
    const player1Position = await api.getPlayerMarketPosition(
      pubkey1[1].toString(), 
      pubkey1[2].toString(),
      testMarket.marketId
    );
    console.log(`    YES Shares: ${player1Position.yesShares}`);
    console.log(`    NO Shares: ${player1Position.noShares}`);
    console.log(`    Claimed: ${player1Position.claimed}`);

    console.log("  Player 2 position in this market:");
    const player2Position = await api.getPlayerMarketPosition(
      pubkey2[1].toString(), 
      pubkey2[2].toString(),
      testMarket.marketId
    );
    console.log(`    YES Shares: ${player2Position.yesShares}`);
    console.log(`    NO Shares: ${player2Position.noShares}`);
    console.log(`    Claimed: ${player2Position.claimed}`);

    console.log("  Player 1 all positions:");
    const player1AllPositions = await api.getPlayerAllPositions(
      pubkey1[1].toString(), 
      pubkey1[2].toString()
    );
    player1AllPositions.forEach((pos, idx) => {
      console.log(`    Market ${pos.marketId}: YES=${pos.yesShares}, NO=${pos.noShares}, Claimed=${pos.claimed}`);
    });
    await delay(1000);

    // Step 9: Get market recent transactions
    console.log("\n9. Market recent activity...");
    const marketTransactions = await api.getMarketRecentTransactions(testMarket.marketId);
    console.log(`  Found ${marketTransactions.length} recent transactions in this market:`);
    marketTransactions.forEach((tx, idx) => {
      const player = `[${tx.pid[0]}, ${tx.pid[1]}]`;
      console.log(`    ${idx + 1}. ${player} - ${tx.transactionType}: ${tx.amount} units → ${tx.shares} shares`);
    });
    await delay(1000);

    // Step 10: Get player transaction history
    console.log("\n10. Player transaction history...");
    
    console.log("  Player 1 recent transactions across all markets:");
    const player1Transactions = await api.getPlayerRecentTransactions(
      pubkey1[1].toString(), 
      pubkey1[2].toString()
    );
    player1Transactions.forEach((tx, idx) => {
      console.log(`    ${idx + 1}. Market ${tx.marketId} - ${tx.transactionType}: ${tx.amount} → ${tx.shares}`);
    });

    console.log("  Player 1 transactions in this market:");
    const player1MarketTransactions = await api.getPlayerMarketRecentTransactions(
      pubkey1[1].toString(), 
      pubkey1[2].toString(),
      testMarket.marketId
    );
    player1MarketTransactions.forEach((tx, idx) => {
      console.log(`    ${idx + 1}. ${tx.transactionType}: ${tx.amount} → ${tx.shares}`);
    });

    console.log("  Player 2 recent transactions across all markets:");
    const player2Transactions = await api.getPlayerRecentTransactions(
      pubkey2[1].toString(), 
      pubkey2[2].toString()
    );
    player2Transactions.forEach((tx, idx) => {
      console.log(`    ${idx + 1}. Market ${tx.marketId} - ${tx.transactionType}: ${tx.amount} → ${tx.shares}`);
    });
    await delay(1000);

    // Step 11: Get market liquidity history and calculate prices
    console.log("\n11. Market liquidity history analysis...");
    const liquidityHistory = await api.getMarketLiquidityHistory(testMarket.marketId);
    console.log(`  Found ${liquidityHistory.length} liquidity data points`);
    
    if (liquidityHistory.length > 0) {
      const firstPoint = liquidityHistory[0];
      const lastPoint = liquidityHistory[liquidityHistory.length - 1];
      
      // Calculate prices on frontend
      const calcPrice = (yesLiq: string, noLiq: string) => {
        const yesLiqBig = BigInt(yesLiq);
        const noLiqBig = BigInt(noLiq);
        const totalLiq = yesLiqBig + noLiqBig;
        const yesPrice = totalLiq > 0n ? Number(noLiqBig) / Number(totalLiq) : 0.5;
        const noPrice = totalLiq > 0n ? Number(yesLiqBig) / Number(totalLiq) : 0.5;
        return { yesPrice, noPrice };
      };
      
      const firstPrices = calcPrice(firstPoint.yesLiquidity, firstPoint.noLiquidity);
      const lastPrices = calcPrice(lastPoint.yesLiquidity, lastPoint.noLiquidity);
      
      console.log("  Price evolution (calculated on frontend):");
      console.log(`    Initial: YES=${(firstPrices.yesPrice * 100).toFixed(2)}%, NO=${(firstPrices.noPrice * 100).toFixed(2)}%`);
      console.log(`    Current: YES=${(lastPrices.yesPrice * 100).toFixed(2)}%, NO=${(lastPrices.noPrice * 100).toFixed(2)}%`);
      
      const yesChange = ((lastPrices.yesPrice - firstPrices.yesPrice) * 100).toFixed(2);
      console.log(`    YES price change: ${yesChange}%`);
      
      // Show recent liquidity movements
      if (liquidityHistory.length > 5) {
        console.log("  Recent liquidity movements (last 5 data points):");
        liquidityHistory.slice(-5).forEach((point, idx) => {
          const prices = calcPrice(point.yesLiquidity, point.noLiquidity);
          console.log(`    Counter ${point.counter}: YES Liq=${point.yesLiquidity}, NO Liq=${point.noLiquidity}, Prices: YES=${(prices.yesPrice * 100).toFixed(2)}%, NO=${(prices.noPrice * 100).toFixed(2)}%`);
        });
      }
    }
    await delay(1000);

    // Step 12: Platform statistics calculated from markets
    console.log("\n12. Platform statistics...");
    let totalYesLiquidity = 0n;
    let totalNoLiquidity = 0n;
    let totalVolume = 0n;
    let activeMarkets = 0;
    let resolvedMarkets = 0;
    
    markets.forEach(m => {
      totalYesLiquidity += BigInt(m.yesLiquidity);
      totalNoLiquidity += BigInt(m.noLiquidity);
      totalVolume += BigInt(m.totalVolume || "0");
      if (m.resolved) {
        resolvedMarkets++;
      } else {
        activeMarkets++;
      }
    });
    
    console.log("  Platform overview:");
    console.log(`    Total Markets: ${markets.length}`);
    console.log(`    Active Markets: ${activeMarkets}`);
    console.log(`    Resolved Markets: ${resolvedMarkets}`);
    console.log(`    Total Platform Liquidity: ${totalYesLiquidity + totalNoLiquidity}`);
    console.log(`    Total Platform Volume: ${totalVolume}`);
    
    // Calculate platform-wide average price (frontend calculation)
    const platformAvgYesPrice = totalNoLiquidity > 0n ? 
      Number(totalNoLiquidity) / Number(totalYesLiquidity + totalNoLiquidity) : 0.5;
    console.log(`    Platform Average YES Price: ${(platformAvgYesPrice * 100).toFixed(2)}%`);

  } catch (e) {
    console.error("Error during testing:", e);
  }

  console.log("\n=== User Testing Complete ===");
}

main();
