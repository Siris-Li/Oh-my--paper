import { useState, useEffect, useCallback, useRef } from "react";
import QRCode from "qrcode";
import type { AppLocale } from "../types";
import { desktop } from "../lib/desktop";

interface CcConnectStatus {
  installed: boolean;
  version?: string;
  state: string;
  message: string;
}

interface WeChatRemotePanelProps {
  locale: AppLocale;
}

export function WeChatRemotePanel({ locale }: WeChatRemotePanelProps) {
  const isZh = locale === "zh-CN";

  const [status, setStatus] = useState<CcConnectStatus>({
    installed: false,
    state: "idle",
    message: isZh ? "检测中…" : "Detecting…",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [setupPhase, setSetupPhase] = useState<
    "idle" | "configuring" | "scanning" | "done"
  >("idle");

  // ── Detection on mount ──
  useEffect(() => {
    void detectStatus();
  }, []);

  async function detectStatus() {
    try {
      const s = await desktop.detectCcConnect();
      setStatus(s);
    } catch {
      setStatus({
        installed: false,
        state: "idle",
        message: isZh ? "检测失败" : "Detection failed",
      });
    }
  }

  async function refreshStatus() {
    try {
      const s = await desktop.getCcConnectStatus();
      setStatus(s);
    } catch {
      // ignore
    }
  }

  // ── Install cc-connect@beta ──
  async function handleInstall() {
    setLoading(true);
    setError("");
    try {
      const version = await desktop.installCcConnect();
      setStatus({
        installed: true,
        version,
        state: "idle",
        message: isZh ? "安装成功" : "Installed successfully",
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Setup WeChat connection ──
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSetupWeixin() {
    setLoading(true);
    setError("");
    setSetupPhase("configuring");
    setQrDataUri(null);

    try {
      // Step 1: Generate config.toml
      await desktop.setupCcConnectConfig();
      setSetupPhase("scanning");

      // Step 2: Run weixin setup to get QR URL (keeps setup process alive)
      const qrUrl = await desktop.startCcConnectWeixinSetup();

      // Step 3: Generate QR code image from the URL
      if (qrUrl.startsWith("data:")) {
        setQrDataUri(qrUrl);
      } else {
        const dataUri = await QRCode.toDataURL(qrUrl, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        setQrDataUri(dataUri);
      }

      // Step 4: Poll for setup completion (user scanning QR)
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const done = await desktop.waitCcConnectWeixinSetup();
          if (done) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            // Setup completed! Auto-start cc-connect
            handleSetupDone();
          }
        } catch {
          // setup process errored, stop polling
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setError(isZh ? "绑定失败，请重试" : "Setup failed, please retry");
          setSetupPhase("idle");
        }
      }, 2000);
    } catch (err) {
      setError(String(err));
      setSetupPhase("idle");
    } finally {
      setLoading(false);
    }
  }

  // ── Start cc-connect process ──
  async function handleStart() {
    setLoading(true);
    setError("");
    try {
      await desktop.startCcConnect();
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Stop cc-connect process ──
  async function handleStop() {
    setLoading(true);
    try {
      await desktop.stopCcConnect();
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const handleCancelSetup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    void desktop.cancelCcConnectWeixinSetup();
    setSetupPhase("idle");
    setQrDataUri(null);
  }, []);

  const handleSetupDone = useCallback(async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSetupPhase("done");
    setQrDataUri(null);
    // Auto-start cc-connect after successful setup
    try {
      await desktop.startCcConnect();
    } catch {
      // ignore start error, user can manually start
    }
    void refreshStatus();
  }, []);

  // ── Status colors ──
  const statusColor =
    status.state === "running"
      ? "var(--color-success, #22c55e)"
      : status.state === "error"
        ? "var(--color-danger, #ef4444)"
        : "var(--color-muted, #94a3b8)";

  // ════════════════════════════════════════════════════
  // RENDER: Not Installed
  // ════════════════════════════════════════════════════
  if (!status.installed) {
    return (
      <div className="wechat-remote-panel">
        <div className="settings-section">
          <div className="settings-section__label">
            {isZh ? "cc-connect 微信桥接" : "cc-connect WeChat Bridge"}
          </div>
          <div className="settings-section__desc">
            {isZh
              ? "cc-connect 是一个将 AI Agent 连接到微信等消息平台的桥接工具。安装后，你可以通过手机微信远程与本地 AI Agent 对话。"
              : "cc-connect bridges your local AI agents to messaging platforms like WeChat. After setup, you can chat with your AI agent from your phone."}
          </div>
        </div>

        <div className="compute-node-empty">
          <div className="compute-node-empty__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <div className="compute-node-empty__text">
            {isZh
              ? "未检测到 cc-connect。请先安装 beta 版本以支持微信个人号。"
              : "cc-connect not detected. Install the beta version to enable personal WeChat support."}
          </div>
        </div>

        <div className="wechat-status-card__actions" style={{ flexDirection: "column", gap: 12 }}>
          <button
            className="btn-primary"
            type="button"
            disabled={loading}
            onClick={() => void handleInstall()}
          >
            {loading
              ? isZh ? "安装中…" : "Installing…"
              : isZh ? "📦 一键安装 cc-connect@beta" : "📦 Install cc-connect@beta"}
          </button>

          <div className="wechat-install-hint" style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            textAlign: "center",
            lineHeight: 1.6,
          }}>
            {isZh ? "或在终端手动运行：" : "Or run manually in your terminal:"}
            <code style={{
              display: "block",
              marginTop: 4,
              padding: "6px 12px",
              background: "var(--bg-secondary, #1a1a2e)",
              borderRadius: 6,
              fontFamily: "monospace",
              fontSize: 12,
            }}>
              npm install -g cc-connect@beta
            </code>
          </div>
        </div>

        {error && <div className="compute-node-error">{error}</div>}
      </div>
    );
  }

  // ════════════════════════════════════════════════════
  // RENDER: Installed — Setup / Running
  // ════════════════════════════════════════════════════
  return (
    <div className="wechat-remote-panel">
      {/* Description */}
      <div className="settings-section">
        <div className="settings-section__label">
          {isZh ? "cc-connect 微信桥接" : "cc-connect WeChat Bridge"}
        </div>
        <div className="settings-section__desc">
          {isZh
            ? "通过 cc-connect 将微信消息桥接到本地 AI Agent，随时随地远程对话。"
            : "Bridge WeChat messages to your local AI Agent via cc-connect. Chat remotely from anywhere."}
        </div>
      </div>

      {/* Connection status */}
      <div className="wechat-status-card">
        <div className="wechat-status-card__header">
          <div className="wechat-status-indicator" style={{ backgroundColor: statusColor }} />
          <div className="wechat-status-card__info">
            <div className="wechat-status-card__state">
              {status.state === "running"
                ? isZh ? "运行中" : "Running"
                : isZh ? "未运行" : "Idle"}
              {status.version && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                  v{status.version}
                </span>
              )}
            </div>
            <div className="wechat-status-card__message">{status.message}</div>
          </div>
        </div>

        {/* QR code display during setup */}
        {setupPhase === "scanning" && (
          <div className="wechat-qr-container">
            <div className="wechat-qr-frame">
              {qrDataUri ? (
                <img
                  src={qrDataUri}
                  alt="WeChat QR Code"
                  className="wechat-qr-image"
                />
              ) : (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 220,
                  height: 220,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                }}>
                  {isZh ? "正在获取二维码…" : "Fetching QR code…"}
                </div>
              )}
            </div>
            <div className="wechat-qr-hint">
              {isZh
                ? "打开手机微信 → 扫一扫 → 扫描上方二维码"
                : "Open WeChat on your phone → Scan → Scan the QR code above"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="btn-primary"
                type="button"
                onClick={handleSetupDone}
              >
                {isZh ? "✅ 已扫码完成" : "✅ Scan Completed"}
              </button>
              <button
                className="btn-secondary wechat-cancel-btn"
                type="button"
                onClick={handleCancelSetup}
              >
                {isZh ? "取消" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {setupPhase !== "scanning" && (
          <div className="wechat-status-card__actions">
            {status.state !== "running" ? (
              <>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={loading}
                  onClick={() => void handleSetupWeixin()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  {loading && setupPhase === "configuring"
                    ? isZh ? "配置中…" : "Configuring…"
                    : isZh ? "扫码连接微信" : "Connect WeChat (QR Scan)"}
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={loading}
                  onClick={() => void handleStart()}
                >
                  {isZh ? "▶ 启动 cc-connect" : "▶ Start cc-connect"}
                </button>
              </>
            ) : (
              <button
                className="btn-secondary"
                type="button"
                disabled={loading}
                onClick={() => void handleStop()}
              >
                {isZh ? "⏹ 停止 cc-connect" : "⏹ Stop cc-connect"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="wechat-section" style={{ marginTop: 16 }}>
        <div style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          lineHeight: 1.8,
          padding: "12px 0",
          borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
        }}>
          <strong>{isZh ? "工作原理" : "How it works"}</strong>
          <ol style={{ margin: "6px 0 0 16px", paddingLeft: 0 }}>
            <li>{isZh
              ? "点击「扫码连接微信」生成二维码"
              : "Click \"Connect WeChat\" to generate a QR code"}</li>
            <li>{isZh
              ? "用手机微信扫码确认"
              : "Scan with WeChat on your phone to confirm"}</li>
            <li>{isZh
              ? "启动 cc-connect 开始消息桥接"
              : "Start cc-connect to begin message bridging"}</li>
            <li>{isZh
              ? "在微信中发送消息，AI Agent 自动回复"
              : "Send messages in WeChat and the AI Agent will auto-reply"}</li>
          </ol>
        </div>
      </div>

      {error && <div className="compute-node-error">{error}</div>}
    </div>
  );
}
