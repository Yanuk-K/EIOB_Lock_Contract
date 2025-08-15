# EIOB Lock smart contract for EIOB Mainnet.

Locks EIOB until set time(in seconds) from current block. Anyone can unlock since EIOB will only get sent to the recipient set during lockup.

Needs manual unlocking by calling **Unlock(_id)**. Using Lambda functions to automatically unlock also works.

### To set up:

```git clone [this repository] && cd EIOB_Lock_Contract && npm install```

### To test:

```npx hardhat test test/EIOBLock-test.ts```

### To deploy (setup env first):

```npx hardhat ignition deploy .ignition/modules/EIOBLockModule.js --network eiob```

### To verify contract:

```npx hardhat verify --network eiob [contract address]```