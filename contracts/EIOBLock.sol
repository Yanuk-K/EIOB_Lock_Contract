// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract EIOBLock is ReentrancyGuard {
    constructor() {}

    struct UnlockInfo {
        address payable withdrawalAddress;
        address[] unlockAddresses;
        uint256 lockedAmount;
        uint256 unlockTime;
        bool withdrawn;
    }

    mapping(uint256 => UnlockInfo) public lockedInfo;
    mapping(address => uint256) public balanceInfo;

    uint256 public depositId;
    uint256[] public allDepositIds;

    event EIOBLocked(address indexed withdrawalAddress, uint256 amount, uint256 unlockTime, uint256 depositId);
    event EIOBUnlocked(address indexed withdrawalAddress, uint amount);

    // _unlockTime is time from transaction (in seconds), not the absolute time.
    function Lock(address payable _withdrawalAddress, address _unlockaddresses, uint256 _unlockTime) external payable returns (uint256 _id) {
        require(msg.value > 0, 'You need to have > 0 EIOB locked up');
        require(_unlockTime < 10000000000, 'Unix timestamp must be in seconds, not milliseconds');
        require(_unlockTime > 0, 'Unlock time must be in future');

        balanceInfo[_withdrawalAddress] = balanceInfo[_withdrawalAddress] + msg.value;

        _id = ++depositId;
        lockedInfo[_id].withdrawalAddress = _withdrawalAddress;
        lockedInfo[_id].unlockAddresses = _unlockAddresses;
        lockedInfo[_id].lockedAmount = msg.value;
        lockedInfo[_id].unlockTime = block.timestamp + _unlockTime;
        lockedInfo[_id].withdrawn = false;

        allDepositIds.push(_id);
        
        emit EIOBLocked(_withdrawalAddress, _unlockAddresses, msg.value, lockedInfo[_id].unlockTime, depositId);
    }

    // Does not matter who unlocks since timelock is in place
    // Stop reentrancy attacks
    function Unlock(uint256 _id) external nonReentrant {
        require(block.timestamp >= lockedInfo[_id].unlockTime, 'EIOB is locked');
        require(!lockedInfo[_id].withdrawn, 'EIOB is already withdrawn');
        bool withdraw = false;
        if (lockedInfo[_id].unlockAddresses.length == 0) withdraw = true;
        else {
            for (uint256 i = 0; i < lockedInfo[_id].unlockAddresses.length; i++) {
                if(msg.sender == lockedInfo[_id].unlockAddresses[i]) withdraw = true;
            }
        }
        require(withdraw, "Only authorized accounts can unlock");

        address payable withdrawalAddress = lockedInfo[_id].withdrawalAddress;
        uint256 lockedAmount = lockedInfo[_id].lockedAmount;
        
        lockedInfo[_id].withdrawn = true;
        
        uint256 oldBalance = balanceInfo[withdrawalAddress];
        balanceInfo[withdrawalAddress] = oldBalance - lockedAmount;

        // Send EIOB
        (bool sent, ) = withdrawalAddress.call{value: lockedAmount}("");
        require(sent, "EIOB transfer failed");

        emit EIOBUnlocked(withdrawalAddress, lockedAmount);
    }

    function getDepositDetails(uint256 _id) view public returns (address payable, uint256, uint256, bool)
    {
        return (lockedInfo[_id].withdrawalAddress, lockedInfo[_id].lockedAmount,
        lockedInfo[_id].unlockTime, lockedInfo[_id].withdrawn);
    }

    function getLockedAmountByWithdrawalAddress(address _withdrawalAddress) view public returns (uint256)
    {
        return balanceInfo[_withdrawalAddress];
    }

    function getAllDepositIds() view public returns (uint256[] memory)
    {
        return allDepositIds;
    }
}
