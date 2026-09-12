'use client';
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotSidebar } from '@copilotkit/react-ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <CopilotSidebar
        defaultOpen={false}
        clickOutsideToClose={false}
        labels={{
          title: 'Crew copilot',
          initial:
            "I can see every task on this board. Try: \"what's blocked?\", \"which worker is busiest?\", or \"summarise what shipped today\".",
        }}
      >
        {children}
      </CopilotSidebar>
    </CopilotKit>
  );
}
