import { Waveform } from "./Waveform";

type TranscriptTurn = {
  who: "agent" | "customer";
  text: string;
};

export function LiveCallWidget({
  agentName = "Kzuno Agent",
  phoneNumber = "+91 98•••••231",
  jobName = "Order confirmation",
  languageCode = "hi-IN",
  duration = "00:19",
  isLive = true,
  turns = [
    { who: "agent", text: "Hello! Am I speaking with Mr. Sharma?" },
    { who: "customer", text: "Yes, speaking. Who is this?" },
    { who: "agent", text: "Sir, I am calling from Kzuno to confirm your order." }
  ],
  outcome = "Listening..."
}: {
  agentName?: string;
  phoneNumber?: string;
  jobName?: string;
  languageCode?: string;
  duration?: string;
  isLive?: boolean;
  turns?: TranscriptTurn[];
  outcome?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col w-full">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white font-semibold font-sans text-lg">
            K
          </div>
          <div>
            <div className="font-semibold text-foreground text-sm">{agentName}</div>
            <div className="font-mono text-xs text-muted-foreground">Outbound · {phoneNumber}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
          )}
          <span className="font-mono text-xs font-semibold text-muted-foreground">
            {isLive ? "LIVE" : "COMPLETED"} {duration}
          </span>
        </div>
      </div>

      {/* Job strip */}
      <div className="bg-muted px-4 py-1.5 flex items-center justify-between border-b border-border/40 font-mono text-[10px] uppercase text-muted-foreground">
        <div>Job: {jobName}</div>
        <div>{languageCode}</div>
      </div>

      {/* Transcript */}
      <div className="p-4 flex-1 space-y-3 max-h-60 overflow-y-auto">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={`flex flex-col max-w-[85%] ${
              turn.who === "customer" ? "ml-auto items-end" : "mr-auto items-start"
            }`}
          >
            <span className="text-[10px] uppercase font-mono tracking-wider opacity-65 mb-1 px-1">
              {turn.who}
            </span>
            <div
              className={`p-3 rounded-2xl text-[14px] leading-relaxed ${
                turn.who === "customer"
                  ? "bg-terra-tint text-foreground rounded-br-sm"
                  : "bg-accent text-foreground rounded-bl-sm"
              }`}
            >
              {turn.text}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="bg-muted px-4 py-3 flex items-center justify-between border-t border-border/40">
        <Waveform isPlaying={isLive} />
        <span className="font-mono text-xs text-muted-foreground">{outcome}</span>
      </div>
    </div>
  );
}
