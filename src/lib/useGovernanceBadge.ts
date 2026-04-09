import { useEffect, useState } from "react";
import { getConflicts, getDecayCandidates, getScratchCandidates } from "./tauri";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useGovernanceBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [conflicts, decay, scratch] = await Promise.all([
          getConflicts(),
          getDecayCandidates(),
          getScratchCandidates(),
        ]);
        setCount(conflicts.length + decay.length + scratch.length);
      } catch {
        // silently fail — badge is best-effort
      }
    };

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return count;
}
