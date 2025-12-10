"use client";

import { useState, useCallback } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { PipelineNodeConfig, InferenceConfig, TextOutput, GenieOutput, GenieConfig } from "@/types/pipeline";
import { getToolsForDownstreamNodes, isGenieMessageTool } from "@/lib/tools";
import { usePipelineDragDrop } from "@/hooks/usePipelineDragDrop";
import { useGenieState } from "@/hooks/useGenieState";
import { useURLLoader } from "@/hooks/useURLLoader";
import { buildSystemPrompt } from "@/services/inference/promptBuilder";
import { routeToolCalls } from "@/services/inference/toolRouter";
import { runInference } from "@/services/inference/api";
import { usePipelineStore } from "@/store/pipelineStore";
import { getGenieConversation, getGenieBackstoryUpdate } from "@/hooks/useGenieState";
import { parseBlockOutput } from "@/lib/blockParsers";
import type { GenieUpdate } from "@/components/builder/nodes/GenieNodeEditor";
import { ModulePalette, MODULE_DEFINITIONS, SYSTEM_PROMPT_MODULE } from "./ModulePalette";
import { PipelineCanvas } from "./PipelineCanvas";
import { ContextInspector } from "./ContextInspector";
import styles from "./PipelineBuilder.module.css";

export function PipelineBuilder() {
  // Use Zustand store
  const store = usePipelineStore();
  const genie = useGenieState();
  const urlLoader = useURLLoader();

  const dragDrop = usePipelineDragDrop({
    nodes: store.nodes,
    onAddNode: store.addNode,
    onReorderNodes: store.reorderNodes,
  });

  // Context inspector state
  const [inspectorState, setInspectorState] = useState<{
    isOpen: boolean;
    targetNodeId: string | null;
  }>({ isOpen: false, targetNodeId: null });
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  const toggleInspector = useCallback((nodeId: string) => {
    setInspectorState((prev) => {
      // If inspector is open for this node, close it
      if (prev.isOpen && prev.targetNodeId === nodeId) {
        setHighlightedNodeId(null);
        return { isOpen: false, targetNodeId: null };
      }
      // Otherwise open it for this node
      return { isOpen: true, targetNodeId: nodeId };
    });
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorState({ isOpen: false, targetNodeId: null });
    setHighlightedNodeId(null);
  }, []);

  // Wrapper for buildSystemPrompt that uses current state
  const buildSystemPromptWrapper = useCallback(
    (nodeIndex: number, additionalPrompt?: string, includeGenies: boolean = true): string => {
      const precedingNodes = store.nodes.slice(0, nodeIndex);

      // Get genie conversations
      const genieConvos: Record<string, GenieOutput> = {};
      precedingNodes.forEach((node) => {
        if (node.type === "genie") {
          const conv = getGenieConversation(store, node.id);
          if (conv) genieConvos[node.id] = conv;
        }
      });

      return buildSystemPrompt(
        store.systemPromptConfig.prompt,
        precedingNodes,
        genieConvos,
        urlLoader.urlContexts,
        store.userInputs,
        { additionalPrompt, includeGenieConversations: includeGenies }
      );
    },
    [store, urlLoader.urlContexts]
  );

  // Main inference handler
  const handleRunInference = useCallback(
    async (inferenceNodeId: string) => {
      // Build the full node list including fixed system prompt
      const fullNodes: PipelineNodeConfig[] = [
        {
          id: "system-prompt-fixed",
          type: "system_prompt",
          config: store.systemPromptConfig,
        },
        ...store.nodes,
      ];

      const nodeIndex = fullNodes.findIndex((n) => n.id === inferenceNodeId);
      if (nodeIndex === -1) return;

      const inferenceNode = fullNodes[nodeIndex];
      const inferenceConfig = inferenceNode.config as InferenceConfig;

      // Get user input from the inference node itself
      let userMessage = store.userInputs[inferenceNodeId] || "";
      if (!userMessage.trim()) {
        console.error("No user input provided");
        return;
      }

      // Get preceding nodes for context
      const precedingNodes = fullNodes.slice(0, nodeIndex);

      // Get tools for preceding output nodes (use fullNodes with correct index)
      const { tools, nodeIdByToolName } = getToolsForDownstreamNodes(fullNodes, nodeIndex);

      // Filter out genie update tools (but keep genie message tools - LLM needs them to send messages to genies)
      // Put genie message tools FIRST to prioritize them
      const nonGenieTools = tools.filter(
        (tool) => !tool.name.startsWith("update_genie_") && !isGenieMessageTool(tool.name)
      );
      const genieMessageTools = tools.filter(
        (tool) => isGenieMessageTool(tool.name)
      );
      const filteredTools = [...genieMessageTools, ...nonGenieTools];

      // If genie tools are available and user mentions genie, add a reminder to the user message
      const genieToolNamesForUser = filteredTools.filter(t => isGenieMessageTool(t.name)).map(t => t.name);
      if (genieToolNamesForUser.length > 0 && (userMessage.toLowerCase().includes('genie') || userMessage.toLowerCase().includes('bobskin') || userMessage.toLowerCase().includes('send') || userMessage.toLowerCase().includes('message'))) {
        userMessage += `\n\nRemember: If you want to send a message to a genie, you MUST call the ${genieToolNamesForUser.join(" or ")} tool. Do not just say you will send a message - actually call the tool.`;
      }

      // Get genie conversations
      const genieConvos: Record<string, GenieOutput> = {};
      precedingNodes.forEach((node) => {
        if (node.type === "genie") {
          const conv = getGenieConversation(store, node.id);
          if (conv) genieConvos[node.id] = conv;
        }
      });

      // Build system prompt from preceding nodes
      let systemPrompt =
        buildSystemPrompt(
          store.systemPromptConfig.prompt,
          precedingNodes,
          genieConvos,
          urlLoader.urlContexts,
          store.userInputs,
          { includeGenieConversations: true }
        ) || "You are a helpful assistant.";

      // Add explicit instruction about using tools if genie tools are available
      const genieToolNames = filteredTools.filter(t => isGenieMessageTool(t.name)).map(t => t.name);
      if (genieToolNames.length > 0) {
        systemPrompt += `\n\n${"#".repeat(60)}
# MANDATORY TOOL USAGE INSTRUCTIONS
${"#".repeat(60)}

You MUST call the ${genieToolNames.join(", ")} tool(s) to send messages to genies.

CRITICAL RULES:
1. If you mention sending a message to a genie, you MUST call the tool
2. Saying "I'll send a message" without calling the tool is a FAILURE
3. You MUST call ALL relevant tools, not just one
4. The genie message tool is the HIGHEST PRIORITY tool

WHEN RESPONDING:
- Call ${genieToolNames[0]} tool FIRST before any other tools
- Include your message to the genie in the "message" parameter
- THEN call other tools like display_color or display_icon

DO NOT skip the genie tool. DO NOT just use other tools without also using the genie tool.
${"#".repeat(60)}`;
      }

      store.setLoadingNodeId(inferenceNodeId);

      try {
        const result = await runInference({
          systemPrompt,
          userMessage,
          model: inferenceConfig.model,
          temperature: inferenceConfig.temperature,
          tools: filteredTools.length > 0 ? filteredTools : undefined,
        });

        if (result.error) {
          console.error("Inference error:", result.error);
          return;
        }

        // Store text response in the inference node itself
        if (result.response) {
          store.setOutput(inferenceNodeId, { content: result.response } as TextOutput);
        }

        // Process genie updates from tool calls (handles both backstory updates AND messages)
        // This will call addSystemMessage for genie message tools, which triggers selfInference
        genie.processBackstoryUpdates(precedingNodes, result, nodeIdByToolName);

        // Also check for legacy backstory updates using parseBlockOutput
        const inferenceResponse = {
          response: result.response || "",
          toolCalls: result.toolCalls || [],
          error: result.error,
        };

        for (const node of precedingNodes) {
          if (node.type === "genie") {
            const genieUpdate = parseBlockOutput<GenieUpdate>("genie", inferenceResponse, node.id);
            if (genieUpdate?.backstory) {
              // Handle backstory update (legacy support)
              const genieConfig = node.config as GenieConfig;
              store.setNodes((prev) =>
                prev.map((n) =>
                  n.id === node.id
                    ? { ...n, config: { ...genieConfig, backstory: genieUpdate.backstory! } }
                    : n
                )
              );
              genie.processBackstoryUpdates([node], result, nodeIdByToolName);
            }
          }
        }

        // Route tool call results to their target output nodes (excluding genie updates and genie messages)
        if (result.toolCalls && result.toolCalls.length > 0) {
          // Filter out genie update tool calls and genie message tool calls
          const nonGenieToolCalls = result.toolCalls.filter(
            (tc) => !tc.toolName.startsWith("update_genie_") && !isGenieMessageTool(tc.toolName)
          );

          if (nonGenieToolCalls.length > 0) {
            const outputs = routeToolCalls(nonGenieToolCalls, nodeIdByToolName);
            Object.entries(outputs).forEach(([id, output]) => {
              store.setOutput(id, output);
            });
          }
        }
      } catch (error) {
        console.error("Failed to run inference:", error);
      } finally {
        store.setLoadingNodeId(null);
      }
    },
    [store, urlLoader.urlContexts, genie]
  );

  // Compose all nodes (fixed system prompt + user-added nodes)
  const allNodes: PipelineNodeConfig[] = [
    {
      id: "system-prompt-fixed",
      type: "system_prompt",
      config: store.systemPromptConfig,
    },
    ...store.nodes,
  ];

  // Get genie conversations and backstory updates for canvas
  const genieConversations: Record<string, GenieOutput> = {};
  const genieBackstoryUpdates: Record<string, boolean> = {};
  store.nodes.forEach((node) => {
    if (node.type === "genie") {
      const conv = getGenieConversation(store, node.id);
      if (conv) genieConversations[node.id] = conv;
      const hasUpdate = getGenieBackstoryUpdate(store, node.id);
      if (hasUpdate) genieBackstoryUpdates[node.id] = true;
    }
  });

  // Find module info for drag overlay
  const activeModule = dragDrop.activeType
    ? dragDrop.activeType === "system_prompt"
      ? SYSTEM_PROMPT_MODULE
      : MODULE_DEFINITIONS.find((m) => m.type === dragDrop.activeType)
    : null;

  // Get preceding nodes and tools for inspector
  const getInspectorData = useCallback(
    (targetNodeId: string) => {
      const nodeIndex = allNodes.findIndex((n) => n.id === targetNodeId);
      if (nodeIndex === -1) return { precedingNodes: [], tools: [] };
      const precedingNodes = allNodes.slice(0, nodeIndex);
      const { tools } = getToolsForDownstreamNodes(allNodes, nodeIndex);
      return { precedingNodes, tools };
    },
    [allNodes]
  );

  const inspectorData = inspectorState.targetNodeId
    ? getInspectorData(inspectorState.targetNodeId)
    : { precedingNodes: [], tools: [] };

  return (
    <DndContext
      sensors={dragDrop.sensors}
      collisionDetection={dragDrop.collisionDetection}
      onDragStart={dragDrop.handleDragStart}
      onDragOver={dragDrop.handleDragOver}
      onDragEnd={dragDrop.handleDragEnd}
    >
      <div className={`${styles.builder} ${inspectorState.isOpen ? styles.inspectorOpen : ""}`}>
        <ContextInspector
          isOpen={inspectorState.isOpen}
          onClose={closeInspector}
          targetNodeId={inspectorState.targetNodeId || ""}
          systemPromptConfig={store.systemPromptConfig}
          precedingNodes={inspectorData.precedingNodes}
          genieConversations={genieConversations}
          urlContexts={urlLoader.urlContexts}
          userInputs={store.userInputs}
          tools={inspectorData.tools}
          onHoverSection={setHighlightedNodeId}
        />
        <PipelineCanvas
          nodes={allNodes}
          onRemoveNode={store.removeNode}
          onConfigChange={store.updateConfig}
          userInputs={store.userInputs}
          onUserInputChange={store.setUserInput}
          onRunInference={handleRunInference}
          onLoadURL={urlLoader.loadURL}
          loadingNodeId={store.loadingNodeId}
          loadingUrlNodeIds={urlLoader.loadingUrlNodeIds}
          outputs={store.outputs}
          urlContexts={urlLoader.urlContexts}
          activeNodeId={dragDrop.activeId}
          overNodeId={dragDrop.overId}
          genieConversations={genieConversations}
          onGenieSelfInference={genie.selfInference}
          onGenieSaveBackstory={genie.saveBackstory}
          genieBackstoryUpdates={genieBackstoryUpdates}
          onGenieClearUpdate={(nodeId) => {
            store.clearNodeState(nodeId, "genie:backstoryUpdate");
          }}
          highlightedNodeId={highlightedNodeId}
          onInspectContext={toggleInspector}
        />
        <ModulePalette />
      </div>

      <DragOverlay>
        {activeModule && (
          <div
            className={styles.dragOverlay}
            style={
              {
                "--module-color": activeModule.color,
              } as React.CSSProperties
            }
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
