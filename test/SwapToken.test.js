/* eslint-disable @typescript-eslint/no-require-imports */
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('SwapToken v2 — Fair Launch', function () {
  async function deployFixture() {
    const [owner, agent1, agent2, distributor] = await ethers.getSigners();
    const SwapToken = await ethers.getContractFactory('SwapToken');
    const token = await SwapToken.deploy();
    return { token, owner, agent1, agent2, distributor };
  }

  describe('Deployment', function () {
    it('should mint 1B tokens to contract itself', async function () {
      const { token } = await loadFixture(deployFixture);
      const totalSupply = await token.totalSupply();
      expect(totalSupply).to.equal(ethers.parseEther('1000000000'));

      // ALL tokens in contract, ZERO to deployer
      const contractBalance = await token.balanceOf(await token.getAddress());
      expect(contractBalance).to.equal(totalSupply);
    });

    it('should have zero tokens on deployer', async function () {
      const { token, owner } = await loadFixture(deployFixture);
      expect(await token.balanceOf(owner.address)).to.equal(0n);
    });

    it('should have correct pool allocations', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.USAGE_POOL()).to.equal(ethers.parseEther('500000000'));
      expect(await token.LIQUIDITY_POOL()).to.equal(ethers.parseEther('200000000'));
      expect(await token.GOVERNANCE_POOL()).to.equal(ethers.parseEther('200000000'));
      expect(await token.ECOSYSTEM_POOL()).to.equal(ethers.parseEther('100000000'));
    });

    it('should have zero distributed at genesis', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.usageDistributed()).to.equal(0n);
      expect(await token.liquidityDistributed()).to.equal(0n);
      expect(await token.governanceDistributed()).to.equal(0n);
      expect(await token.ecosystemDistributed()).to.equal(0n);
      expect(await token.totalDistributed()).to.equal(0n);
      expect(await token.totalRemaining()).to.equal(ethers.parseEther('1000000000'));
    });

    it('should set genesis time', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.genesisTime()).to.be.gt(0n);
    });

    it('should start at epoch 0', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.currentEpoch()).to.equal(0n);
    });

    it('should set correct name and symbol', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.name()).to.equal('AgentSwaps');
      expect(await token.symbol()).to.equal('SWAP');
    });

    it('should have 18 decimals', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.decimals()).to.equal(18);
    });

    it('should support permit (ERC20Permit)', async function () {
      const { token } = await loadFixture(deployFixture);
      const domain = await token.DOMAIN_SEPARATOR();
      expect(domain).to.not.equal(ethers.ZeroHash);
    });
  });

  describe('Halving', function () {
    it('should return divisor 1 at epoch 0', async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.halvingDivisor()).to.equal(1n);
    });

    it('should apply halving correctly at epoch 0', async function () {
      const { token } = await loadFixture(deployFixture);
      const base = ethers.parseEther('1000');
      expect(await token.applyHalving(base)).to.equal(base);
    });

    it('should halve after 180 days', async function () {
      const { token } = await loadFixture(deployFixture);
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine');

      expect(await token.currentEpoch()).to.equal(1n);
      expect(await token.halvingDivisor()).to.equal(2n);
      expect(await token.applyHalving(ethers.parseEther('1000'))).to.equal(ethers.parseEther('500'));
    });

    it('should quarter after 360 days', async function () {
      const { token } = await loadFixture(deployFixture);
      await ethers.provider.send('evm_increaseTime', [360 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine');

      expect(await token.currentEpoch()).to.equal(2n);
      expect(await token.halvingDivisor()).to.equal(4n);
      expect(await token.applyHalving(ethers.parseEther('1000'))).to.equal(ethers.parseEther('250'));
    });

    it('should cap at epoch 10', async function () {
      const { token } = await loadFixture(deployFixture);
      await ethers.provider.send('evm_increaseTime', [11 * 180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine');

      expect(await token.currentEpoch()).to.equal(11n);
      expect(await token.halvingDivisor()).to.equal(1024n); // 2^10 capped
    });
  });

  describe('Usage Rewards', function () {
    it('should distribute usage rewards', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);

      const baseReward = ethers.parseEther('1000');
      await token.connect(distributor).distributeUsageReward(agent1.address, baseReward);

      expect(await token.balanceOf(agent1.address)).to.equal(baseReward);
      expect(await token.usageDistributed()).to.equal(baseReward);
    });

    it('should emit UsageRewardDistributed event', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);

      const baseReward = ethers.parseEther('1000');
      await expect(token.connect(distributor).distributeUsageReward(agent1.address, baseReward))
        .to.emit(token, 'UsageRewardDistributed')
        .withArgs(agent1.address, baseReward, 0n);
    });

    it('should reject unauthorized distributors', async function () {
      const { token, agent1, agent2 } = await loadFixture(deployFixture);
      await expect(
        token.connect(agent1).distributeUsageReward(agent2.address, ethers.parseEther('100'))
      ).to.be.revertedWith('Not authorized');
    });

    it('should reject zero address', async function () {
      const { token, distributor } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);
      await expect(
        token.connect(distributor).distributeUsageReward(ethers.ZeroAddress, ethers.parseEther('100'))
      ).to.be.revertedWith('Zero agent');
    });

    it('should respect pool cap', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);
      await expect(
        token.connect(distributor).distributeUsageReward(agent1.address, ethers.parseEther('500000001'))
      ).to.be.revertedWith('Usage pool exhausted');
    });

    it('should apply halving to rewards', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);

      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine');

      await token.connect(distributor).distributeUsageReward(agent1.address, ethers.parseEther('1000'));
      expect(await token.balanceOf(agent1.address)).to.equal(ethers.parseEther('500'));
    });

    it('should emit DistributorUpdated event', async function () {
      const { token, distributor } = await loadFixture(deployFixture);
      await expect(token.setUsageDistributor(distributor.address, true))
        .to.emit(token, 'DistributorUpdated')
        .withArgs('usage', distributor.address, true);
    });

    it('should allow revoking distributor', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);
      await token.setUsageDistributor(distributor.address, false);
      await expect(
        token.connect(distributor).distributeUsageReward(agent1.address, ethers.parseEther('100'))
      ).to.be.revertedWith('Not authorized');
    });
  });

  describe('Governance Rewards', function () {
    it('should distribute governance rewards', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setGovernanceDistributor(distributor.address, true);

      const reward = ethers.parseEther('100');
      await token.connect(distributor).distributeGovernanceReward(agent1.address, reward);
      expect(await token.balanceOf(agent1.address)).to.equal(reward);
      expect(await token.governanceDistributed()).to.equal(reward);
    });

    it('should respect governance pool cap', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setGovernanceDistributor(distributor.address, true);
      await expect(
        token.connect(distributor).distributeGovernanceReward(agent1.address, ethers.parseEther('200000001'))
      ).to.be.revertedWith('Governance pool exhausted');
    });
  });

  describe('Ecosystem Grants', function () {
    it('should distribute ecosystem grants without halving', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setEcosystemDistributor(distributor.address, true);

      // Advance time so halving would normally apply
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine');

      const grant = ethers.parseEther('1000000');
      await token.connect(distributor).distributeEcosystemGrant(agent1.address, grant);
      expect(await token.balanceOf(agent1.address)).to.equal(grant);
    });

    it('should respect ecosystem pool cap', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setEcosystemDistributor(distributor.address, true);
      await expect(
        token.connect(distributor).distributeEcosystemGrant(agent1.address, ethers.parseEther('100000001'))
      ).to.be.revertedWith('Ecosystem pool exhausted');
    });
  });

  describe('Liquidity Rewards', function () {
    it('should distribute liquidity rewards with halving', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setLiquidityDistributor(distributor.address, true);

      const reward = ethers.parseEther('1000');
      await token.connect(distributor).distributeLiquidityReward(agent1.address, reward);
      expect(await token.balanceOf(agent1.address)).to.equal(reward);
      expect(await token.liquidityDistributed()).to.equal(reward);
    });

    it('should respect liquidity pool cap', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setLiquidityDistributor(distributor.address, true);
      await expect(
        token.connect(distributor).distributeLiquidityReward(agent1.address, ethers.parseEther('200000001'))
      ).to.be.revertedWith('Liquidity pool exhausted');
    });
  });

  describe('View Functions', function () {
    it('should track remaining correctly', async function () {
      const { token, distributor, agent1 } = await loadFixture(deployFixture);
      await token.setUsageDistributor(distributor.address, true);
      await token.connect(distributor).distributeUsageReward(agent1.address, ethers.parseEther('1000'));

      expect(await token.usageRemaining()).to.equal(ethers.parseEther('499999000'));
      expect(await token.totalDistributed()).to.equal(ethers.parseEther('1000'));
      expect(await token.totalRemaining()).to.equal(ethers.parseEther('999999000'));
    });
  });

  describe('Ownership', function () {
    it('should transfer to DAO', async function () {
      const { token, agent1 } = await loadFixture(deployFixture);
      await token.transferToDAO(agent1.address);
      expect(await token.owner()).to.equal(agent1.address);
    });

    it('should reject zero DAO address', async function () {
      const { token } = await loadFixture(deployFixture);
      await expect(token.transferToDAO(ethers.ZeroAddress)).to.be.revertedWith('Zero DAO');
    });

    it('should only allow owner to set distributors', async function () {
      const { token, agent1, distributor } = await loadFixture(deployFixture);
      await expect(token.connect(agent1).setUsageDistributor(distributor.address, true)).to.be.revertedWithCustomError(
        token,
        'OwnableUnauthorizedAccount'
      );
    });
  });
});
