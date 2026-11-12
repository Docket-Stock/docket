// Site settings. After the token launch put the contract address into tokenAddress.
window.DOCKET_CONFIG = {
  // '' = same origin (the Worker serves both the site and the API)
  api: '',
  // Public Robinhood Chain RPC, used in the browser to read a wallet's balances.
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  tokenAddress: '0x3ddd057339d4a93016e5b57f989100c72d43ad3c',
  links: {
    x: 'https://x.com/docketstock',
    github: 'https://github.com/Docket-Stock/docket',
    pons: 'https://ponsfamily.com/launchpad/0x3ddd057339d4a93016e5b57f989100c72d43ad3c',
  },
  explorer: 'https://robinhoodchain.blockscout.com',
  // Pons v2 launches mint a fixed 1,000,000,000.
  tokenomics: [
    ['Supply', '1,000,000,000'],
    ['Launch', 'Fair launch on Pons'],
    ['Liquidity', 'Locked for good at graduation'],
    ['Team', 'No team mint, no presale'],
  ],
};
