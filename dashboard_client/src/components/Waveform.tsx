import { cn } from "@/lib/utils";

export function Waveform({ isPlaying, className }: { isPlaying: boolean; className?: string }) {
  return (
    <div className={cn("waveform-container", !isPlaying && "waveform-paused", className)}>
      {[...Array(9)].map((_, i) => (
        <div key={i} className="waveform-bar" />
      ))}
    </div>
  );
}
