#!/bin/sh
# Build the arena wasm into contracts/out/. Rust embeds source paths in panic locations;
# the home directory prefix is replaced with a same-length placeholder so offsets stay valid.
set -e
cd "$(dirname "$0")/arena"
cargo near build non-reproducible-wasm --locked
python3 - "$HOME/" target/near/arena.wasm ../out/arena.wasm <<'PY'
import sys
home, src, dst = sys.argv[1].encode(), sys.argv[2], sys.argv[3]
data = open(src, "rb").read()
placeholder = (b"/build/" + b"_" * len(home))[: len(home) - 1] + b"/"
open(dst, "wb").write(data.replace(home, placeholder))
PY
echo "wrote contracts/out/arena.wasm"
