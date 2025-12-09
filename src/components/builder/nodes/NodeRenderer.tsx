"use client";

import type {
  PipelineNodeConfig,
  NodeConfigByType,
  SystemPromptConfig,
  InferenceConfig,
  IconDisplayConfig,
  ColorDisplayConfig,
  GenieConfig,
  TextOutput,
  IconOutput,
  ColorOutput,
  GenieOutput,
} from "@/types/pipeline";
import { SystemPromptNodeEditor } from "./SystemPromptNodeEditor";
import { InferenceNodeEditor } from "./InferenceNodeEditor";
import { IconDisplayNodeEditor } from "./IconDisplayNodeEditor";
import { ColorDisplayNodeEditor } from "./ColorDisplayNodeEditor";
import { GenieNodeEditor } from "./GenieNodeEditor";

interface NodeRendererProps {
  node: PipelineNodeConfig;
  onConfigChange: (nodeId: string, config: NodeConfigByType[keyof NodeConfigByType]) => void;
  userInputValue?: string;
  onUserInputChange?: (nodeId: string, value: string) => void;
  onRunInference?: (nodeId: string) => void;
  isLoading?: boolean;
  output?: unknown;
  // Genie-specific props
  genieConversation?: GenieOutput | null;
  onGenieSelfInference?: (nodeId: string, message: string) => void;
  onGenieSaveBackstory?: (nodeId: string) => void;
  genieHasUpdate?: boolean;
  onGenieClearUpdate?: (nodeId: string) => void;
}

export function NodeRenderer({
  node,
  onConfigChange,
  userInputValue = "",
  onUserInputChange,
  onRunInference,
  isLoading = false,
  output = null,
  genieConversation,
  onGenieSelfInference,
  onGenieSaveBackstory,
  genieHasUpdate,
  onGenieClearUpdate,
}: NodeRendererProps) {
  switch (node.type) {
    case "system_prompt":
      return (
        <SystemPromptNodeEditor
          config={node.config as SystemPromptConfig}
          onChange={(config) => onConfigChange(node.id, config)}
        />
      );

    case "inference":
      return (
        <InferenceNodeEditor
          config={node.config as InferenceConfig}
          onChange={(config) => onConfigChange(node.id, config)}
          userInput={userInputValue}
          onUserInputChange={(value) => onUserInputChange?.(node.id, value)}
          onRun={() => onRunInference?.(node.id)}
          loading={isLoading}
          output={output as TextOutput | null}
        />
      );

    case "icon_display":
      return (
        <IconDisplayNodeEditor
          config={node.config as IconDisplayConfig}
          onChange={(config) => onConfigChange(node.id, config)}
          output={output as IconOutput | null}
          loading={isLoading}
        />
      );

    case "color_display":
      return (
        <ColorDisplayNodeEditor
          config={node.config as ColorDisplayConfig}
          onChange={(config) => onConfigChange(node.id, config)}
          output={output as ColorOutput | null}
          loading={isLoading}
        />
      );

    case "genie":
      return (
        <GenieNodeEditor
          config={node.config as GenieConfig}
          onChange={(config) => onConfigChange(node.id, config)}
          conversation={genieConversation || null}
          onSelfInference={(message) => onGenieSelfInference?.(node.id, message)}
          onSaveBackstory={() => onGenieSaveBackstory?.(node.id)}
          loading={isLoading}
          hasUpdate={genieHasUpdate || false}
          onClearUpdate={() => onGenieClearUpdate?.(node.id)}
        />
      );

    // Placeholder for other node types
    case "gauge_display":
    case "pixel_art_display":
    case "webhook_trigger":
    case "survey":
      return (
        <div style={{ padding: "0.75rem", fontSize: "0.875rem", color: "var(--foreground)", opacity: 0.6 }}>
          {node.type.replace("_", " ")} editor coming soon...
        </div>
      );

    default:
      return null;
  }
}
