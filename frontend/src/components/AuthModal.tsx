import { Component, createSignal, createEffect, onCleanup, Show } from "solid-js";
import { isAuthModalOpen, setIsAuthModalOpen, setApiKey, apiKey, theme, fetchTables, fetchSavedQueries, fetchDbFiles, pushToast } from "../lib/store";
import { fetchAuthConfig, login, AuthConfig } from "../lib/api";
import Icon from "./Icon";
import Dialog from "./Dialog";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: (error?: any) => void;
          "expired-callback"?: () => void;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const id = "cf-turnstile-script";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

const AuthModal: Component = () => {
  const [inputKey, setInputKey] = createSignal(apiKey());
  const [authConfig, setAuthConfig] = createSignal<AuthConfig | null>(null);
  const [turnstileToken, setTurnstileToken] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal("");

  let turnstileContainer: HTMLDivElement | undefined;
  let widgetId: string | null = null;

  const renderTurnstile = async (siteKey: string) => {
    try {
      await loadTurnstileScript();
      if (!turnstileContainer || !window.turnstile) return;
      if (widgetId) {
        try {
          window.turnstile.remove(widgetId);
        } catch (_) {}
        widgetId = null;
      }
      widgetId = window.turnstile.render(turnstileContainer, {
        sitekey: siteKey,
        theme: theme() === "dark" ? "dark" : "light",
        callback: (token: string) => {
          setTurnstileToken(token);
          setErrorMessage("");
        },
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => {
          setTurnstileToken("");
          setErrorMessage("Turnstile challenge failed. Please retry.");
        },
      });
    } catch (e) {
      console.error("Failed to load Turnstile widget", e);
      setErrorMessage("Could not load Cloudflare Turnstile challenge.");
    }
  };

  createEffect(() => {
    if (isAuthModalOpen()) {
      setInputKey(apiKey());
      setErrorMessage("");
      setTurnstileToken("");
      setIsSubmitting(false);
      fetchAuthConfig().then((cfg) => {
        setAuthConfig(cfg);
        if (cfg.turnstile_enabled && cfg.turnstile_site_key) {
          setTimeout(() => cfg.turnstile_site_key && renderTurnstile(cfg.turnstile_site_key), 50);
        }
      });
    } else if (widgetId && window.turnstile) {
      try {
        window.turnstile.remove(widgetId);
      } catch (_) {}
      widgetId = null;
    }
  });

  onCleanup(() => {
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.remove(widgetId);
      } catch (_) {}
    }
  });

  const handleLogin = async () => {
    const key = inputKey().trim();
    if (!key) {
      setErrorMessage("Please enter your API key");
      return;
    }
    const config = authConfig();
    if (config?.turnstile_enabled && !turnstileToken()) {
      setErrorMessage("Please complete the Turnstile challenge");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const res = await login(key, turnstileToken() || undefined);
      if (res.success) {
        setApiKey(key);
        localStorage.setItem("api_key", key);
        setIsAuthModalOpen(false);
        await Promise.all([fetchTables(), fetchSavedQueries(), fetchDbFiles()]);
        pushToast("success", "Authenticated");
      } else {
        setErrorMessage(res.error || "Authentication failed");
        if (widgetId && window.turnstile) {
          window.turnstile.reset(widgetId);
          setTurnstileToken("");
        }
      }
    } catch (e: any) {
      setErrorMessage(e.message || "Failed to authenticate");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isAuthModalOpen()}
      onClose={() => !isSubmitting() && setIsAuthModalOpen(false)}
      title="Authentication required"
      icon="key"
      footer={
        <>
          <button type="button" class="btn btn-default" onClick={handleLogin} disabled={isSubmitting() || !inputKey().trim() || Boolean(authConfig()?.turnstile_enabled && !turnstileToken())}>
            {isSubmitting() ? "Signing in…" : "Log In"}
          </button>
        </>
      }
    >
      <p class="mb-4 text-sm text-muted-foreground">Enter your API key to access this database.</p>
      <input
        type="password"
        placeholder="API Key"
        class="input w-full"
        value={inputKey()}
        onInput={(e) => setInputKey(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        disabled={isSubmitting()}
        aria-label="API key"
      />
      <Show when={authConfig()?.turnstile_enabled}>
        <div class="mt-4 flex flex-col items-center">
          <div ref={turnstileContainer} />
        </div>
      </Show>
      <Show when={errorMessage()}>
        <div class="alert alert-error mt-4 text-xs" role="alert">
          <Icon name="error" class="size-4 shrink-0" />
          <span>{errorMessage()}</span>
        </div>
      </Show>
    </Dialog>
  );
};

export default AuthModal;
