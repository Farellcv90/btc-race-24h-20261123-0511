# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Farellcv90/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Farellcv90/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A long-only cbBTC rider that opens a full-stake position on either of two signals — a dip at least 0.5% under a 360-bar EMA once a 12-bar EMA has turned up, or a one-hour thrust of at least 0.4% holding above the 60-bar EMA — then exits on a +4% take-profit, a −1.2% stop-loss, a 1.6% trailing stop under the best close since entry, or after 720 bars, with a 30-bar cooldown after each exit and an equity-drawdown guard that halts new entries at −10% and liquidates at −20%; parameters were swept on the dev window and chosen from a broad positive neighbourhood rather than a single peak.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=bbbzard3&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
