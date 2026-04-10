import { useEffect, useState } from "react";
import { useVaultStore } from "../../lib/vaultStore";

const FRAMES = [
  `
   __|__    __|__    __|__
  (o o o)  (- - -)  (o o o)
  /|_|_|\\  /|_|_|\\  /|_|_|\\
   | | |    | | |    | | |
  _|_|_|_  _|_|_|_  _|_|_|_
`,
  `
   __|__    __|__    __|__
  (- - -)  (o o o)  (- - -)
  \\|_|_|/  /|_|_|\\  \\|_|_|/
   | | |    | | |    | | |
  _|_|_|_  _|_|_|_  _|_|_|_
`,
  `
   __|__    __|__    __|__
  (* * *)  (- - -)  (* * *)
  /|_|_|\\  \\|_|_|/  /|_|_|\\
   | | |    | | |    | | |
  _|_|_|_  _|_|_|_  _|_|_|_
`,
  `
   __|__    __|__    __|__
  (o - o)  (* * *)  (o - o)
  \\|_|_|/  /|_|_|\\  \\|_|_|/
   | | |    | | |    | | |
  _|_|_|_  _|_|_|_  _|_|_|_
`,
];

const BEAM_FRAMES = ["·", "·· ", "···", "·· ", "·"];

export function VaultSwitchScreen() {
  const { switchPhase, switchTarget, switchLogs, switchError, cancelSwitch } =
    useVaultStore();

  const [frame, setFrame] = useState(0);
  const [beam, setBeam] = useState(0);

  useEffect(() => {
    if (switchPhase !== "switching" && switchPhase !== "error") return;
    const alienTimer = setInterval(
      () => setFrame((f) => (f + 1) % FRAMES.length),
      220,
    );
    const beamTimer = setInterval(
      () => setBeam((b) => (b + 1) % BEAM_FRAMES.length),
      150,
    );
    return () => {
      clearInterval(alienTimer);
      clearInterval(beamTimer);
    };
  }, [switchPhase]);

  if (switchPhase !== "switching" && switchPhase !== "error") return null;

  const isError = switchPhase === "error";

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[color:var(--bg-0)]">
      {/* ASCII aliens */}
      <pre
        className="select-none font-mono text-xs leading-tight"
        style={{ color: isError ? "var(--danger)" : "var(--accent)" }}
      >
        {FRAMES[frame]}
      </pre>

      {/* Beam */}
      <div
        className="mb-6 font-mono text-lg tracking-widest"
        style={{ color: "var(--accent)", opacity: isError ? 0 : 1 }}
      >
        {BEAM_FRAMES[beam]}
      </div>

      {/* Title */}
      <p className="mb-4 text-sm font-medium text-[color:var(--text-0)]">
        {isError
          ? "Vault switch failed"
          : `Switching to ${switchTarget?.name ?? "vault"}...`}
      </p>

      {/* Log lines */}
      <div className="w-80 max-h-36 overflow-y-auto rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] p-3">
        {switchLogs.map((line, i) => (
          <div
            key={i}
            className="font-mono text-[11px] leading-relaxed text-[color:var(--text-2)]"
          >
            <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>
              {i === switchLogs.length - 1 && !isError ? "›" : "✓"}
            </span>
            {line}
          </div>
        ))}
        {!isError && switchLogs.length === 0 && (
          <div className="font-mono text-[11px] text-[color:var(--text-2)]">
            Preparing...
          </div>
        )}
      </div>

      {/* Error state */}
      {isError && (
        <div className="mt-4 w-80 space-y-3">
          <p className="rounded-md bg-[color:var(--danger)]/10 px-3 py-2 text-xs text-[color:var(--danger)]">
            {switchError}
          </p>
          <button
            onClick={cancelSwitch}
            className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-2 text-xs font-medium text-[color:var(--text-0)] hover:border-[color:var(--border-active)]"
          >
            Go back
          </button>
        </div>
      )}
    </div>
  );
}
