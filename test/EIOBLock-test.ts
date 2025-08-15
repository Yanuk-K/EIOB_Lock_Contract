import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("EIOBLock", function () {
  const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
  const LOCK_AMOUNT = hre.ethers.parseEther("1"); // 1 ether (you can change the value)

  let lockContract: any;
  let owner: any;
  let userA: any;
  let userB: any;

  /** Deploy a fresh contract before each test */
  beforeEach(async function () {
    [owner, userA, userB] = await hre.ethers.getSigners();

    // Deploy the EIOBLock contract (no constructor args)
    lockContract = await hre.ethers.deployContract("EIOBLock", [], {});

    // Make sure we start with a clean state
    expect(await lockContract.depositId()).to.equal(0n);
  });

  /** Helper: lock funds for a given withdrawal address */
  async function lockFunds(
    withdrawer: any,
    unlockTime: number,
    amount: bigint = LOCK_AMOUNT
  ) {
    const tx = await lockContract.connect(owner).Lock(withdrawer.address, unlockTime, {
      value: amount,
    });
    const receipt = await tx.wait();
    const event = receipt?.logs?.find((l) => l.topics[0] === hre.ethers.id("EIOBLocked(address,uint256,uint256,uint256)"));
    const depositId = await lockContract.depositId();

    return { receipt, event, depositId };
  }

  it("should lock funds and emit EIOBLocked", async function () {
    const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;

    // Lock 1 ether for userA
    const tx = await lockContract.connect(owner).Lock(userA.address, unlockTime, { value: LOCK_AMOUNT });
    const receipt = await tx.wait();

    // ---- Event check --------------------------------------------------------
    const ev = receipt?.logs?.find((l) => l.topics[0] === hre.ethers.id("EIOBLocked(address,uint256,uint256,uint256)"));
    expect(ev).to.not.be.undefined;
    const decoded = lockContract.interface.decodeEventLog(
      "EIOBLocked",
      ev!.data,
      ev!.topics
    );
    expect(decoded.withdrawalAddress).to.equal(userA.address);
    expect(decoded.amount).to.equal(LOCK_AMOUNT);
    expect(decoded.unlockTime).to.equal(BigInt(unlockTime));

    // ---- State checks --------------------------------------------------------
    const depositId = await lockContract.depositId();
    expect(depositId).to.equal(BigInt(1)); // first deposit

    const info = await lockContract.getDepositDetails(depositId);
    // info: (address payable, uint256, uint256, bool)
    expect(info[0]).to.equal(userA.address);
    expect(info[1]).to.equal(LOCK_AMOUNT);
    expect(info[2]).to.equal(BigInt(unlockTime));
    expect(info[3]).to.be.false; // not withdrawn

    const bal = await lockContract.getLockedAmountByWithdrawalAddress(userA.address);
    expect(bal).to.equal(LOCK_AMOUNT);

    const allIds = await lockContract.getAllDepositIds();
    expect(allIds.map((n: any) => n)).to.deep.equal([BigInt(1)]);
  });

  it("should revert when unlocking before unlockTime", async function () {
    const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;
    const { depositId } = await lockFunds(userA, unlockTime);

    // Try to unlock right away – should revert with "EIOB is locked"
    await expect(lockContract.connect(owner).Unlock(depositId)).to.be.revertedWith("EIOB is locked");
  });

  it("should allow unlocking after the timelock and transfer funds", async function () {
    const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;
    const { depositId } = await lockFunds(userA, unlockTime);

    // Fast‑forward time past the unlock timestamp
    await time.increaseTo(unlockTime + 1);

    const beforeBal = await hre.ethers.provider.getBalance(userA.address);

    // Unlock – should succeed and emit EIOBUnlocked
    const tx = await lockContract.connect(owner).Unlock(depositId);
    const receipt = await tx.wait();

    const ev = receipt?.logs?.find((l) => l.topics[0] === hre.ethers.id("EIOBUnlocked(address,uint256)"));
    expect(ev).to.not.be.undefined;
    const decoded = lockContract.interface.decodeEventLog(
      "EIOBUnlocked",
      ev!.data,
      ev!.topics
    );
    expect(decoded.withdrawalAddress).to.equal(userA.address);
    expect(decoded.amount).to.equal(LOCK_AMOUNT);

    // Balance of userA should have increased by exactly LOCK_AMOUNT (minus gas)
    const afterBal = await hre.ethers.provider.getBalance(userA.address);
    expect(Number(afterBal - beforeBal)).to.be.closeTo(Number(LOCK_AMOUNT), Number(hre.ethers.parseEther("0.001"))); // tiny tolerance for gas

    // State updates
    const info = await lockContract.getDepositDetails(depositId);
    expect(info[3]).to.be.true; // withdrawn flag

    const balInfo = await lockContract.getLockedAmountByWithdrawalAddress(userA.address);
    expect(balInfo).to.equal(BigInt(0));
  });

  it("should correctly handle multiple deposits for the same address", async function () {
    const unlockTime1 = (await time.latest()) + ONE_YEAR_IN_SECS;
    const unlockTime2 = unlockTime1 + ONE_YEAR_IN_SECS;

    // First deposit
    await lockContract.connect(owner).Lock(userB.address, unlockTime1, { value: LOCK_AMOUNT });
    // Second deposit (different amount)
    const secondAmount = hre.ethers.parseEther("0.5");
    await lockContract.connect(owner).Lock(userB.address, unlockTime2, { value: secondAmount });

    expect(await lockContract.depositId()).to.equal(BigInt(2));

    // The aggregate balance for userB should be the sum of both deposits
    const totalLocked = await lockContract.getLockedAmountByWithdrawalAddress(userB.address);
    expect(totalLocked).to.equal(LOCK_AMOUNT + secondAmount);

    // All deposit IDs returned in order
    const allIds = await lockContract.getAllDepositIds();
    expect(allIds.map((n: any) => Number(n))).to.deep.equal([1, 2]);
  });

  it("should revert if trying to unlock an already withdrawn deposit", async function () {
    const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;
    const { depositId } = await lockFunds(userA, unlockTime);

    // Move forward and perform the first successful unlock
    await time.increaseTo(unlockTime + 1);
    await lockContract.connect(owner).Unlock(depositId);

    // Second attempt should revert with "EIOB is already withdrawn"
    await expect(lockContract.connect(owner).Unlock(depositId)).to.be.revertedWith('EIOB is already withdrawn');
  });
});