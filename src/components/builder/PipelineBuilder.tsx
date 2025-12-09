"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type {
  PipelineNodeConfig,
  NodeType,
  NodeConfigByType,
  TextOutput,
  IconOutput,
  ColorOutput,
  GaugeOutput,
  GenieConfig,
  GenieOutput,
  InferenceConfig,
  SystemPromptConfig,
} from "@/types/pipeline";
import { getToolsForDownstreamNodes } from "@/lib/tools";
import { generateBlockMetadata, parseBlockOutput } from "@/lib/blockParsers";
import { ModulePalette, MODULE_DEFINITIONS } from "./ModulePalette";
import { PipelineCanvas } from "./PipelineCanvas";
import styles from "./PipelineBuilder.module.css";

// Output types union
type OutputData = TextOutput | IconOutput | ColorOutput | GaugeOutput | null;

// Generate unique IDs
let nodeIdCounter = 0;
function generateNodeId(): string {
  return `node-${++nodeIdCounter}-${Date.now()}`;
}

// Default configs for each node type
function getDefaultConfig(type: NodeType): NodeConfigByType[NodeType] {
  switch (type) {
    case "system_prompt":
      return { prompt: "You are a helpful assistant." };
    case "user_input":
      return { placeholder: "Enter your message..." };
    case "inference":
      return { model: "claude-sonnet-4-20250514", temperature: 0.7 };
    case "text_display":
      return { label: "Response" };
    case "color_display":
      return { showHex: true };
    case "icon_display":
      return { size: "md" };
    case "gauge_display":
      return { style: "bar", showValue: true };
    case "pixel_art_display":
      return { pixelSize: 24 };
    case "webhook_trigger":
      return { showResponse: true };
    case "survey":
      return { style: "buttons" };
    case "genie":
      return {
        name: "genie",
        backstory: "You are a helpful genie.",
        model: "claude-sonnet-4-20250514",
        temperature: 0.7,
        autoRespondOnUpdate: false,
      };
    default:
      return {} as NodeConfigByType[NodeType];
  }
}

interface DragData {
  type: NodeType;
  fromPalette?: boolean;
}

