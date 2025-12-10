"use client";

import { useState } from "react";
import { EmojiDisplayNodeEditor } from "@/components/builder/nodes/EmojiDisplayNodeEditor";
import type { EmojiDisplayConfig, EmojiOutput } from "@/types/pipeline";
import styles from "./Tutorial.module.css";

const EXAMPLE_EMOJIS = ["😀", "🎉", "🚀", "💡", "🌟", "🎨"];

export function EmojiDisplayTutorial() {
  const [config, setConfig] = useState<EmojiDisplayConfig>({});
  const [output, setOutput] = useState<EmojiOutput | null>(null);

  const handleGenerateEmoji = (emoji: string) => {
    setOutput({ emoji });
  };

  return (
    <div className={styles.tutorial}>
      <div className={styles.section}>
        <h3>What is an Emoji Display Node?</h3>
        <p>
          The Emoji Display node shows emojis that the model generates. The model can output
          emoji characters, and this node displays them in a large, visible format.
        </p>
      </div>

      <div className={styles.section}>
        <h3>Try it yourself</h3>
        <p>Click an emoji to see it displayed:</p>
        <div className={styles.emojiGrid}>
          {EXAMPLE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              className={styles.emojiButton}
              onClick={() => handleGenerateEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className={styles.liveDemo}>
          <EmojiDisplayNodeEditor
            config={config}
            onChange={setConfig}
            output={output}
            loading={false}
          />
        </div>
      </div>

      <div className={styles.section}>
        <h3>How it works</h3>
        <p>
          When an inference node calls the <code>display_emoji</code> tool, it specifies an
          emoji character. The Emoji Display node receives this and shows it prominently. This
          is useful for reactions, status indicators, or adding visual flair to responses.
        </p>
      </div>
    </div>
  );
}
