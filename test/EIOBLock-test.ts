import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("EIOBLock (authorised unlock addresses)", function () {
  // -------------------------------------------------------------------------
  // Constants & helpers (all via `hre`)
  // -------------------------------------------------------------------------
  const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
  const LOCK_AMOUNT = hre.ethers.parseEther("1");  // 1 ETH

  let owner: any;
  let withdrawer: any;   // address that will receive the funds
  let authA: any;        // authorised unlocker A
  let authB: any;        // authorised unlocker B
  let stranger: any;     // not in whitelist
  let lock: any;         // EIOBLock instance

  /** Deploy a fresh contract before each test */
  beforeEach(async function () {
    [owner, withdrawer, authA, authB, stranger] = await hre.ethers.getSigners();

    lock = await hre.ethers.deployContract("EIOBLock");
    await lock.waitForDeployment();

    expect(await lock.depositId()).to.equal(0);
  });

  /** Helper – create a lock and return the deposit id + start timestamp */
  async function createLock(
    withdrawal: any,
    unlockAddrs: any[],          // array of addresses that may call Unlock
    relUnlockTime: number,       // seconds *from now* (contract adds block.timestamp)
    amount = LOCK_AMOUNT
  ) {
    const tx = await lock
      .connect(owner)
      .Lock(withdrawal.address, unlockAddrs.map((a) => a.address), relUnlockTime, {
        value: amount,
      });
    await tx.wait();
    const startTs = (await hre.ethers.provider.getBlock('latest'))?.timestamp; // timestamp just before the tx
    const depId = await lock.depositId(); // incremented after the call
    return { depositId: depId, startTs };
  }

  it("locks funds, emits EIOBLocked and allows anyone to unlock when no authorised list", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId, startTs } = await createLock(withdrawer, [], relUnlock);

    // event check (empty whitelist)
    await expect(
      lock.connect(owner).Lock(withdrawer.address, [], relUnlock, { value: LOCK_AMOUNT })
    )
      .to.emit(lock, "EIOBLocked")
      .withArgs(
        withdrawer.address,
        [],                     // empty array
        LOCK_AMOUNT,
        startTs + relUnlock + 1,   // absolute unlock time stored in contract
        depositId + BigInt(1)          // because we just emitted a *new* lock in this expect()
      );

    const [wAddr, lockedAmt, absUnlock, withdrawn] =
      await lock.getDepositDetails(depositId);
    expect(wAddr).to.equal(withdrawer.address);
    expect(lockedAmt).to.equal(LOCK_AMOUNT);
    expect(absUnlock).to.equal(startTs + relUnlock);
    expect(withdrawn).to.be.false;
  });

  it("only authorised addresses can unlock when whitelist is non‑empty", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId, startTs } = await createLock(withdrawer, [authA], relUnlock);

    await time.increaseTo(startTs + relUnlock + 1);

    // unauthorised address → revert
    await expect(lock.connect(stranger).Unlock(depositId))
      .to.be.revertedWith("Only authorized accounts can unlock");

    // authorised address succeeds
    await expect(lock.connect(authA).Unlock(depositId))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);

    const [, , , withdrawn] = await lock.getDepositDetails(depositId);
    expect(withdrawn).to.be.true;
  });

  it("anyone can unlock after timelock when no whitelist is set", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId, startTs } = await createLock(withdrawer, [], relUnlock);

    await time.increaseTo(startTs + relUnlock + 1);
    // stranger (not the withdrawal address) unlocks successfully
    await expect(lock.connect(stranger).Unlock(depositId))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);
  });

  it("reverts when trying to unlock a deposit that has already been withdrawn", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId, startTs } = await createLock(withdrawer, [], relUnlock);

    await time.increaseTo(startTs + relUnlock + 1);
    await lock.connect(stranger).Unlock(depositId); // first withdraw

    await expect(lock.connect(stranger).Unlock(depositId))
      .to.be.revertedWith("EIOB is already withdrawn");
  });

  it("handles several deposits for one withdrawal address correctly", async function () {
    const now = await time.latest();

    // first deposit – empty whitelist
    await createLock(withdrawer, [], ONE_YEAR_IN_SECS);
    // second deposit – also empty whitelist but different amount
    const half = hre.ethers.parseEther("0.5");
    const tx2 = await lock
      .connect(owner)
      .Lock(withdrawer.address, [], ONE_YEAR_IN_SECS * 2, { value: half });
    await tx2.wait();

    expect(await lock.depositId()).to.equal(2);

    const total = await lock.getLockedAmountByWithdrawalAddress(withdrawer.address);
    expect(total).to.equal(LOCK_AMOUNT + half);

    const ids = await lock.getAllDepositIds();
    expect(ids.map((x: any) => Number(x))).to.deep.equal([1, 2]);
  });

  it("any of several authorised addresses can unlock once the timelock expires", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId: id1, startTs: ts1 } = await createLock(
      withdrawer,
      [authA, authB],               // two accounts in whitelist
      relUnlock
    );

    await time.increaseTo(ts1 + relUnlock + 1);

    // authA can unlock
    await expect(lock.connect(authA).Unlock(id1))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);

    const [, , , withdrawn1] = await lock.getDepositDetails(id1);
    expect(withdrawn1).to.be.true;

    const { depositId: id2, startTs: ts2 } = await createLock(
      withdrawer,
      [authA, authB],               // two accounts in whitelist
      relUnlock
    );

    await time.increaseTo(ts2 + relUnlock + 1);

    // authA can unlock
    await expect(lock.connect(authB).Unlock(id2))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);

    const [, , , withdrawn2] = await lock.getDepositDetails(id2);
    expect(withdrawn2).to.be.true;
  });

  it("a second authorised address cannot unlock the same deposit after it has been withdrawn", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId, startTs } = await createLock(
      withdrawer,
      [authA, authB],
      relUnlock
    );

    await time.increaseTo(startTs + relUnlock + 1);

    // First authorised address performs the withdrawal
    await lock.connect(authA).Unlock(depositId);

    // Second authorised address now attempts – should revert with “already withdrawn”
    await expect(lock.connect(authB).Unlock(depositId))
      .to.be.revertedWith("EIOB is already withdrawn");
  });

  it("addresses NOT in the whitelist cannot unlock even after timelock", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    const { depositId, startTs } = await createLock(
      withdrawer,
      [authA],        // only authA is allowed
      relUnlock
    );

    await time.increaseTo(startTs + relUnlock + 1);

    // stranger (not in whitelist) → revert
    await expect(lock.connect(stranger).Unlock(depositId))
      .to.be.revertedWith("Only authorized accounts can unlock");
  });

  it("the withdrawal address itself may be placed in the whitelist and can unlock", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    // Put the *withdrawal* address into the whitelist
    const { depositId, startTs } = await createLock(
      withdrawer,
      [withdrawer],   // whitelist contains only the withdrawal address
      relUnlock
    );

    await time.increaseTo(startTs + relUnlock + 1);

    // The withdrawal address calls Unlock – should succeed
    await expect(lock.connect(withdrawer).Unlock(depositId))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);
  });

  it("duplicate entries in whitelist do not affect authorisation logic", async function () {
    const relUnlock = ONE_YEAR_IN_SECS;
    // Duplicate authA twice
    const { depositId, startTs } = await createLock(
      withdrawer,
      [authA, authA],
      relUnlock
    );

    await time.increaseTo(startTs + relUnlock + 1);

    // Any of the duplicates (i.e., authA) can unlock – still works
    await expect(lock.connect(authA).Unlock(depositId))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);
  });

  it("multiple deposits with distinct whitelists each respect their own authorisation", async function () {
    // Deposit 1 – whitelist: authA
    const relUnlock1 = ONE_YEAR_IN_SECS;
    const { depositId: id1, startTs: ts1 } = await createLock(
      withdrawer,
      [authA],
      relUnlock1
    );

    // Deposit 2 – whitelist: authB
    const relUnlock2 = ONE_YEAR_IN_SECS * 2;
    const { depositId: id2, startTs: ts2 } = await createLock(
      withdrawer,
      [authB],
      relUnlock2
    );

    // Fast‑forward to after the first lock but **before** the second one expires
    await time.increaseTo(ts1 + relUnlock1 + 1);

    // authB cannot unlock deposit 1
    await expect(lock.connect(authB).Unlock(id1))
      .to.be.revertedWith("Only authorized accounts can unlock");
    
    // authA can unlock deposit 1
    await expect(lock.connect(authA).Unlock(id1))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);

    // authB should still be blocked for deposit 2 because its timelock isn’t reached yet
    await expect(lock.connect(authB).Unlock(id2))
      .to.be.revertedWith("EIOB is locked");

    // Move forward beyond the second lock and ensure only authB can unlock it now
    await time.increaseTo(ts2 + relUnlock2 + 1);

    // authA cannot unlock deposit 2
    await expect(lock.connect(authA).Unlock(id2))
      .to.be.revertedWith("Only authorized accounts can unlock");

    // authB can unlock deposit 2
    await expect(lock.connect(authB).Unlock(id2))
      .to.emit(lock, "EIOBUnlocked")
      .withArgs(withdrawer.address, LOCK_AMOUNT);
  });
});