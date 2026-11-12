// Site settings. After the token launch put the contract address into tokenAddress.
window.DOCKET_CONFIG = {
  // '' = same origin (the Worker serves both the site and the API)
  api: '',
  // Public Robinhood Chain RPC, used in the browser to read a wallet's balances.
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  tokenAddress: '',
  links: {
    x: 'https://x.com/docketstock',
    github: 'https://github.com/Docket-Stock/docket',
    // built from tokenAddress when left empty
    pons: '',
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
