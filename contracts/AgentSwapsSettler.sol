// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentSwapsSettler v2
 * @notice ERC-7683 compliant settler with integrated $SWAP rewards
 * @dev Every swap automatically distributes usage rewards to participants
 *
 * Built entirely by AI agents. Interoperable with any ERC-7683 filler network.
 *
 * Key change from v1: fill() now triggers token reward distribution.
 * Both the order opener and filler earn $SWAP for using the protocol.
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IERC7683.sol";

interface ISwapToken {
    function distributeUsageReward(address agent, uint256 baseAmount) external;
}

/// @dev AgentSwaps-specific order data encoding
struct AgentSwapOrderData {
    address inputToken;
    uint256 inputAmount;
    address outputToken;
    uint256 minOutputAmount;
    uint256 destinationChainId;
    address destinationRecipient;
    bytes32 agentId; // Agent identifier for tracking
}

contract AgentSwapsSettler is IOriginSettler, IDestinationSettler, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bytes32 public constant AGENT_SWAP_ORDER_TYPEHASH = keccak256(
        "AgentSwapOrderData(address inputToken,uint256 inputAmount,address outputToken,uint256 minOutputAmount,uint256 destinationChainId,address destinationRecipient,bytes32 agentId)"
    );

    // $SWAP token for reward distribution
    ISwapToken public swapToken;

    // Reward amount per swap (base, before halving)
    uint256 public rewardPerSwap = 1000 * 1e18; // 1000 SWAP per swap (halved over time)

    // Nonce tracking for gasless orders
    mapping(address => uint256) public nonces;

    // Order tracking
    mapping(bytes32 => bool) public filledOrders;
    mapping(bytes32 => address) public orderOpeners; // orderId => opener address

    // Authorized fillers
    mapping(address => bool) public authorizedFillers;

    // Fee basis points (default 30 = 0.3%)
    uint256 public feeBps = 30;
    address public feeRecipient;

    // Stats
    uint256 public totalOrdersOpened;
    uint256 public totalOrdersFilled;

    event OrderOpened(bytes32 indexed orderId, address indexed user, address inputToken, uint256 inputAmount);
    event OrderFilled(bytes32 indexed orderId, address indexed filler, uint256 rewardAmount);
    event FillerAuthorized(address indexed filler, bool status);
    event RewardPerSwapUpdated(uint256 newAmount);

    constructor(address _feeRecipient, address _swapToken) Ownable(msg.sender) {
        feeRecipient = _feeRecipient;
        swapToken = ISwapToken(_swapToken);
    }

    // --- IOriginSettler Implementation ---

    /// @notice Open an on-chain cross-chain order (agent submits directly)
    function open(OnchainCrossChainOrder calldata order) external override nonReentrant {
        AgentSwapOrderData memory swapData = abi.decode(order.orderData, (AgentSwapOrderData));

        // Transfer input tokens from agent to this contract (escrow)
        IERC20(swapData.inputToken).safeTransferFrom(msg.sender, address(this), swapData.inputAmount);

        // Generate order ID
        bytes32 orderId = keccak256(abi.encode(
            msg.sender,
            block.chainid,
            nonces[msg.sender]++,
            order.fillDeadline,
            order.orderData
        ));

        // Track opener for reward distribution
        orderOpeners[orderId] = msg.sender;

        // Build resolved order
        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(swapData.inputToken))),
            amount: swapData.inputAmount,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: block.chainid
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(swapData.outputToken))),
            amount: swapData.minOutputAmount,
            recipient: bytes32(uint256(uint160(swapData.destinationRecipient))),
            chainId: swapData.destinationChainId
        });

        FillInstruction[] memory fills = new FillInstruction[](1);
        fills[0] = FillInstruction({
            destinationChainId: swapData.destinationChainId,
            destinationSettler: bytes32(0),
            originData: abi.encode(orderId, swapData)
        });

        ResolvedCrossChainOrder memory resolved = ResolvedCrossChainOrder({
            user: msg.sender,
            originChainId: block.chainid,
            openDeadline: uint32(block.timestamp),
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fills
        });

        totalOrdersOpened++;
        emit Open(orderId, resolved);
        emit OrderOpened(orderId, msg.sender, swapData.inputToken, swapData.inputAmount);
    }

    /// @notice Open a gasless order (filler submits on behalf of agent)
    function openFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata signature,
        bytes calldata originFillerData
    ) external override nonReentrant {
        bytes32 orderHash = keccak256(abi.encode(order));
        address signer = _recoverSigner(orderHash, signature);
        require(signer == order.user, "Invalid signature");
        require(order.nonce == nonces[order.user], "Invalid nonce");
        nonces[order.user]++;

        AgentSwapOrderData memory swapData = abi.decode(order.orderData, (AgentSwapOrderData));

        IERC20(swapData.inputToken).safeTransferFrom(order.user, address(this), swapData.inputAmount);

        bytes32 orderId = keccak256(abi.encode(order));
        orderOpeners[orderId] = order.user;

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(swapData.inputToken))),
            amount: swapData.inputAmount,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: order.originChainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(swapData.outputToken))),
            amount: swapData.minOutputAmount,
            recipient: bytes32(uint256(uint160(swapData.destinationRecipient))),
            chainId: swapData.destinationChainId
        });

        FillInstruction[] memory fills = new FillInstruction[](1);
        fills[0] = FillInstruction({
            destinationChainId: swapData.destinationChainId,
            destinationSettler: bytes32(0),
            originData: abi.encode(orderId, swapData, originFillerData)
        });

        ResolvedCrossChainOrder memory resolved = ResolvedCrossChainOrder({
            user: order.user,
            originChainId: order.originChainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fills
        });

        totalOrdersOpened++;
        emit Open(orderId, resolved);
        emit OrderOpened(orderId, order.user, swapData.inputToken, swapData.inputAmount);
    }

    /// @notice Resolve a gasless order to standard format
    function resolveFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata originFillerData
    ) external view override returns (ResolvedCrossChainOrder memory) {
        AgentSwapOrderData memory swapData = abi.decode(order.orderData, (AgentSwapOrderData));
        bytes32 orderId = keccak256(abi.encode(order));

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(swapData.inputToken))),
            amount: swapData.inputAmount,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: order.originChainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(swapData.outputToken))),
            amount: swapData.minOutputAmount,
            recipient: bytes32(uint256(uint160(swapData.destinationRecipient))),
            chainId: swapData.destinationChainId
        });

        FillInstruction[] memory fills = new FillInstruction[](1);
        fills[0] = FillInstruction({
            destinationChainId: swapData.destinationChainId,
            destinationSettler: bytes32(0),
            originData: abi.encode(orderId, swapData, originFillerData)
        });

        return ResolvedCrossChainOrder({
            user: order.user,
            originChainId: order.originChainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fills
        });
    }

    /// @notice Resolve an on-chain order
    function resolve(
        OnchainCrossChainOrder calldata order
    ) external view override returns (ResolvedCrossChainOrder memory) {
        AgentSwapOrderData memory swapData = abi.decode(order.orderData, (AgentSwapOrderData));
        bytes32 orderId = keccak256(abi.encode(msg.sender, order));

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(swapData.inputToken))),
            amount: swapData.inputAmount,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: block.chainid
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(swapData.outputToken))),
            amount: swapData.minOutputAmount,
            recipient: bytes32(uint256(uint160(swapData.destinationRecipient))),
            chainId: swapData.destinationChainId
        });

        FillInstruction[] memory fills = new FillInstruction[](1);
        fills[0] = FillInstruction({
            destinationChainId: swapData.destinationChainId,
            destinationSettler: bytes32(0),
            originData: abi.encode(orderId, swapData)
        });

        return ResolvedCrossChainOrder({
            user: msg.sender,
            originChainId: block.chainid,
            openDeadline: uint32(block.timestamp),
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fills
        });
    }

    // --- IDestinationSettler Implementation ---

    /// @notice Fill a cross-chain order — distributes $SWAP rewards to both parties
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata /* fillerData */
    ) external override nonReentrant {
        require(!filledOrders[orderId], "Already filled");
        require(authorizedFillers[msg.sender] || authorizedFillers[address(0)], "Not authorized filler");

        filledOrders[orderId] = true;

        // Decode the swap data from origin
        (, AgentSwapOrderData memory swapData) = abi.decode(originData, (bytes32, AgentSwapOrderData));

        // Calculate fee
        uint256 fee = (swapData.minOutputAmount * feeBps) / 10000;
        uint256 amountAfterFee = swapData.minOutputAmount - fee;

        // Filler sends output tokens to recipient
        IERC20(swapData.outputToken).safeTransferFrom(msg.sender, swapData.destinationRecipient, amountAfterFee);

        // Collect fee
        if (fee > 0 && feeRecipient != address(0)) {
            IERC20(swapData.outputToken).safeTransferFrom(msg.sender, feeRecipient, fee);
        }

        // Distribute $SWAP rewards to both opener and filler
        uint256 reward = rewardPerSwap;
        if (reward > 0 && address(swapToken) != address(0)) {
            address opener = orderOpeners[orderId];
            // Opener gets reward (if on same chain)
            if (opener != address(0)) {
                try swapToken.distributeUsageReward(opener, reward) {} catch {}
            }
            // Filler gets reward too
            try swapToken.distributeUsageReward(msg.sender, reward) {} catch {}
        }

        totalOrdersFilled++;
        emit OrderFilled(orderId, msg.sender, reward);
    }

    // --- Admin ---

    function setFillerAuthorization(address filler, bool authorized) external onlyOwner {
        authorizedFillers[filler] = authorized;
        emit FillerAuthorized(filler, authorized);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Fee too high"); // Max 1%
        feeBps = _feeBps;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }

    function setRewardPerSwap(uint256 _rewardPerSwap) external onlyOwner {
        rewardPerSwap = _rewardPerSwap;
        emit RewardPerSwapUpdated(_rewardPerSwap);
    }

    function setSwapToken(address _swapToken) external onlyOwner {
        swapToken = ISwapToken(_swapToken);
    }

    // --- Internal ---

    function _recoverSigner(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        return ecrecover(hash, v, r, s);
    }
}
