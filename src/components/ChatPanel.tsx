import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import type { AgentMessage, AgentProfile } from "../types";

interface ToolCallBlock {
  toolId: string;
  args?: Record<string, unknown>;
  output?: string;
}

interface StreamBlock {
  text: string;
  toolCalls: ToolCallBlock[];
}

function parseStreamBlocks(raw: string): StreamBlock {
  const toolCallRegex = /\[Tool: ([^\]]+)\]\n(?:\[Result: ([\s\S]*?)\]\n)?/g;
  const toolCalls: ToolCallBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = toolCallRegex.exec(raw)) !== null) {
    toolCalls.push({
      toolId: match[1],
      output: match[2]?.trim(),
    });
  }

  const cleanText = raw
    .replace(/\[Tool: [^\]]+\]\n(?:\[Result: [\s\S]*?\]\n)?/g, "")
    .replace(/\[Error: [\s\S]*?\]\n?/g, "")
    .trim();

  return { text: cleanText, toolCalls };
}

function ToolCallCard({ call }: { call: ToolCallBlock }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-call-card">
      <button
        type="button"
        className="tool-call-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tool-call-icon">⚙</span>
        <span className="tool-call-name">{call.toolId}</span>
        {call.output && (
          <span className="tool-call-toggle">{expanded ? "▾" : "▸"}</span>
        )}
      </button>
      {expanded && call.output && (
        <pre className="tool-call-output">{call.output}</pre>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool) {
    return (
      <div className="chat-tool-result">
        <span className="tool-call-icon">⚙</span>
        <span className="chat-tool-name">{message.toolId ?? "tool"}</span>
        {message.content && (
          <pre className="tool-call-output" style={{ marginTop: 6 }}>
            {message.content.slice(0, 400)}
            {message.content.length > 400 ? "…" : ""}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className={`chat-message ${isUser ? "chat-message-user" : "chat-message-assistant"}`}>
      <div className="chat-message-meta">
        {isUser ? "你" : "助手"}
        {message.profileId && !isUser && (
          <span className="chat-message-profile"> · {message.profileId}</span>
        )}
      </div>
      <div className="chat-bubble">
        {isUser ? (
          <div className="chat-user-text">{message.content}</div>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingBubble({
  text,
  profileId,
}: {
  text: string;
  profileId: string;
}) {
  const { text: cleanText, toolCalls } = parseStreamBlocks(text);

  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-message-meta">
        助手 · {profileId}
        <span className="chat-streaming-dot" />
      </div>
      <div className="chat-bubble">
        {toolCalls.map((call, i) => (
          <ToolCallCard key={i} call={call} />
        ))}
        {cleanText && (
          <div className="chat-markdown">
            <ReactMarkdown>{cleanText}</ReactMarkdown>
          </div>
        )}
        {!cleanText && toolCalls.length === 0 && (
          <span className="chat-thinking">思考中…</span>
        )}
      </div>
    </div>
  );
}

interface PatchBannerProps {
  summary: string;
  onApply: () => void;
  onDismiss: () => void;
}

function PatchBanner({ summary, onApply, onDismiss }: PatchBannerProps) {
  return (
    <div className="chat-patch-banner">
      <div className="chat-patch-label">
        <span className="chat-patch-icon">📝</span>
        <span>{summary}</span>
      </div>
      <div className="chat-patch-actions">
        <button className="btn-primary" type="button" onClick={onApply} style={{ fontSize: 12 }}>
          应用补丁
        </button>
        <button className="btn-secondary" type="button" onClick={onDismiss} style={{ fontSize: 12 }}>
          忽略
        </button>
      </div>
    </div>
  );
}

export interface ChatPanelProps {
  messages: AgentMessage[];
  profiles: AgentProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  onRunAgent: () => void;
  onSendMessage: (text: string) => void;
  pendingPatchSummary?: string;
  onApplyPatch: () => void;
  onDismissPatch: () => void;
  streamText?: string;
  isStreaming?: boolean;
}

export function ChatPanel({
  messages,
  profiles,
  activeProfileId,
  onSelectProfile,
  onRunAgent,
  onSendMessage,
  pendingPatchSummary,
  onApplyPatch,
  onDismissPatch,
  streamText,
  isStreaming,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [inputText]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText("");
    onSendMessage(text);
  }, [inputText, isStreaming, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  return (
    <div className="chat-panel">
      {/* Profile selector header */}
      <div className="chat-profile-bar">
        <select
          className="chat-profile-select"
          value={activeProfileId}
          onChange={(e) => onSelectProfile(e.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label} ({profile.model})
            </option>
          ))}
        </select>
        <button
          className="btn-secondary"
          type="button"
          onClick={onRunAgent}
          disabled={isStreaming}
          title="对当前编辑器选中内容执行分析"
          style={{ fontSize: 12, whiteSpace: "nowrap" }}
        >
          分析选中
        </button>
      </div>

      {/* Message list */}
      <div className="chat-messages">
        {messages.length === 0 && !streamText && !isStreaming && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">✦</div>
            <div className="chat-empty-title">AI 助手已就绪</div>
            <div className="chat-empty-desc">
              发送消息开始对话，或选中编辑器内容后点击「分析选中」
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && streamText !== undefined && (
          <StreamingBubble
            text={streamText}
            profileId={activeProfile?.label ?? activeProfileId}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Patch banner */}
      {pendingPatchSummary && (
        <PatchBanner
          summary={pendingPatchSummary}
          onApply={onApplyPatch}
          onDismiss={onDismissPatch}
        />
      )}

      {/* Input area */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "AI 正在回复…" : "发消息，Shift+Enter 换行"}
          disabled={isStreaming}
          rows={1}
        />
        <button
          className="chat-send-btn"
          type="button"
          onClick={handleSend}
          disabled={isStreaming || !inputText.trim()}
          aria-label="发送"
        >
          {isStreaming ? (
            <span className="chat-send-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
