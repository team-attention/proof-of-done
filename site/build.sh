#!/bin/sh
# Assemble public/ from site/static.
set -e
cd "$(dirname "$0")"
rm -rf public && mkdir -p public
cp static/* public/
