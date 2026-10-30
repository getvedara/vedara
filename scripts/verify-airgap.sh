#!/usr/bin/env bash
set -euo pipefail

# Vedara Zero-Telemetry CI Verification Wrapper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Running Vedara Zero-Telemetry Air-Gap Verification..."
node "${SCRIPT_DIR}/verify-airgap.mjs"
