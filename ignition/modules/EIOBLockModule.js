const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("EIOBLock", (m) => {
  const eioblock = m.contract("EIOBLock");

  return { eioblock };
});