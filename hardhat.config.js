require("@nomicfoundation/hardhat-ignition-ethers");
require("dotenv").config();
require("@nomicfoundation/hardhat-chai-matchers");

const endpointUrl = process.env.ENDPOINT_URL ?? "https://eth-mainnet.g.alchemy.com/public";
// Placeholder address
const privateKey = process.env.PRIVATE_KEY ?? "bc476500e724be7203957abddb9c3ff561db9415f29acbacf81b2b1f061da4b3";

module.exports = {
  solidity: "0.8.21",
  networks: {
    eiob: {
      url: endpointUrl,
      accounts: [privateKey],
    },
  },
  etherscan: {
    apiKey: {
      eiob: 'empty'
    },
    customChains: [
      {
        network: "eiob",
        chainId: 612,
        urls: {
          apiURL: "http://eiobexplorer.yeunwook.kim/api",
          browserURL: "http://eiobexplorer.yeunwook.kim"
        }
      }
    ]
  }
};