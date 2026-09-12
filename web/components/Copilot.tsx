"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import "./copilot.css";

export default function Copilot({ children }: { children: React.ReactNode }) {
  return (
    <div className="crew-copilot contents">
      <CopilotKit runtimeUrl="/api/copilotkit">
        <CopilotSidebar
          defaultOpen={false}
          clickOutsideToClose={false}
          labels={{
            title: "Crew copilot",
            initial:
              "I can see the whole board. Try \"what's blocked?\", \"what have we spent?\", or \"answer the blocked task: use the Q3 export from Drive\".",
            placeholder: "Ask about the crew...",
          }}
        >
          {children}
        </CopilotSidebar>
      </CopilotKit>
    </div>
  );
}
