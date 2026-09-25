#!/usr/bin/env bash
# Email alerts at 50/90/100% of a monthly budget (default 500 INR). Needs the billing account id.
set -euo pipefail
BILLING="${BILLING_ACCOUNT:?export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX  (gcloud billing accounts list)}"
AMOUNT="${AMOUNT:-500INR}"
gcloud services enable billingbudgets.googleapis.com
gcloud billing budgets create --billing-account="$BILLING" --display-name="FormFill monthly" \
  --budget-amount="$AMOUNT" --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
echo "Budget alert created: $AMOUNT per month (emails go to billing admins)."
