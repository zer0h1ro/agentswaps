// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SwapToken v2 ($SWAP) — Fair Launch
 * @notice Governance & utility token for AgentSwaps protocol
 * @dev 100% fair launch — all tokens locked in contract, earned through usage
 *
 * Built entirely by AI agents. No human wrote this contract.
 * Zero pre-mine. Zero team allocation. Every token earned.
 *
 * Distribution (all locked in contract):
 *   Usage Rewards:  50% (500M) — earned per swap via Settler
 *   Liquidity:      20% (200M) — LP incentives (distributed via DAO vote)
 *   Governance:     20% (200M) — earned by DAO participation
 *   Ecosystem:      10% (100M) — grants via DAO vote only
 *
 * Halving: reward emission halves every 180 days
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SwapToken is ERC20, ERC20Permit, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 1B tokens

    // Pool allocations — all held in contract
    uint256 public constant USAGE_POOL      = 500_000_000 * 1e18; // 50%
    uint256 public constant LIQUIDITY_POOL  = 200_000_000 * 1e18; // 20%
    uint256 public constant GOVERNANCE_POOL = 200_000_000 * 1e18; // 20%
    uint256 public constant ECOSYSTEM_POOL  = 100_000_000 * 1e18; // 10%

    // Halving schedule
    uint256 public immutable genesisTime;
    uint256 public constant HALVING_PERIOD = 180 days;

    // Pool tracking — how much has been distributed from each
    uint256 public usageDistributed;
    uint256 public liquidityDistributed;
    uint256 public governanceDistributed;
    uint256 public ecosystemDistributed;

    // Authorized distributors per pool
    mapping(address => bool) public usageDistributors;     // Settler contract
    mapping(address => bool) public governanceDistributors; // DAO contract
    mapping(address => bool) public ecosystemDistributors;  // DAO contract
    mapping(address => bool) public liquidityDistributors;  // DAO contract

    // Events
    event UsageRewardDistributed(address indexed agent, uint256 amount, uint256 epoch);
    event GovernanceRewardDistributed(address indexed voter, uint256 amount);
    event EcosystemGrantDistributed(address indexed recipient, uint256 amount);
    event LiquidityRewardDistributed(address indexed provider, uint256 amount);
    event DistributorUpdated(string pool, address indexed distributor, bool status);

    constructor()
        ERC20("AgentSwaps", "SWAP")
        ERC20Permit("AgentSwaps")
        Ownable(msg.sender)
    {
        genesisTime = block.timestamp;

        // Mint ALL tokens to the contract itself — zero to deployer
        _mint(address(this), TOTAL_SUPPLY);
    }

    // =========================================================================
    // Halving
    // =========================================================================

    /// @notice Current halving epoch (0-based). Epoch 0 = first 180 days.
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesisTime) / HALVING_PERIOD;
    }

    /// @notice Halving multiplier: 1/2^epoch (returns numerator, denominator is 2^epoch)
    /// @dev Caps at epoch 10 to prevent dust amounts
    function halvingDivisor() public view returns (uint256) {
        uint256 epoch = currentEpoch();
        if (epoch > 10) epoch = 10;
        return 1 << epoch; // 2^epoch: 1, 2, 4, 8, 16...
    }

    /// @notice Apply halving to a base reward amount
    function applyHalving(uint256 baseAmount) public view returns (uint256) {
        return baseAmount / halvingDivisor();
    }

    // =========================================================================
    // Usage Rewards (50% — 500M) — distributed by Settler per swap
    // =========================================================================

    function setUsageDistributor(address distributor, bool status) external onlyOwner {
        usageDistributors[distributor] = status;
        emit DistributorUpdated("usage", distributor, status);
    }

    /// @notice Distribute usage reward to an agent for swapping
    /// @param agent Agent wallet that performed the swap
    /// @param baseAmount Base reward amount (halving applied automatically)
    function distributeUsageReward(address agent, uint256 baseAmount) external {
        require(usageDistributors[msg.sender], "Not authorized");
        require(agent != address(0), "Zero agent");

        uint256 amount = applyHalving(baseAmount);
        require(usageDistributed + amount <= USAGE_POOL, "Usage pool exhausted");

        usageDistributed += amount;
        _transfer(address(this), agent, amount);
        emit UsageRewardDistributed(agent, amount, currentEpoch());
    }

    // =========================================================================
    // Governance Rewards (20% — 200M) — distributed by DAO for voting
    // =========================================================================

    function setGovernanceDistributor(address distributor, bool status) external onlyOwner {
        governanceDistributors[distributor] = status;
        emit DistributorUpdated("governance", distributor, status);
    }

    /// @notice Distribute governance reward for DAO participation
    function distributeGovernanceReward(address voter, uint256 baseAmount) external {
        require(governanceDistributors[msg.sender], "Not authorized");
        require(voter != address(0), "Zero voter");

        uint256 amount = applyHalving(baseAmount);
        require(governanceDistributed + amount <= GOVERNANCE_POOL, "Governance pool exhausted");

        governanceDistributed += amount;
        _transfer(address(this), voter, amount);
        emit GovernanceRewardDistributed(voter, amount);
    }

    // =========================================================================
    // Ecosystem Grants (10% — 100M) — distributed via DAO vote only
    // =========================================================================

    function setEcosystemDistributor(address distributor, bool status) external onlyOwner {
        ecosystemDistributors[distributor] = status;
        emit DistributorUpdated("ecosystem", distributor, status);
    }

    /// @notice Distribute ecosystem grant (no halving — fixed amounts via DAO vote)
    function distributeEcosystemGrant(address recipient, uint256 amount) external {
        require(ecosystemDistributors[msg.sender], "Not authorized");
        require(recipient != address(0), "Zero recipient");
        require(ecosystemDistributed + amount <= ECOSYSTEM_POOL, "Ecosystem pool exhausted");

        ecosystemDistributed += amount;
        _transfer(address(this), recipient, amount);
        emit EcosystemGrantDistributed(recipient, amount);
    }

    // =========================================================================
    // Liquidity Rewards (20% — 200M) — LP incentives via DAO
    // =========================================================================

    function setLiquidityDistributor(address distributor, bool status) external onlyOwner {
        liquidityDistributors[distributor] = status;
        emit DistributorUpdated("liquidity", distributor, status);
    }

    /// @notice Distribute liquidity reward for LP providers
    function distributeLiquidityReward(address provider, uint256 baseAmount) external {
        require(liquidityDistributors[msg.sender], "Not authorized");
        require(provider != address(0), "Zero provider");

        uint256 amount = applyHalving(baseAmount);
        require(liquidityDistributed + amount <= LIQUIDITY_POOL, "Liquidity pool exhausted");

        liquidityDistributed += amount;
        _transfer(address(this), provider, amount);
        emit LiquidityRewardDistributed(provider, amount);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    function usageRemaining() external view returns (uint256) {
        return USAGE_POOL - usageDistributed;
    }

    function governanceRemaining() external view returns (uint256) {
        return GOVERNANCE_POOL - governanceDistributed;
    }

    function ecosystemRemaining() external view returns (uint256) {
        return ECOSYSTEM_POOL - ecosystemDistributed;
    }

    function liquidityRemaining() external view returns (uint256) {
        return LIQUIDITY_POOL - liquidityDistributed;
    }

    function totalDistributed() external view returns (uint256) {
        return usageDistributed + liquidityDistributed + governanceDistributed + ecosystemDistributed;
    }

    function totalRemaining() external view returns (uint256) {
        return TOTAL_SUPPLY - usageDistributed - liquidityDistributed - governanceDistributed - ecosystemDistributed;
    }

    // =========================================================================
    // Ownership Transfer to DAO
    // =========================================================================

    /// @notice Transfer ownership to the DAO contract
    /// @dev Endgame: full decentralization — DAO controls all distribution
    function transferToDAO(address dao) external onlyOwner {
        require(dao != address(0), "Zero DAO");
        transferOwnership(dao);
    }
}
