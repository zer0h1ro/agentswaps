/* eslint-disable @typescript-eslint/no-require-imports */
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('AgentSwapsDAO v2', function () {
  async function deployFixture() {
    const [owner, voter1, voter2, voter3, nonHolder, target] = await ethers.getSigners();

    // Deploy token (v2 — fair launch, all in contract)
    const SwapToken = await ethers.getContractFactory('SwapToken');
    const token = await SwapToken.deploy();

    // Deploy DAO
    const DAO = await ethers.getContractFactory('AgentSwapsDAO');
    const dao = await DAO.deploy(await token.getAddress());

    // Set DAO as governance distributor so voters earn rewards
    await token.setGovernanceDistributor(await dao.getAddress(), true);

    // Distribute tokens to voters via usage rewards (fair launch — only way to get tokens)
    await token.setUsageDistributor(owner.address, true);
    await token.distributeUsageReward(voter1.address, ethers.parseEther('200000'));
    await token.distributeUsageReward(voter2.address, ethers.parseEther('500000'));
    await token.distributeUsageReward(voter3.address, ethers.parseEther('600000'));

    return { token, dao, owner, voter1, voter2, voter3, nonHolder, target };
  }

  describe('Deployment', function () {
    it('should set correct token address', async function () {
      const { token, dao } = await loadFixture(deployFixture);
      expect(await dao.token()).to.equal(await token.getAddress());
    });

    it('should revert with zero token address', async function () {
      const DAO = await ethers.getContractFactory('AgentSwapsDAO');
      await expect(DAO.deploy(ethers.ZeroAddress)).to.be.revertedWith('Zero token');
    });

    it('should start with zero proposals', async function () {
      const { dao } = await loadFixture(deployFixture);
      expect(await dao.proposalCount()).to.equal(0);
    });

    it('should have correct governance constants', async function () {
      const { dao } = await loadFixture(deployFixture);
      expect(await dao.proposalThreshold()).to.equal(ethers.parseEther('100000'));
      expect(await dao.quorumTokens()).to.equal(ethers.parseEther('1000000'));
      expect(await dao.votingDuration()).to.equal(3 * 24 * 60 * 60);
    });
  });

  describe('Proposal Creation', function () {
    it('should create a proposal with sufficient tokens', async function () {
      const { dao, voter1 } = await loadFixture(deployFixture);
      await dao.connect(voter1).createProposal('First Proposal', 'Add liquidity to pool', ethers.ZeroAddress, '0x', 0);
      expect(await dao.proposalCount()).to.equal(1);
    });

    it('should emit ProposalCreated event', async function () {
      const { dao, voter1 } = await loadFixture(deployFixture);
      await expect(dao.connect(voter1).createProposal('Test', 'Description', ethers.ZeroAddress, '0x', 0))
        .to.emit(dao, 'ProposalCreated')
        .withArgs(1, voter1.address, 'Test');
    });

    it('should not allow creation without enough tokens', async function () {
      const { dao, nonHolder } = await loadFixture(deployFixture);
      await expect(
        dao.connect(nonHolder).createProposal('Test', 'Desc', ethers.ZeroAddress, '0x', 0)
      ).to.be.revertedWith('Insufficient $SWAP to propose');
    });

    it('should not allow empty title', async function () {
      const { dao, voter1 } = await loadFixture(deployFixture);
      await expect(dao.connect(voter1).createProposal('', 'Desc', ethers.ZeroAddress, '0x', 0)).to.be.revertedWith(
        'Empty title'
      );
    });

    it('should store proposal data correctly', async function () {
      const { dao, voter1 } = await loadFixture(deployFixture);
      await dao.connect(voter1).createProposal('Upgrade Protocol', 'Deploy v3 contracts', ethers.ZeroAddress, '0x', 0);
      const [proposer, title, description, forVotes, againstVotes, createdAt, state] = await dao.getProposal(1);
      expect(proposer).to.equal(voter1.address);
      expect(title).to.equal('Upgrade Protocol');
      expect(description).to.equal('Deploy v3 contracts');
      expect(forVotes).to.equal(0);
      expect(againstVotes).to.equal(0);
      expect(createdAt).to.be.gt(0);
      expect(state).to.equal(0); // Active
    });
  });

  describe('Voting', function () {
    async function proposalFixture() {
      const fixture = await deployFixture();
      await fixture.dao
        .connect(fixture.voter1)
        .createProposal('Test Proposal', 'Test Description', ethers.ZeroAddress, '0x', 0);
      return fixture;
    }

    it('should allow voting for', async function () {
      const { dao, voter2 } = await loadFixture(proposalFixture);
      await dao.connect(voter2).vote(1, true);
      const [, , , forVotes] = await dao.getProposal(1);
      expect(forVotes).to.equal(ethers.parseEther('500000'));
    });

    it('should allow voting against', async function () {
      const { dao, voter2 } = await loadFixture(proposalFixture);
      await dao.connect(voter2).vote(1, false);
      const [, , , , againstVotes] = await dao.getProposal(1);
      expect(againstVotes).to.equal(ethers.parseEther('500000'));
    });

    it('should distribute governance reward on vote', async function () {
      const { dao, token, voter1 } = await loadFixture(proposalFixture);
      const balBefore = await token.balanceOf(voter1.address);
      await dao.connect(voter1).vote(1, true);
      const balAfter = await token.balanceOf(voter1.address);
      // 100 SWAP governance reward
      expect(balAfter - balBefore).to.equal(ethers.parseEther('100'));
    });

    it('should track governance distributed in token', async function () {
      const { dao, token, voter1, voter2 } = await loadFixture(proposalFixture);
      await dao.connect(voter1).vote(1, true);
      await dao.connect(voter2).vote(1, false);
      // 2 votes x 100 SWAP = 200 SWAP
      expect(await token.governanceDistributed()).to.equal(ethers.parseEther('200'));
    });

    it('should emit Voted event', async function () {
      const { dao, voter2 } = await loadFixture(proposalFixture);
      await expect(dao.connect(voter2).vote(1, true))
        .to.emit(dao, 'Voted')
        .withArgs(1, voter2.address, true, ethers.parseEther('500000'));
    });

    it('should not allow double voting', async function () {
      const { dao, voter2 } = await loadFixture(proposalFixture);
      await dao.connect(voter2).vote(1, true);
      await expect(dao.connect(voter2).vote(1, true)).to.be.revertedWith('Already voted');
    });

    it('should not allow voting without tokens', async function () {
      const { dao, nonHolder } = await loadFixture(proposalFixture);
      await expect(dao.connect(nonHolder).vote(1, true)).to.be.revertedWith('No voting power');
    });

    it('should not allow voting after period ends', async function () {
      const { dao, voter2 } = await loadFixture(proposalFixture);
      await time.increase(3 * 24 * 60 * 60 + 1);
      await expect(dao.connect(voter2).vote(1, true)).to.be.revertedWith('Voting ended');
    });

    it('should not allow voting on cancelled proposal', async function () {
      const { dao, voter1, voter2 } = await loadFixture(proposalFixture);
      await dao.connect(voter1).cancel(1);
      await expect(dao.connect(voter2).vote(1, true)).to.be.revertedWith('Proposal cancelled');
    });
  });

  describe('Proposal States', function () {
    async function proposalFixture() {
      const fixture = await deployFixture();
      await fixture.dao.connect(fixture.voter1).createProposal('Test', 'Desc', ethers.ZeroAddress, '0x', 0);
      return fixture;
    }

    it('should be Active during voting period', async function () {
      const { dao } = await loadFixture(proposalFixture);
      expect(await dao.getState(1)).to.equal(0);
    });

    it('should be Failed if no quorum', async function () {
      const { dao } = await loadFixture(proposalFixture);
      await time.increase(3 * 24 * 60 * 60 + 1);
      expect(await dao.getState(1)).to.equal(2);
    });

    it('should be Failed if more against votes', async function () {
      const { dao, voter2, voter3 } = await loadFixture(proposalFixture);
      await dao.connect(voter2).vote(1, true); // 500K
      await dao.connect(voter3).vote(1, false); // 600K
      await time.increase(3 * 24 * 60 * 60 + 1);
      expect(await dao.getState(1)).to.equal(2);
    });

    it('should be Passed with quorum and majority', async function () {
      const { dao, voter2, voter3 } = await loadFixture(proposalFixture);
      await dao.connect(voter2).vote(1, true); // 500K
      await dao.connect(voter3).vote(1, true); // 600K = 1.1M > quorum
      await time.increase(3 * 24 * 60 * 60 + 1);
      expect(await dao.getState(1)).to.equal(1);
    });

    it('should be Cancelled when cancelled', async function () {
      const { dao, voter1 } = await loadFixture(proposalFixture);
      await dao.connect(voter1).cancel(1);
      expect(await dao.getState(1)).to.equal(4);
    });
  });

  describe('Execution', function () {
    async function passedProposalFixture() {
      const fixture = await deployFixture();
      await fixture.dao.connect(fixture.voter1).createProposal('Test', 'Desc', ethers.ZeroAddress, '0x', 0);
      await fixture.dao.connect(fixture.voter2).vote(1, true);
      await fixture.dao.connect(fixture.voter3).vote(1, true);
      return fixture;
    }

    it('should not execute during voting period', async function () {
      const { dao } = await loadFixture(passedProposalFixture);
      await expect(dao.execute(1)).to.be.revertedWith('Not passed');
    });

    it('should not execute during timelock', async function () {
      const { dao } = await loadFixture(passedProposalFixture);
      await time.increase(3 * 24 * 60 * 60 + 1);
      await expect(dao.execute(1)).to.be.revertedWith('Timelock active');
    });

    it('should execute after voting + timelock', async function () {
      const { dao } = await loadFixture(passedProposalFixture);
      await time.increase(5 * 24 * 60 * 60 + 1);
      await expect(dao.execute(1)).to.emit(dao, 'ProposalExecuted').withArgs(1);
    });

    it('should mark proposal as executed', async function () {
      const { dao } = await loadFixture(passedProposalFixture);
      await time.increase(5 * 24 * 60 * 60 + 1);
      await dao.execute(1);
      const [, , , , , , state] = await dao.getProposal(1);
      expect(state).to.equal(3);
    });
  });

  describe('Cancellation', function () {
    async function proposalFixture() {
      const fixture = await deployFixture();
      await fixture.dao.connect(fixture.voter1).createProposal('Test', 'Desc', ethers.ZeroAddress, '0x', 0);
      return fixture;
    }

    it('should allow proposer to cancel', async function () {
      const { dao, voter1 } = await loadFixture(proposalFixture);
      await expect(dao.connect(voter1).cancel(1)).to.emit(dao, 'ProposalCancelled').withArgs(1);
    });

    it('should not allow non-proposer to cancel', async function () {
      const { dao, voter2 } = await loadFixture(proposalFixture);
      await expect(dao.connect(voter2).cancel(1)).to.be.revertedWith('Not proposer');
    });
  });

  describe('Treasury', function () {
    it('should accept ETH', async function () {
      const { dao, owner } = await loadFixture(deployFixture);
      await owner.sendTransaction({
        to: await dao.getAddress(),
        value: ethers.parseEther('10'),
      });
      expect(await dao.treasuryBalance()).to.equal(ethers.parseEther('10'));
    });
  });
});
