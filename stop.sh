#!/usr/bin/env bash
# ============================================================
# stop.sh — Tear down the log-analyzer-ai-alerting to save money
# Usage: bash stop.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$SCRIPT_DIR/infra/terraform"

echo ""
echo "========================================"
echo "  Stopping log-analyzer-ai-alerting"
echo "  (All AWS resources will be deleted)"
echo "========================================"
echo ""

cd "$TERRAFORM_DIR"
terraform destroy -auto-approve

echo ""
echo "========================================"
echo "  ✅ All resources destroyed."
echo "  No more AWS charges for this project."
echo "  Run 'bash start.sh' to bring it back."
echo "========================================"
