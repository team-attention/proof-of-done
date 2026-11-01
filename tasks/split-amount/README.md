# split-amount

`splitAmount(total, weights)` splits a payout between agents by weight. The bug: leftover units are dropped, so the shares do not add up to the total.

- `total` is a non-negative whole number of yoctoNEAR as a decimal string, e.g. `"1000000000000000000000000"` (1 NEAR). It can be as large as `10^30`.
- `weights` are non-negative whole numbers, at least one of them above zero.
- Share `i` is first `floor(total * weights[i] / sum(weights))`. The units left over are handed out one each, to the shares with the largest fractional remainder first; on a tie, the lower index goes first.
- Returns the shares as decimal strings. They must add up to `total` exactly.
- Throws an `Error` if `weights` is empty, any weight is negative or not a whole number, all weights are zero, or `total` is not a string of digits.

Run the visible tests with `bun test`.
