import { useEffect, useState } from "react";
import { STATE_EVENT, type RequestType, type Requests, type Response } from "../shared/messages";
import type { UiState } from "../shared/types";

export async function call<T extends RequestType>(
  type: T,
  payload: Requests[T]["req"] = {} as Requests[T]["req"]
): Promise<Requests[T]["res"]> {
  let res: Response<Requests[T]["res"]> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await chrome.runtime.sendMessage({ type, payload });
      break;
    } catch (e) {
      // service worker may be starting up
      if (attempt === 2) throw new Error("Stopwatch background is not responding.");
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  if (!res) throw new Error("No response from Stopwatch background.");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function useUiState(): [UiState | null, (s: UiState) => void, string | null] {
  const [state, setState] = useState<UiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const listener = (msg: { event?: string; state?: UiState }) => {
      if (msg?.event === STATE_EVENT && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    call("state:get").then(setState, (e: Error) => setError(e.message));
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  return [state, setState, error];
}

/** Wraps an async action with busy + error state for a component. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
