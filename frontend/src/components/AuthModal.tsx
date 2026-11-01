import { Component, createSignal, Show } from "solid-js";
import { isAuthModalOpen, setIsAuthModalOpen, setApiKey } from "../lib/store";
import Icon from "./Icon";

const AuthModal: Component = () => {
    const [inputKey, setInputKey] = createSignal("");

    const handleSave = () => {
        const key = inputKey().trim();
        if (key) {
            setApiKey(key);
            localStorage.setItem("api_key", key);
            setIsAuthModalOpen(false);
            // Reload to re-fetch tables with the new key
            window.location.reload();
        }
    };

    return (
        <Show when={isAuthModalOpen()}>
            <div class="modal modal-open bg-black/50">
                <div class="modal-box">
                    <div class="size-12 rounded-full bg-primary/12 text-primary grid place-items-center mb-4"><Icon name="key" /></div>
                    <h3 class="font-medium text-xl">Authentication required</h3>
                    <p class="py-3 text-sm text-base-content/70">Enter your API key to access this database.</p>
                    <div class="form-control w-full">
                        <input
                            type="password"
                            placeholder="API Key"
                            class="input input-bordered w-full"
                            value={inputKey()}
                            onInput={(e) => setInputKey(e.currentTarget.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        />
                    </div>
                    <div class="modal-action">
                        <button class="btn btn-primary" onClick={handleSave}>Save & Reload</button>
                    </div>
                </div>
            </div>
        </Show>
    );
};

export default AuthModal;
