/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps Deployment Script
 *
 * Deploys $SWAP token, DAO governance, and ERC-7683 settler contracts.
 * Built by AI agents. Deployed by AI agents.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network base-sepolia  # Testnet
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network base          # Mainnet
 */

const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('=== AgentSwaps Contract Deployment ===');
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network: ${hre.network.name}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH`);
  console.log();

  // Step 1: Deploy $SWAP Token
  console.log('--- Deploying SwapToken ($SWAP) ---');
  const SwapToken = await hre.ethers.getContractFactory('SwapToken');
  const swapToken = await SwapToken.deploy(
    deployer.address, // treasury — transfer to DAO later
    deployer.address, // teamVesting — transfer to vesting contract later
    deployer.address, // ecosystemFund — transfer to multisig later
    deployer.address // earlyBackers — transfer to vesting contract later
  );
  await swapToken.waitForDeployment();
  const tokenAddress = await swapToken.getAddress();
  console.log(`$SWAP Token deployed: ${tokenAddress}`);

  // Verify supply
  const totalSupply = await swapToken.totalSupply();
  console.log(`Total supply: ${hre.ethers.formatEther(totalSupply)} SWAP`);
  console.log();

  // Step 2: Deploy DAO
  console.log('--- Deploying AgentSwapsDAO ---');
  const DAO = await hre.ethers.getContractFactory('AgentSwapsDAO');
  const dao = await DAO.deploy(tokenAddress);
  await dao.waitForDeployment();
  const daoAddress = await dao.getAddress();
  console.log(`DAO deployed: ${daoAddress}`);
  console.log();

  // Step 3: Deploy ERC-7683 Cross-Chain Settler
  console.log('--- Deploying AgentSwapsSettler (ERC-7683) ---');
  const Settler = await hre.ethers.getContractFactory('AgentSwapsSettler');
  const settler = await Settler.deploy(deployer.address); // fee recipient = deployer initially
  await settler.waitForDeployment();
  const settlerAddress = await settler.getAddress();
  console.log(`Settler deployed: ${settlerAddress}`);
  console.log();

  // Step 4: Configure
  console.log('--- Configuring ---');
  const tx1 = await swapToken.setDistributor(daoAddress, true);
  await tx1.wait();
  console.log('DAO set as trading reward distributor');

  const tx2 = await swapToken.setDistributor(settlerAddress, true);
  await tx2.wait();
  console.log('Settler set as trading reward distributor');

  // Allow any filler (open market) — address(0) = permissionless
  const tx3 = await settler.setFillerAuthorization(hre.ethers.ZeroAddress, true);
  await tx3.wait();
  console.log('Permissionless filling enabled');

  // Summary
  console.log();
  console.log('=== DEPLOYMENT COMPLETE ===');
  console.log(`$SWAP Token: ${tokenAddress}`);
  console.log(`DAO:         ${daoAddress}`);
  console.log(`Settler:     ${settlerAddress}`);
  console.log(`Network:     ${hre.network.name}`);
  console.log();
  console.log('Next steps:');
  console.log('  1. Verify contracts on BaseScan');
  console.log('  2. Transfer token ownership to DAO: swapToken.transferToDAO(daoAddress)');
  console.log('  3. Create first governance proposal');
  console.log('  4. Add liquidity and start trading rewards');
  console.log();
  console.log('Built by agents. Owned by agents. On-chain.');

  // Save deployment info
  const deployInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    contracts: {
      SwapToken: tokenAddress,
      AgentSwapsDAO: daoAddress,
      AgentSwapsSettler: settlerAddress,
    },
    timestamp: new Date().toISOString(),
  };

  const fs = require('fs');
  fs.writeFileSync('deployment.json', JSON.stringify(deployInfo, null, 2));
  console.log('Deployment info saved to deployment.json');
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
