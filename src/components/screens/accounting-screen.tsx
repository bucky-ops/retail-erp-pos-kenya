"use client";

import { ScreenHeader, Panel, EmptyState } from "@/components/df/shared";

/** Accounting — placeholder, replaced by Task 5-e. */
export default function AccountingScreen() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <ScreenHeader
        title="Accounting"
        subtitle="Chart of accounts, journals, trial balance, P&L and bank recon"
      />
      <Panel>
        <EmptyState title="Accounting is being built" body="The full double-entry ledger will appear here." />
      </Panel>
    </div>
  );
}
