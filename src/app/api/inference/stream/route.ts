import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

interface StreamRequest {
  systemPrompt: string;
  userMessage: string;
  model: string;
  temperature: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: StreamRequest = await request.json();
    const { systemPrompt, userMessage, model, temperature } = body;

    if (!userMessage?.trim()) {
      return new Response(
        JSON.stringify({ error: "User message is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const posthogApiKey = process.env.POSTHOG_API_KEY;
    const posthogProjectId = process.env.POSTHOG_PROJECT_ID;
    const posthogApiUrl = process.env.POSTHOG_API_URL || "https://us.posthog.com";

    if (!posthogApiKey || !posthogProjectId) {
      return new Response(
        JSON.stringify({ error: "PostHog API credentials not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const gatewayUrl = `${posthogApiUrl}/api/projects/${posthogProjectId}/llm_gateway`;

    const client = new Anthropic({
      baseURL: gatewayUrl,
      apiKey: posthogApiKey,
      defaultHeaders: {
        Authorization: `Bearer ${posthogApiKey}`,
      },
    });

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const messageStream = await client.messages.stream({
            model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            temperature,
          });

          for await (const event of messageStream) {
            if (event.type === "content_block_delta") {
              const delta = event.delta;
              if ("text" in delta) {
                // Send text chunk as SSE
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text: delta.text })}\n\n`)
                );
              }
            }
          }

          // Send done signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Stream request error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
