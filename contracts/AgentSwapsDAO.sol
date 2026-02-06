// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentSwapsDAO v2
 * @notice On-chain governance for AgentSwaps protocol
 * @dev Proposal creation, voting, execution — all on-chain
 *      Voters earn $SWAP governance rewards for participating.
 *
 * Built entirely by AI agents. Governed by agents.
 *
 * Governance rules:
 *   - 100K $SWAP to create proposal
 *   - 1M $SWAP quorum to pass
 *   - 3-day voting period
 *   - 2-day timelock before execution
 *   - 1 token = 1 vote (no delegation in v2)
 *   - Voters earn governance rewards from the Governance pool
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISwapTokenGov {
    function distributeGovernanceReward(address voter, uint256 baseAmount) external;
    function distributeEcosystemGrant(address recipient, uint256 amount) external;
}

contract AgentSwapsDAO is ReentrancyGuard {
    IERC20 public immutable swapToken;
    ISwapTokenGov public immutable swapTokenGov;

    // Governance parameters
    uint256 public constant PROPOSAL_THRESHOLD = 100_000 * 1e18;  // 100K $SWAP to propose
    uint256 public constant QUORUM             = 1_000_000 * 1e18; // 1M $SWAP quorum
    uint256 public constant VOTING_PERIOD      = 3 days;
    uint256 public constant TIMELOCK           = 2 days;

    // Governance reward per vote (base amount, halving applied by token)
    uint256 public constant VOTE_REWARD = 100 * 1e18; // 100 SWAP per vote

    enum ProposalState { Active, Passed, Failed, Executed, Cancelled }

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        address target;
        bytes callData;
        uint256 value;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 createdAt;
        uint256 executedAt;
        bool executed;
        bool cancelled;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // Treasury
    receive() external payable {}

    event ProposalCreated(uint256 indexed id, address indexed proposer, string title);
    event Voted(uint256 indexed id, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);

    constructor(address _swapToken) {
        require(_swapToken != address(0), "Zero token");
        swapToken = IERC20(_swapToken);
        swapTokenGov = ISwapTokenGov(_swapToken);
    }

    // --- Proposals ---

    function createProposal(
        string calldata title,
        string calldata description,
        address target,
        bytes calldata callData,
        uint256 value
    ) external returns (uint256) {
        require(
            swapToken.balanceOf(msg.sender) >= PROPOSAL_THRESHOLD,
            "Insufficient $SWAP to propose"
        );
        require(bytes(title).length > 0, "Empty title");

        proposalCount++;
        Proposal storage p = proposals[proposalCount];
        p.id = proposalCount;
        p.proposer = msg.sender;
        p.title = title;
        p.description = description;
        p.target = target;
        p.callData = callData;
        p.value = value;
        p.createdAt = block.timestamp;

        emit ProposalCreated(proposalCount, msg.sender, title);
        return proposalCount;
    }

    // --- Voting (with rewards) ---

    /// @notice Vote on a proposal and earn governance $SWAP rewards
    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.createdAt > 0, "Proposal does not exist");
        require(block.timestamp <= p.createdAt + VOTING_PERIOD, "Voting ended");
        require(!p.cancelled, "Proposal cancelled");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 weight = swapToken.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        // Distribute governance reward for voting
        try swapTokenGov.distributeGovernanceReward(msg.sender, VOTE_REWARD) {} catch {}

        emit Voted(proposalId, msg.sender, support, weight);
    }

    // --- Execution ---

    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(getState(proposalId) == ProposalState.Passed, "Not passed");
        require(
            block.timestamp >= p.createdAt + VOTING_PERIOD + TIMELOCK,
            "Timelock active"
        );

        p.executed = true;
        p.executedAt = block.timestamp;

        if (p.target != address(0)) {
            (bool success, ) = p.target.call{value: p.value}(p.callData);
            require(success, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer, "Not proposer");
        require(!p.executed, "Already executed");
        require(!p.cancelled, "Already cancelled");

        p.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    // --- View Functions ---

    function getState(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        require(p.createdAt > 0, "Does not exist");

        if (p.cancelled) return ProposalState.Cancelled;
        if (p.executed) return ProposalState.Executed;

        if (block.timestamp <= p.createdAt + VOTING_PERIOD) {
            return ProposalState.Active;
        }

        if (p.forVotes > p.againstVotes && p.forVotes >= QUORUM) {
            return ProposalState.Passed;
        }

        return ProposalState.Failed;
    }

    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        string memory title,
        string memory description,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 createdAt,
        ProposalState state
    ) {
        Proposal storage p = proposals[proposalId];
        return (
            p.proposer,
            p.title,
            p.description,
            p.forVotes,
            p.againstVotes,
            p.createdAt,
            getState(proposalId)
        );
    }

    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Quorum tokens needed (for ABI compatibility)
    function quorumTokens() external pure returns (uint256) {
        return QUORUM;
    }

    /// @notice Voting duration in seconds (for ABI compatibility)
    function votingDuration() external pure returns (uint256) {
        return VOTING_PERIOD;
    }

    /// @notice Proposal threshold (for ABI compatibility)
    function proposalThreshold() external pure returns (uint256) {
        return PROPOSAL_THRESHOLD;
    }

    /// @notice Token address (for ABI compatibility)
    function token() external view returns (address) {
        return address(swapToken);
    }
}
