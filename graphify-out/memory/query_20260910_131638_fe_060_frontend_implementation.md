---
type: "implementation"
date: "2026-09-10T13:16:38.881381+00:00"
question: "FE-060 frontend implementation"
contributor: "graphify"
outcome: "useful"
source_nodes: ["CoinPurchaseForm", "useCoinPurchaseSubmit", "CoinPurchaseSummary", "createSecondHandCoinPurchase"]
---

# Q: FE-060 frontend implementation

## Answer

Useful implementation record: added the dedicated consumer coin-purchase route and form. It preserves integer coin count, independent purchase rate, central-bank-only bubble display, stable idempotent retry input, authoritative server receipt, and invalidates coin inventory plus party balances after success. Primary nodes: CoinPurchaseForm, useCoinPurchaseSubmit, CoinPurchaseSummary, createSecondHandCoinPurchase.

## Outcome

- Signal: useful

## Source Nodes

- CoinPurchaseForm
- useCoinPurchaseSubmit
- CoinPurchaseSummary
- createSecondHandCoinPurchase