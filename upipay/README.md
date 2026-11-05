# upipay — pay any UPI QR with USDC (testnet MVP)

Payer locks USDC in escrow → an LP pays the merchant in INR via UPI → proof (UTR) releases USDC to the LP. Payer can dispute within the window; the arbiter resolves. LPs stake USDC and are slashed on no-pay or lost disputes.

## Run (local)
    npm install
    DISPUTE_WINDOW=20 npm run dev     # hardhat node + contracts + app on http://localhost:8788
    node app/lp-bot.js                # optional automated LP (mock payout)
    npm test

Wallet: create (12-word phrase) or import (phrase / private key), protected by a password; the encrypted keystore lives in this browser. Unlock on return to see balance and history (read from chain). `/profile` has name, avatar, saved merchants, recovery phrase export, password change. Google/Apple login is not connected (needs Privy/Web3Auth).

Pages: `/` payer, `/profile`, `/lp`, `/arbiter`, `/receipt?id=N`. Chain resets on every restart.

## Base Sepolia
    DEPLOYER_KEY=… BASE_SEPOLIA_RPC=… ATTESTOR_ADDRESS=… ARBITER_ADDRESS=… \
      npx hardhat run scripts/deploy.js --network baseSepolia
    RPC_URL=… ATTESTOR_KEY=… node app/prod.js

## Mock vs real
- **Mock:** UPI payout proof (`app/providers.js` `verifyPayout`) — the attestor signs whatever UTR the LP submits. Real zkTLS / bank attestation is required before real money.
- **Mock:** VPA name lookup (`validateVpa`) — needs a licensed PSP/gateway. QR `pn=` is shown when available.
- Rate: CoinGecko with fallback. No audit, no legal/RBI review. Use dummy UPI ids only.
