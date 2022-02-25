# Leading system

## Contracts:

### Tokens
- MAGIC token with total supply = 1,681,688 MAGIC
- SPELL token with total supply = 8,888,888,888 SPELL

### Vault
- Vault.sol contract
- VaultConfig.sol contract

## Prerequisite
- npm install --save-dev hardhat @nomiclabs/hardhat-waffle ethereum-waffle chai @nomiclabs/hardhat-ethers ethers

## Deployment
- npx hardhat run scripts/deploy/token.js --network ropsten
- npx hardhat run scripts/deploy/vault.js --network ropsten
- npx hardhat run scripts/deploy/vaultConfig.js --network ropsten
- npx hardhat run scripts/deploy/clerk.js --network ropsten
