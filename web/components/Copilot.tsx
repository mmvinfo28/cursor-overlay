"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function Copilot({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <CopilotSidebar
        defaultOpen={false}
        clickOutsideToClose={false}
        labels={{
          title: "Crew copilot",
          initial: "I can see the whole board. Ask me what's blocked, what shipped, or what the crew has spent.",
        }}
      >
        {children}
      </CopilotSidebar>
    </CopilotKit>
  );
}
