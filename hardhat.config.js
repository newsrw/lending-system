require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-etherscan');

const { alchemyApiKey, ropstenPrivateKey } = require('./secrets.json');

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.2",
  networks: {
    ropsten: {
      url: `https://eth-ropsten.alchemyapi.io/v2/${alchemyApiKey}`,
      accounts: [ropstenPrivateKey]
    }
  },
  etherscan: {
    apiKey: "36PCFGPSWWFSZDQ3S3M4WRNP19HP9RBWIC"
  }
};
