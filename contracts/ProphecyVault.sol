// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProphecyVault {
    address public oracle;
    uint256 public prophecyCount;
    
    struct Prophecy {
        address user;
        string text;
        string prediction;
        uint256 deadline;
        uint256 timestamp;
        bool verified;
        bool correct;
    }
    
    mapping(uint256 => Prophecy) public prophecies;
    mapping(address => uint256) public userAccuracy;
    
    event ProphecyStored(uint256 indexed id, address indexed user);
    event WinnerPaid(address indexed user, uint256 amount);
    
    constructor() {
        oracle = msg.sender;
    }
    
    // CRITICAL: Allows contract to accept MON sacrifices
    receive() external payable {}
    
    function storeProphecy(address user, string memory text, string memory pred, uint256 deadline) 
        public returns (uint256) 
    {
        require(msg.sender == oracle, "Only oracle");
        uint256 id = prophecyCount++;
        prophecies[id] = Prophecy(user, text, pred, deadline, block.timestamp, false, false);
        emit ProphecyStored(id, user);
        return id;
    }
    
    function getAccuracy(address user) public view returns (uint256) {
        return userAccuracy[user];
    }
    
    function verifyProphecy(uint256 id, bool isCorrect) public {
        require(msg.sender == oracle, "Only oracle");
        require(!prophecies[id].verified, "Already verified");
        
        prophecies[id].verified = true;
        prophecies[id].correct = isCorrect;
        
        if (isCorrect) {
            userAccuracy[prophecies[id].user] += 10;
        }
    }
    
    function payWinner(address payable winner, uint256 amount) public {
        require(msg.sender == oracle, "Only oracle");
        require(address(this).balance >= amount, "Insufficient balance");
        winner.transfer(amount);
        emit WinnerPaid(winner, amount);
    }
    
    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
