"use client";

import { ScreenHeader, Panel, EmptyState } from "@/components/df/shared";

/** Day Closing Workflow — placeholder, replaced by Task 5-d. */
export default function DayCloseScreen() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <ScreenHeader
        title="Day Closing"
        subtitle="Count the till, check variance, freeze the Z report"
      />
      <Panel>
        <EmptyState title="Day Close is being built" body="The 4-step closing workflow will appear here." />
      </Panel>
    </div>
  );
}
