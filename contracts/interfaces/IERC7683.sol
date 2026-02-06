// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ERC-7683: Cross Chain Intents Standard
 * @notice Interfaces for cross-chain intent-based trading
 * @dev Proposed by Uniswap Labs + Across Protocol
 *
 * AgentSwaps implements ERC-7683 for standardized cross-chain
 * agent-to-agent swaps. Any filler network can settle our intents.
 */

// --- Data Structures ---

struct GaslessCrossChainOrder {
    address originSettler;
    address user;
    uint256 nonce;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes32 orderDataType;
    bytes orderData;
}

struct OnchainCrossChainOrder {
    uint32 fillDeadline;
    bytes32 orderDataType;
    bytes orderData;
}

struct ResolvedCrossChainOrder {
    address user;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes32 orderId;
    Output[] maxSpent;
    Output[] minReceived;
    FillInstruction[] fillInstructions;
}

struct Output {
    bytes32 token;
    uint256 amount;
    bytes32 recipient;
    uint256 chainId;
}

struct FillInstruction {
    uint256 destinationChainId;
    bytes32 destinationSettler;
    bytes originData;
}

// --- Interfaces ---

interface IOriginSettler {
    event Open(bytes32 indexed orderId, ResolvedCrossChainOrder resolvedOrder);

    function openFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata signature,
        bytes calldata originFillerData
    ) external;

    function open(OnchainCrossChainOrder calldata order) external;

    function resolveFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata originFillerData
    ) external view returns (ResolvedCrossChainOrder memory);

    function resolve(
        OnchainCrossChainOrder calldata order
    ) external view returns (ResolvedCrossChainOrder memory);
}

interface IDestinationSettler {
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata fillerData
    ) external;
}
