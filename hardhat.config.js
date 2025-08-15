require("@nomicfoundation/hardhat-ignition-ethers");
require("dotenv").config();
require("@nomicfoundation/hardhat-chai-matchers");

const endpointUrl = process.env.ENDPOINT_URL;
const privateKey = process.env.PRIVATE_KEY;

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