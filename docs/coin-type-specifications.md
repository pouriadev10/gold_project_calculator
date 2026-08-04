# Coin type specifications

Coin inventory is always stored as an integer count in an independent ledger
dimension, such as `coin:BAHAR_AZADI_NEW`. It is never normalized to gold
weight in ledger storage.

`coin_type_versions.gross_weight_ug` is separate reference data used only for
intrinsic-value calculations and reporting. It is a PostgreSQL `bigint` in
exact micrograms so official half-milligram coin specifications are retained
without decimal or floating-point values.

Initial central-bank coin specifications are:

| Code | Gross weight (`gross_weight_ug`) | Karat |
| --- | ---: | ---: |
| `BAHAR_AZADI_NEW` | `8133000` | `900` |
| `NIM_BAHAR_AZADI` | `4066500` | `900` |
| `ROB_BAHAR_AZADI` | `2033200` | `900` |
| `GERAMI` | `1016600` | `900` |

Intrinsic value retains the exact rational intermediate value:

```text
pureWeightUg = grossWeightUg × karat ÷ 1000
intrinsicRial = roundHalfUp(grossWeightUg × karat × gramRate1000, 1_000_000_000)
```

Only the final rial amount is rounded through `packages/core-calc/src/rounding.ts`.
The bubble calculation accepts only a central-bank-minted coin type at the type
level; a non-bank coin has no bubble-calculation path.
