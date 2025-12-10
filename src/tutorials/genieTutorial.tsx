"use client";

import { useState } from "react";
import { GenieNodeEditor } from "@/components/builder/nodes/GenieNodeEditor";
import type { GenieConfig, GenieOutput } from "@/types/pipeline";
import styles from "./Tutorial.module.css";

export function GenieTutorial() {
  const [config, setConfig] = useState<GenieConfig>({
    name: "Bobskin",
    backstory: "You are a helpful genie who grants wishes.",
    model: "claude-sonnet-4-20250514",
    temperature: 0.4,
    autoRespondOnUpdate: false,
  });
  const [conversation, setConversation] = useState<GenieOutput | null>(null);

  return (
    <div className={styles.tutorial}>
      <div className={styles.section}>
        <h3>What is a Genie Node?</h3>
        <p>
          The Genie node creates a self-inferencing agent that can have conversations and update
          its own backstory. Unlike regular inference nodes, genies can think and respond
          autonomously.
        </p>
      </div>

      <div className={styles.section}>
        <h3>Try it yourself</h3>
        <div className={styles.liveDemo}>
          <GenieNodeEditor
            config={config}
            onChange={setConfig}
            conversation={conversation}
            onSelfInference={(message) => {
              // Simulate a response
              setConversation({
                messages: [
                  ...(conversation?.messages || []),
                  { role: "user", content: message },
                  { role: "assistant", content: "I'm a genie! How can I help you?" },
                ],
              });
            }}
            onSaveBackstory={() => {
              alert("Backstory saved!");
            }}
            loading={false}
            hasUpdate={false}
            onClearUpdate={() => {}}
          />
        </div>
      </div>

      <div className={styles.section}>
        <h3>How it works</h3>
        <p>
          Genies are special nodes that can:
        </p>
        <ul className={styles.featureList}>
          <li><strong>Self-inference:</strong> They can think and respond on their own</li>
          <li><strong>Memory:</strong> They maintain conversation history</li>
          <li><strong>Backstory updates:</strong> They can update their own backstory based on interactions</li>
          <li><strong>Autonomous behavior:</strong> They can respond automatically when their backstory is updated</li>
        </ul>
        <p>
          Genies are useful for creating persistent agents, chatbots, or characters that evolve
          over time.
        </p>
      </div>
    </div>
  );
}
