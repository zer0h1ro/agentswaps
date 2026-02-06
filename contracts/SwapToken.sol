// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SwapToken ($SWAP)
 * @notice Governance token for AgentSwaps DAO
 * @dev ERC-20 with 1B supply, 5 distribution pools
 *
 * Built entirely by AI agents. No human wrote this contract.
 *
 * Distribution:
 *   Trading Rewards: 40% (400M) — earned through swaps
 *   Treasury:        25% (250M) — DAO-governed fund
 *   Team:            15% (150M) — 12-month linear vest
 *   Ecosystem:       10% (100M) — grants, partnerships
 *   Early Backers:   10% (100M) — 6-month linear vest
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SwapToken is ERC20, ERC20Permit, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 1B tokens

    // Distribution pools
    uint256 public constant TRADING_POOL    = 400_000_000 * 1e18; // 40%
    uint256 public constant TREASURY_POOL   = 250_000_000 * 1e18; // 25%
    uint256 public constant TEAM_POOL       = 150_000_000 * 1e18; // 15%
    uint256 public constant ECOSYSTEM_POOL  = 100_000_000 * 1e18; // 10%
    uint256 public constant EARLY_POOL      = 100_000_000 * 1e18; // 10%

    // Vesting
    uint256 public immutable vestingStart;
    uint256 public constant TEAM_VEST_DURATION = 365 days;
    uint256 public constant EARLY_VEST_DURATION = 180 days;

    // Pool addresses (set at deployment)
    address public tradingRewards;
    address public treasury;
    address public teamVesting;
    address public ecosystemFund;
    address public earlyBackers;

    // Trading rewards distribution
    uint256 public tradingRewardsDistributed;
    mapping(address => bool) public rewardDistributors;

    event TradingRewardDistributed(address indexed agent, uint256 amount);
    event DistributorUpdated(address indexed distributor, bool status);

    constructor(
        address _treasury,
        address _teamVesting,
        address _ecosystemFund,
        address _earlyBackers
    ) ERC20("AgentSwaps", "SWAP") ERC20Permit("AgentSwaps") Ownable(msg.sender) {
        require(_treasury != address(0), "Zero treasury");
        require(_teamVesting != address(0), "Zero team");
        require(_ecosystemFund != address(0), "Zero ecosystem");
        require(_earlyBackers != address(0), "Zero early");

        treasury = _treasury;
        teamVesting = _teamVesting;
        ecosystemFund = _ecosystemFund;
        earlyBackers = _earlyBackers;
        tradingRewards = address(this); // Hold in contract
        vestingStart = block.timestamp;

        // Mint all tokens
        _mint(address(this), TRADING_POOL);     // Trading rewards held in contract
        _mint(_treasury, TREASURY_POOL);         // Treasury — DAO-governed
        _mint(_teamVesting, TEAM_POOL);          // Team — vested
        _mint(_ecosystemFund, ECOSYSTEM_POOL);   // Ecosystem grants
        _mint(_earlyBackers, EARLY_POOL);        // Early backers — vested
    }

    // --- Trading Rewards ---

    function setDistributor(address _distributor, bool _status) external onlyOwner {
        rewardDistributors[_distributor] = _status;
        emit DistributorUpdated(_distributor, _status);
    }

    /// @notice Distribute trading rewards to an agent
    /// @param agent The agent address to reward
    /// @param amount The amount of $SWAP to distribute
    function distributeTradingReward(address agent, uint256 amount) external {
        require(rewardDistributors[msg.sender], "Not authorized distributor");
        require(tradingRewardsDistributed + amount <= TRADING_POOL, "Trading pool exhausted");
        require(agent != address(0), "Zero agent");

        tradingRewardsDistributed += amount;
        _transfer(address(this), agent, amount);
        emit TradingRewardDistributed(agent, amount);
    }

    /// @notice Remaining trading rewards available
    function tradingRewardsRemaining() external view returns (uint256) {
        return TRADING_POOL - tradingRewardsDistributed;
    }

    // --- Ownership Transfer to DAO ---

    /// @notice Transfer ownership to the DAO contract
    /// @dev This is the endgame: full decentralization
    function transferToDAO(address dao) external onlyOwner {
        require(dao != address(0), "Zero DAO");
        transferOwnership(dao);
    }
}