export function PipelineBuilder() {
  const [nodes, setNodes] = useState<PipelineNodeConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<NodeType | null>(null);

  // State for user inputs (keyed by node id)
  const [userInputs, setUserInputs] = useState<Record<string, string>>({});

  // State for outputs (keyed by node id)
  const [outputs, setOutputs] = useState<Record<string, OutputData>>({});

  // Loading state for inference
  const [loadingNodeId, setLoadingNodeId] = useState<string | null>(null);

  // Genie-specific state
  const [genieConversations, setGenieConversations] = useState<Record<string, GenieOutput>>({});
  const [genieBackstoryUpdates, setGenieBackstoryUpdates] = useState<Record<string, boolean>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);

    const data = active.data.current as DragData | undefined;
    if (data?.type) {
      setActiveType(data.type);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);
    setActiveType(null);

    if (!over) return;

    const activeData = active.data.current as DragData | undefined;

    // Dragging from palette - add new node
    if (activeData?.fromPalette && activeData.type) {
      const newNode: PipelineNodeConfig = {
        id: generateNodeId(),
        type: activeData.type,
        config: getDefaultConfig(activeData.type),
      };

      // Find insertion index
      if (over.id === "pipeline-canvas") {
        // Dropped on canvas - add to end
        setNodes((prev) => [...prev, newNode]);
      } else {
        // Dropped on existing node - insert before it
        setNodes((prev) => {
          const overIndex = prev.findIndex((n) => n.id === over.id);
          if (overIndex === -1) return [...prev, newNode];
          return [
            ...prev.slice(0, overIndex),
            newNode,
            ...prev.slice(overIndex),
          ];
        });
      }
      return;
    }

    // Reordering existing nodes
    if (active.id !== over.id) {
      setNodes((prev) => {
        const oldIndex = prev.findIndex((n) => n.id === active.id);
        const newIndex = prev.findIndex((n) => n.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  const handleRemoveNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    // Clean up associated state
    setUserInputs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOutputs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Clean up genie state
    setGenieConversations((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setGenieBackstoryUpdates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleConfigChange = useCallback(
    (nodeId: string, config: NodeConfigByType[keyof NodeConfigByType]) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, config } : n))
      );
    },
    []
  );

  const handleUserInputChange = useCallback((nodeId: string, value: string) => {
    setUserInputs((prev) => ({ ...prev, [nodeId]: value }));
  }, []);

  // Format genie conversation as context string
  const formatGenieContext = useCallback((genieName: string, backstory: string, messages: GenieOutput["messages"]): string => {
    let context = `\n\nGenie Context (name: ${genieName}):\n[Backstory: ${backstory}]\n\nConversation:\n`;
    for (const msg of messages) {
      if (msg.role === "user") {
        context += `User: ${msg.content}\n`;
      } else {
        context += `${genieName}: ${msg.content}\n`;
      }
    }
    return context;
  }, []);

  // Build system prompt from preceding nodes (shared logic)
  const buildSystemPromptFromPrecedingNodes = useCallback(
    (
      nodeIndex: number,
      additionalPrompt?: string,
      includeGenieConversations: boolean = true
    ): string => {
      const precedingNodes = nodes.slice(0, nodeIndex);

      // Find system prompt from preceding nodes
      const systemPromptNode = precedingNodes.find((n) => n.type === "system_prompt");
      let systemPrompt = systemPromptNode
        ? (systemPromptNode.config as SystemPromptConfig).prompt
        : "";

      // Add additional prompt if provided
      if (additionalPrompt) {
        if (systemPrompt) {
          systemPrompt += "\n\n";
        }
        systemPrompt += additionalPrompt;
      }

      // Add context from preceding genie nodes
      if (includeGenieConversations) {
        for (const node of precedingNodes) {
          if (node.type === "genie") {
            const genieConfig = node.config as GenieConfig;
            const conversation = genieConversations[node.id];
            if (conversation && conversation.messages.length > 0) {
              const genieContext = formatGenieContext(
                genieConfig.name,
                genieConfig.backstory,
                conversation.messages
              );
              systemPrompt += genieContext;
            }
          } else {
            // Add block metadata for other node types
            const metadata = generateBlockMetadata(node.type, node.config, node.id);
            if (metadata) {
              systemPrompt += metadata;
            }
          }
        }
      }

      return systemPrompt;
    },
    [nodes, genieConversations, formatGenieContext]
  );

  // Handle genie self-inference (independent from main pipeline)
  const handleGenieSelfInference = useCallback(
    async (nodeId: string, userMessage: string) => {
      const genieNode = nodes.find((n) => n.id === nodeId);
      if (!genieNode || genieNode.type !== "genie") return;

      const genieNodeIndex = nodes.findIndex((n) => n.id === nodeId);
      const genieConfig = genieNode.config as GenieConfig;
      const conversation = genieConversations[nodeId] || { messages: [] };

      // Build genie's own identity prompt
      let genieIdentityPrompt = `You are ${genieConfig.name}. Act as ${genieConfig.name} would act. ${genieConfig.backstory}`;

      // Add this genie's own conversation history if it exists
      if (conversation.messages.length > 0) {
        genieIdentityPrompt += "\n\nYour previous conversation:\n";
        for (const msg of conversation.messages) {
          if (msg.role === "user") {
            genieIdentityPrompt += `User: ${msg.content}\n`;
          } else {
            genieIdentityPrompt += `${genieConfig.name}: ${msg.content}\n`;
          }
        }
      }

      // Build system prompt from preceding nodes + genie identity
      const systemPrompt = buildSystemPromptFromPrecedingNodes(
        genieNodeIndex,
        genieIdentityPrompt,
        true // Include other genie conversations
      );

      setLoadingNodeId(nodeId);

      try {
        const response = await fetch("/api/inference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt,
            userMessage,
            model: genieConfig.model,
            temperature: genieConfig.temperature,
          }),
        });

        const data = await response.json();

        if (data.error) {
          console.error("Genie inference error:", data.error);
          return;
        }

        // Update conversation with user message and assistant response
        const updatedMessages = [
          ...conversation.messages,
          { role: "user" as const, content: userMessage },
          { role: "assistant" as const, content: data.response },
        ];

        setGenieConversations((prev) => ({
          ...prev,
          [nodeId]: {
            messages: updatedMessages,
          },
        }));
      } catch (error) {
        console.error("Failed to run genie inference:", error);
      } finally {
        setLoadingNodeId(null);
      }
    },
    [nodes, genieConversations, buildSystemPromptFromPrecedingNodes]
  );

  // Process genie backstory updates from inference response
  const processGenieBackstoryUpdates = useCallback(
    (precedingNodes: PipelineNodeConfig[], response: any) => {
      for (const node of precedingNodes) {
        if (node.type === "genie") {
          const update = parseBlockOutput<{ backstory?: string; shouldAutoRespond?: boolean }>(
            "genie",
            response,
            node.id
          );
          if (update?.backstory) {
            // Update genie config
            const genieConfig = node.config as GenieConfig;
            setNodes((prev) =>
              prev.map((n) =>
                n.id === node.id
                  ? { ...n, config: { ...genieConfig, backstory: update.backstory! } }
                  : n
              )
            );
            // Show notification
            setGenieBackstoryUpdates((prev) => ({ ...prev, [node.id]: true }));
            // Auto-respond if enabled
            if (update.shouldAutoRespond && genieConfig.autoRespondOnUpdate) {
              setTimeout(() => {
                handleGenieSelfInference(node.id, "Your backstory has been updated. Say something new.");
              }, 500);
            }
          }
        }
      }
    },
    [handleGenieSelfInference]
  );

  // Handle saving genie backstory (triggers initial response)
  const handleGenieSaveBackstory = useCallback(
    async (nodeId: string) => {
      const genieNode = nodes.find((n) => n.id === nodeId);
      if (!genieNode || genieNode.type !== "genie") return;

      const genieNodeIndex = nodes.findIndex((n) => n.id === nodeId);
      const genieConfig = genieNode.config as GenieConfig;

      // Build genie's identity prompt with introduction request
      const genieIdentityPrompt = `You are ${genieConfig.name}. Act as ${genieConfig.name} would act. ${genieConfig.backstory}. Introduce yourself.`;

      // Build system prompt from preceding nodes + genie identity
      const systemPrompt = buildSystemPromptFromPrecedingNodes(
        genieNodeIndex,
        genieIdentityPrompt,
        true // Include other genie conversations
      );

      setLoadingNodeId(nodeId);

      try {
        const response = await fetch("/api/inference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt,
            userMessage: "Introduce yourself.",
            model: genieConfig.model,
            temperature: genieConfig.temperature,
          }),
        });

        const data = await response.json();

        if (data.error) {
          console.error("Genie introduction error:", data.error);
          return;
        }

        // Initialize conversation with introduction
        setGenieConversations((prev) => ({
          ...prev,
          [nodeId]: {
            messages: [
              { role: "user", content: "Introduce yourself." },
              { role: "assistant", content: data.response },
            ],
          },
        }));
      } catch (error) {
        console.error("Failed to get genie introduction:", error);
      } finally {
        setLoadingNodeId(null);
      }
    },
    [nodes, genieConversations, buildSystemPromptFromPrecedingNodes]
  );

  // Handle clearing update notification
  const handleGenieClearUpdate = useCallback((nodeId: string) => {
    setGenieBackstoryUpdates((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  const handleRunInference = useCallback(
    async (inferenceNodeId: string) => {
      const nodeIndex = nodes.findIndex((n) => n.id === inferenceNodeId);
      if (nodeIndex === -1) return;

      const inferenceNode = nodes[nodeIndex];
      const inferenceConfig = inferenceNode.config as InferenceConfig;

      // Get user input from the inference node itself
      const userMessage = userInputs[inferenceNodeId] || "";
      if (!userMessage.trim()) {
        console.error("No user input provided");
        return;
      }

      // Gather context from preceding nodes
      const precedingNodes = nodes.slice(0, nodeIndex);

      // Get tools for preceding output nodes
      const { tools, nodeIdByToolName } = getToolsForDownstreamNodes(nodes, nodeIndex);

      // Build system prompt from preceding nodes (includes genie conversations and block metadata)
      const systemPrompt = buildSystemPromptFromPrecedingNodes(
        nodeIndex,
        undefined, // No additional prompt needed
        true // Include genie conversations
      ) || "You are a helpful assistant.";

      setLoadingNodeId(inferenceNodeId);

      try {
        const response = await fetch("/api/inference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt,
            userMessage,
            model: inferenceConfig.model,
            temperature: inferenceConfig.temperature,
            tools: tools.length > 0 ? tools : undefined,
          }),
        });

        const data = await response.json();

        if (data.error) {
          console.error("Inference error:", data.error);
          return;
        }

        // Store text response in the inference node itself
        if (data.response) {
          setOutputs((prev) => ({
            ...prev,
            [inferenceNodeId]: { content: data.response } as TextOutput,
          }));
        }

        // Route tool call results to their target output nodes
        if (data.toolCalls && data.toolCalls.length > 0) {
          const newOutputs: Record<string, OutputData> = {};

          for (const toolCall of data.toolCalls) {
            const targetNodeId = nodeIdByToolName[toolCall.toolName];
            if (targetNodeId) {
              // Store the tool call input as the output for the target node
              newOutputs[targetNodeId] = toolCall.input as OutputData;
            }
          }

          if (Object.keys(newOutputs).length > 0) {
            setOutputs((prev) => ({ ...prev, ...newOutputs }));
          }
        }

        // Process genie backstory updates
        processGenieBackstoryUpdates(precedingNodes, data);
      } catch (error) {
        console.error("Failed to run inference:", error);
      } finally {
        setLoadingNodeId(null);
      }
    },
    [nodes, userInputs, buildSystemPromptFromPrecedingNodes, processGenieBackstoryUpdates]
  );

  // Find module info for drag overlay
  const activeModule = activeType
    ? MODULE_DEFINITIONS.find((m) => m.type === activeType)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={styles.builder}>
        <PipelineCanvas
          nodes={nodes}
          onRemoveNode={handleRemoveNode}
          onConfigChange={handleConfigChange}
          userInputs={userInputs}
          onUserInputChange={handleUserInputChange}
          onRunInference={handleRunInference}
          loadingNodeId={loadingNodeId}
          outputs={outputs}
          activeNodeId={activeId}
          genieConversations={genieConversations}
          onGenieSelfInference={handleGenieSelfInference}
          onGenieSaveBackstory={handleGenieSaveBackstory}
          genieBackstoryUpdates={genieBackstoryUpdates}
          onGenieClearUpdate={handleGenieClearUpdate}
        />
        <ModulePalette />
      </div>

      <DragOverlay>
        {activeModule && (
          <div
            className={styles.dragOverlay}
            style={{
              "--module-color": activeModule.color,
            } as React.CSSProperties}
          >
            <div className={styles.dragOverlayIcon}>
              <activeModule.icon size={18} />
            </div>
            <span>{activeModule.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
