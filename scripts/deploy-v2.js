/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps v2 — Fair Launch Deployment
 *
 * Deploys all 3 contracts to Base mainnet:
 *   1. SwapToken v2 (1B SWAP, 100% locked in contract)
 *   2. AgentSwapsSettler v2 (ERC-7683 + rewards)
 *   3. AgentSwapsDAO v2 (governance + rewards)
 *
 * Then configures:
 *   - Settler as usage distributor
 *   - DAO as governance + ecosystem distributor
 *   - Permissionless filling enabled
 *
 * Usage: npx hardhat run scripts/deploy-v2.js --network base
 */
const hre = require('hardhat');
const fs = require('fs');

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   AgentSwaps v2 — Fair Launch Deploy     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('Deployer:', deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Balance:', hre.ethers.formatEther(balance), 'ETH');
  console.log('');

  // --- 1. Deploy SwapToken v2 ---
  console.log('--- [1/3] Deploying SwapToken v2 ---');
  const SwapToken = await hre.ethers.getContractFactory('SwapToken');
  const token = await SwapToken.deploy();
  console.log('Tx:', token.deploymentTransaction().hash);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log('SwapToken v2:', tokenAddr);

  // Verify: all tokens in contract
  const supply = await token.totalSupply();
  const contractBal = await token.balanceOf(tokenAddr);
  const deployerBal = await token.balanceOf(deployer.address);
  console.log('Total Supply:', hre.ethers.formatEther(supply), 'SWAP');
  console.log('Contract balance:', hre.ethers.formatEther(contractBal), 'SWAP');
  console.log('Deployer balance:', hre.ethers.formatEther(deployerBal), 'SWAP (should be 0)');
  console.log('');

  // --- 2. Deploy Settler v2 ---
  console.log('--- [2/3] Deploying AgentSwapsSettler v2 ---');
  const Settler = await hre.ethers.getContractFactory('AgentSwapsSettler');
  const settler = await Settler.deploy(deployer.address, tokenAddr);
  console.log('Tx:', settler.deploymentTransaction().hash);
  await settler.waitForDeployment();
  const settlerAddr = await settler.getAddress();
  console.log('Settler v2:', settlerAddr);
  console.log('');

  // --- 3. Deploy DAO v2 ---
  console.log('--- [3/3] Deploying AgentSwapsDAO v2 ---');
  const DAO = await hre.ethers.getContractFactory('AgentSwapsDAO');
  const dao = await DAO.deploy(tokenAddr);
  console.log('Tx:', dao.deploymentTransaction().hash);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log('DAO v2:', daoAddr);
  console.log('');

  // --- Configure ---
  console.log('--- Configuring permissions ---');

  // Settler can distribute usage rewards
  let tx = await token.setUsageDistributor(settlerAddr, true);
  await tx.wait();
  console.log('Settler = usage distributor');

  // DAO can distribute governance rewards
  tx = await token.setGovernanceDistributor(daoAddr, true);
  await tx.wait();
  console.log('DAO = governance distributor');

  // DAO can distribute ecosystem grants
  tx = await token.setEcosystemDistributor(daoAddr, true);
  await tx.wait();
  console.log('DAO = ecosystem distributor');

  // DAO can distribute liquidity rewards
  tx = await token.setLiquidityDistributor(daoAddr, true);
  await tx.wait();
  console.log('DAO = liquidity distributor');

  // Enable permissionless filling
  tx = await settler.setFillerAuthorization(hre.ethers.ZeroAddress, true);
  await tx.wait();
  console.log('Permissionless filling ON');
  console.log('');

  // --- Final state ---
  const finalBal = await hre.ethers.provider.getBalance(deployer.address);
  const gasUsed = balance - finalBal;
  console.log('Gas spent:', hre.ethers.formatEther(gasUsed), 'ETH');
  console.log('Remaining:', hre.ethers.formatEther(finalBal), 'ETH');

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   DEPLOYMENT COMPLETE — FAIR LAUNCH      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('Token:  ', tokenAddr);
  console.log('Settler:', settlerAddr);
  console.log('DAO:    ', daoAddr);
  console.log('');
  console.log('Deployer SWAP balance:', hre.ethers.formatEther(deployerBal));
  console.log('Contract SWAP balance:', hre.ethers.formatEther(contractBal));
  console.log('');
  console.log('100% FAIR LAUNCH — Zero tokens to deployer.');

  // Save deployment
  const deployment = {
    version: 2,
    fairLaunch: true,
    network: 'base',
    chainId: 8453,
    deployer: deployer.address,
    contracts: {
      SwapToken: tokenAddr,
      AgentSwapsSettler: settlerAddr,
      AgentSwapsDAO: daoAddr,
    },
    config: {
      rewardPerSwap: '1000',
      feeBps: 30,
      halvingPeriod: '180 days',
      permissionlessFilling: true,
    },
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync('deployment-v2.json', JSON.stringify(deployment, null, 2) + '\n');
  console.log('\nSaved deployment-v2.json');
}

main().catch((e) => {
  console.error('DEPLOYMENT FAILED:', e.message);
  process.exit(1);
});
