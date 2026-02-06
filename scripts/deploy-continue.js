/* eslint-disable @typescript-eslint/no-require-imports */
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const tokenAddress = '0x1f775e3587fD876fDF44905b14e88Fc583366FB8';

  console.log('=== Continuing Deployment ===');
  console.log('Deployer:', deployer.address);

  const SwapToken = await hre.ethers.getContractFactory('SwapToken');
  const swapToken = SwapToken.attach(tokenAddress);
  const supply = await swapToken.totalSupply();
  console.log('Supply:', hre.ethers.formatEther(supply), 'SWAP');

  console.log('\n--- Deploying DAO ---');
  const DAO = await hre.ethers.getContractFactory('AgentSwapsDAO');
  const dao = await DAO.deploy(tokenAddress);
  console.log('DAO tx:', dao.deploymentTransaction().hash);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log('DAO:', daoAddr);

  console.log('\n--- Deploying Settler ---');
  const Settler = await hre.ethers.getContractFactory('AgentSwapsSettler');
  const settler = await Settler.deploy(deployer.address);
  console.log('Settler tx:', settler.deploymentTransaction().hash);
  await settler.waitForDeployment();
  const settlerAddr = await settler.getAddress();
  console.log('Settler:', settlerAddr);

  console.log('\n--- Configuring ---');
  let tx;
  tx = await swapToken.setDistributor(daoAddr, true);
  await tx.wait();
  console.log('DAO = distributor');

  tx = await swapToken.setDistributor(settlerAddr, true);
  await tx.wait();
  console.log('Settler = distributor');

  tx = await settler.setFillerAuthorization(hre.ethers.ZeroAddress, true);
  await tx.wait();
  console.log('Permissionless filling ON');

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log('\nRemaining:', hre.ethers.formatEther(bal), 'ETH');
  console.log('\n=== ALL 3 CONTRACTS DEPLOYED ===');
  console.log('Token:  ', tokenAddress);
  console.log('DAO:    ', daoAddr);
  console.log('Settler:', settlerAddr);

  require('fs').writeFileSync(
    'deployment.json',
    JSON.stringify(
      {
        network: 'base',
        chainId: 8453,
        deployer: deployer.address,
        contracts: { SwapToken: tokenAddress, AgentSwapsDAO: daoAddr, AgentSwapsSettler: settlerAddr },
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log('Saved deployment.json');
}
main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
