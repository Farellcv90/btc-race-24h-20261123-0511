// cbBTC dip-or-thrust rider for agent-fun/bars-replay/v1.
//
// The harness sends one hello, then one batch per minute carrying the bar that
// just closed, the fills of the previous reply's orders, and the account. This
// bot answers every batch with at most one order: it either opens a full-stake
// long, closes the long it holds, or sends nothing. Orders decided on a bar
// fill at the next bar's open, so every signal below is computed from closes
// only and every fill price is learned from the following batch.
//
// Entry (only while flat, after a post-exit cooldown):
//   - dip leg: the close sits at least DIP_BPS under a slow EMA and a fast EMA
//     has already turned up over the last few bars (buy the washout once it
//     stops falling), or
//   - thrust leg: the trailing one-hour return clears THRUST_BPS while price
//     holds above its hourly EMA (join a move that is already underway).
// Exit (whole position, whichever fires first):
//   take-profit, stop-loss, a trailing stop under the best close since entry,
//   or a maximum holding time. An equity drawdown guard stops new entries
//   long before the race guardrail, and a deeper guard liquidates and halts.
//
// Indicators run in float64 with + - * / only, which is correctly rounded and
// therefore identical on every run; money stays in bigint quote units. No
// clock, no randomness, no files, no network: the same bars always produce
// the same orders.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Indicator spans, in one-minute bars.
const SLOW_SPAN = 360;
const MID_SPAN = 60;
const FAST_SPAN = 12;
const TURN_LOOKBACK = 5;
const THRUST_LOOKBACK = 60;

// Signal thresholds, in basis points of price.
const DIP_BPS = 50;
const THRUST_BPS = 40;
const TAKE_PROFIT_BPS = 400;
const STOP_LOSS_BPS = 120;
const TRAIL_BPS = 160;
const MAX_HOLD_BARS = 720;
const COOLDOWN_BARS = 30;

// Guardrails on equity, in basis points of the running peak.
const ENTRY_HALT_DD_BPS = 1000;
const LIQUIDATE_DD_BPS = 2000;

// Every order tolerates this much adverse move from the decision close; it
// covers the modelled slippage, the pool impact of a full-stake trade, and a
// modest overnight-style gap between close and next open.
const ORDER_SLIPPAGE_BPS = 200;
const BPS_DENOM = 10000;

interface EmaTracker {
  span: number;
  seen: number;
  seedSum: number;
  value: number;
  ready: boolean;
}

function newEma(span: number): EmaTracker {
  return { span, seen: 0, seedSum: 0, value: 0, ready: false };
}

function feedEma(t: EmaTracker, close: number): void {
  if (!t.ready) {
    t.seedSum += close;
    t.seen += 1;
    if (t.seen === t.span) {
      t.value = t.seedSum / t.span;
      t.ready = true;
    }
    return;
  }
  const k = 2 / (t.span + 1);
  t.value = t.value + k * (close - t.value);
}

// Mutable strategy state, advanced once per bar.
const slowEma = newEma(SLOW_SPAN);
const midEma = newEma(MID_SPAN);
const fastEma = newEma(FAST_SPAN);
const closeHistory: number[] = [];
const fastHistory: number[] = [];

let entryPrice = 0;
let entryBar = -1;
let peakClose = 0;
let lastExitBar = -1000000;
let peakEquity = 0n;
let halted = false;

function recordFills(batch: Batch): void {
  // A fill is reported on the batch whose bar it filled at, so batch.seq is
  // the bar index of the fill; fill.fill_bar is not relied on for timing.
  for (const fill of batch.fills) {
    if (fill.status !== 'filled' || fill.symbol !== SYMBOL) continue;
    if (fill.side === 'buy') {
      entryPrice = Number(fill.price);
      entryBar = batch.seq;
      peakClose = entryPrice;
    } else {
      lastExitBar = batch.seq;
      entryPrice = 0;
      entryBar = -1;
      peakClose = 0;
    }
  }
}

function dipSignal(close: number): boolean {
  if (!slowEma.ready || !fastEma.ready) return false;
  const idx = fastHistory.length - 1 - TURN_LOOKBACK;
  if (idx < 0) return false;
  const dipped = close * BPS_DENOM <= slowEma.value * (BPS_DENOM - DIP_BPS);
  const turned = fastEma.value > fastHistory[idx];
  return dipped && turned;
}

function thrustSignal(close: number): boolean {
  if (!midEma.ready) return false;
  const idx = closeHistory.length - 1 - THRUST_LOOKBACK;
  if (idx < 0) return false;
  const base = closeHistory[idx];
  const thrust = close * BPS_DENOM >= base * (BPS_DENOM + THRUST_BPS);
  return thrust && close > midEma.value;
}

function exitSignal(state: BarsState, close: number): boolean {
  if (entryPrice <= 0) return false;
  if (close * BPS_DENOM >= entryPrice * (BPS_DENOM + TAKE_PROFIT_BPS)) return true;
  if (close * BPS_DENOM <= entryPrice * (BPS_DENOM - STOP_LOSS_BPS)) return true;
  if (peakClose > entryPrice && close * BPS_DENOM <= peakClose * (BPS_DENOM - TRAIL_BPS)) return true;
  if (entryBar >= 0 && state.seq - entryBar >= MAX_HOLD_BARS) return true;
  return false;
}

function drawdownBps(state: BarsState): bigint {
  if (peakEquity <= 0n) return 0n;
  if (state.equity >= peakEquity) return 0n;
  return ((peakEquity - state.equity) * BigInt(BPS_DENOM)) / peakEquity;
}

await runBars({
  onHello(state: BarsState): void {
    peakEquity = state.equity;
  },

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    recordFills(batch);

    let close: number | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      close = Number(bar.c);
      feedEma(slowEma, close);
      feedEma(midEma, close);
      feedEma(fastEma, close);
      closeHistory.push(close);
      fastHistory.push(fastEma.ready ? fastEma.value : 0);
      if (close > peakClose) peakClose = close;
    }
    if (close === null) return [];

    if (state.equity > peakEquity) peakEquity = state.equity;
    const dd = drawdownBps(state);
    if (dd >= BigInt(LIQUIDATE_DD_BPS)) halted = true;

    const held = state.positions.get(SYMBOL);

    if (held !== undefined && held.qty > 0n) {
      if (halted || exitSignal(state, close)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: ORDER_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (halted || state.warmingUp) return [];
    if (dd >= BigInt(ENTRY_HALT_DD_BPS)) return [];
    if (state.seq - lastExitBar <= COOLDOWN_BARS) return [];
    if (closeHistory.length <= THRUST_LOOKBACK) return [];

    if (!dipSignal(close) && !thrustSignal(close)) return [];

    const room = state.weightRoom(SYMBOL);
    let spend = state.cash < room ? state.cash : room;
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    if (spend < minNotional) return [];
    if (spend <= 0n) return [];

    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: ORDER_SLIPPAGE_BPS }];
  },
});
