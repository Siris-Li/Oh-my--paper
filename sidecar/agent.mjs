import { loadProvider } from "./providers/index.mjs";
import { getTools } from "./tools/registry.mjs";
import { runAgentWithOpencode, supportsOpencodeVendor } from "./opencode.mjs";
import { emit } from "./utils/ndjson.mjs";

export async function runAgent(request) {
  const requestedEngine = process.env.VIEWERLEAF_AGENT_ENGINE;
  const useOpencode =
    requestedEngine === "opencode" && supportsOpencodeVendor(request?.provider?.vendor);

  if (useOpencode) {
    try {
      await runAgentWithOpencode(request);
      return;
    } catch (error) {
      const message = error?.message || String(error);
      emit({ type: "error", message: `opencode runner failed: ${message}` });
      emit({
        type: "done",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          model: request?.provider?.model || "",
        },
      });
      return;
    }
  }

  if (requestedEngine === "opencode") {
    emit({
      type: "error",
      message: `opencode runner does not support provider vendor: ${request?.provider?.vendor ?? "unknown"}`,
    });
    emit({
      type: "done",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        model: request?.provider?.model || "",
      },
    });
    return;
  }

  await runLegacyAgent(request);
}

async function runLegacyAgent(request) {
  const { provider: providerConfig, systemPrompt, tools: toolIds, context } = request;
  const provider = loadProvider(providerConfig);
  const tools = getTools(toolIds);
  const toolCtx = {
    projectRoot: context.projectRoot,
    activeFilePath: context.activeFilePath,
    sessionId: request.sessionId,
  };

  const messages = [{ role: "system", content: systemPrompt }];
  const history = Array.isArray(request.history) ? request.history : [];
  for (const item of history) {
    if (!item || typeof item.content !== "string") {
      continue;
    }
    if (item.role !== "user" && item.role !== "assistant") {
      continue;
    }
    messages.push({ role: item.role, content: item.content });
  }
  messages.push({
    role: "user",
    content: buildUserMessage(context, request.userMessage),
  });

  const maxToolRounds = 10;
  let round = 0;

  while (round < maxToolRounds) {
    round += 1;
    let hasToolCalls = false;
    let textAccum = "";
    const pendingToolCalls = [];

    try {
      for await (const chunk of provider.chat({ messages, tools })) {
        if (chunk.type === "text") {
          emit({ type: "text_delta", content: chunk.text });
          textAccum += chunk.text;
        } else if (chunk.type === "tool_call") {
          hasToolCalls = true;
          pendingToolCalls.push(chunk);
        }
      }
    } catch (error) {
      emit({ type: "error", message: error?.message || String(error) });
      break;
    }

    if (textAccum) {
      messages.push({ role: "assistant", content: textAccum });
    }

    if (!hasToolCalls) {
      break;
    }

    const assistantMessage = {
      role: "assistant",
      content: textAccum || null,
      tool_calls: pendingToolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args),
        },
      })),
    };

    if (textAccum) {
      messages.pop();
    }
    messages.push(assistantMessage);

    for (const call of pendingToolCalls) {
      emit({ type: "tool_call_start", toolId: call.name, args: call.args });

      const tool = tools.find((item) => item.id === call.name);
      if (!tool) {
        const errMsg = `Unknown tool: ${call.name}`;
        emit({ type: "tool_call_result", toolId: call.name, output: errMsg, status: "error" });
        messages.push({ role: "tool", tool_call_id: call.id, content: errMsg });
        continue;
      }

      try {
        const result = await tool.execute(call.args, toolCtx);
        emit({ type: "tool_call_result", toolId: call.name, output: result.output, status: "completed" });

        if (result.sideEffects) {
          for (const effect of result.sideEffects) {
            if (effect.type === "file_changed") {
              emit({
                type: "patch",
                filePath: effect.filePath,
                startLine: 0,
                endLine: 0,
                newContent: effect.content,
              });
            }
          }
        }

        messages.push({ role: "tool", tool_call_id: call.id, content: result.output });
      } catch (error) {
        const errMsg = `Tool error: ${error?.message || String(error)}`;
        emit({ type: "tool_call_result", toolId: call.name, output: errMsg, status: "error" });
        messages.push({ role: "tool", tool_call_id: call.id, content: errMsg });
      }
    }
  }

  emit({ type: "done", usage: provider.getUsage() });
}

function buildUserMessage(context, userMessage) {
  const parts = [];
  if (typeof userMessage === "string" && userMessage.trim()) {
    parts.push(`## User Request\n\n${userMessage}`);
  }
  if (context.selectedText) {
    parts.push(`## Selected Text\n\n${context.selectedText}`);
  }
  if (context.activeFilePath) {
    parts.push(`## Active File\n\n${context.activeFilePath}`);
  }
  if (context.projectRoot) {
    parts.push(`## Project Root\n\n${context.projectRoot}`);
  }
  parts.push(`## Cursor\n\nLine ${context.cursorLine}`);
  parts.push(
    [
      "## Tooling Policy",
      "",
      "Do not assume full file content is preloaded.",
      "Read files on demand and only inspect the minimal ranges needed.",
      "Before editing, verify exact context with targeted tool reads.",
    ].join("\n"),
  );
  return parts.join("\n\n---\n\n");
}
