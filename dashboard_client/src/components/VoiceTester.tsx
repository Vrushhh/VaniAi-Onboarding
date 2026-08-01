import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { synthesizeSpeech } from "@/lib/sarvam.functions";
import { initiateTestCall } from "@/lib/exotel.functions";
import { toast } from "sonner";
import { Loader2, Play, PhoneCall } from "lucide-react";
import { Waveform } from "./Waveform";

export function VoiceTester() {
  const tts = useServerFn(synthesizeSpeech);
  const call = useServerFn(initiateTestCall);

  const [text, setText] = useState(
    "Hi! This is your AI calling agent powered by Sarvam.",
  );
  const [lang, setLang] = useState("en-IN");
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [callText, setCallText] = useState(
    "Hello! This is a test call from your AI calling agent. Have a great day!",
  );
  const [callLang, setCallLang] = useState("en-IN");
  const [toNumber, setToNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [lastCall, setLastCall] = useState<{ sid: string | null; to: string } | null>(null);

  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setIsPlaying(false);
  }

  async function play() {
    if (!text.trim()) {
      toast.error("Enter some text first");
      return;
    }
    setLoading(true);
    try {
      const { audio_base64, mime_type } = await tts({
        data: { text: text.trim(), target_language_code: lang.trim() || "en-IN" },
      });
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        setIsPlaying(false);
      }
      const audio = new Audio(`data:${mime_type};base64,${audio_base64}`);
      audioRef.current = audio;
      
      audio.addEventListener("playing", () => setIsPlaying(true));
      audio.addEventListener("ended", () => setIsPlaying(false));
      audio.addEventListener("pause", () => setIsPlaying(false));
      audio.addEventListener("error", () => setIsPlaying(false));

      setIsPlaying(true);
      await audio.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Voice test failed");
      setIsPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  async function startCall() {
    if (!toNumber.trim()) {
      toast.error("Enter a destination number");
      return;
    }
    if (!callText.trim()) {
      toast.error("Enter what the agent should say");
      return;
    }
    setCalling(true);
    setLastCall(null);
    try {
      const res = await call({
        data: {
          to: toNumber.trim(),
          text: callText.trim(),
          target_language_code: callLang.trim() || "en-IN",
        },
      });
      setLastCall({ sid: res.call_sid, to: res.to });
      toast.success(`Calling ${res.to}…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test call failed");
    } finally {
      setCalling(false);
    }
  }

  return (
    <Card className="p-6 transition-all border-border/40 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">Voice Testing Sandbox</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Preview Sarvam TTS in the browser, or place a live test call via Exotel.
        </p>
      </div>

      <Tabs defaultValue="voice">
        <TabsList className="bg-muted/60 p-0.5">
          <TabsTrigger value="voice" className="rounded-md">Test voice</TabsTrigger>
          <TabsTrigger value="call" className="rounded-md">Test call</TabsTrigger>
        </TabsList>

        <TabsContent value="voice" className="mt-4 grid gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase font-medium tracking-wide text-muted-foreground">
              Text to Synthesize
            </Label>
            <Textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type something for the agent to say…"
              className="rounded-lg border-border/80 focus-visible:ring-violet-500 focus-visible:border-violet-500 transition-all resize-none"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3 justify-between">
            <div className="flex items-end gap-3 flex-1 min-w-[200px]">
              <div className="w-32 space-y-1.5">
                <Label className="text-xs uppercase font-medium tracking-wide text-muted-foreground">
                  Language Code
                </Label>
                <Input
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  placeholder="en-IN"
                  className="rounded-lg border-border/80 focus-visible:ring-violet-500"
                />
              </div>
              <Button 
                onClick={isPlaying ? stop : play} 
                disabled={loading} 
                className={`rounded-lg transition-all duration-300 font-medium active:scale-95 ${
                  isPlaying 
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-500/10' 
                    : 'bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white shadow-md shadow-violet-500/10'
                }`}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <span className="mr-2 flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                  </span>
                ) : (
                  <Play className="mr-2 h-4 w-4 fill-current" />
                )}
                {loading ? "Generating…" : isPlaying ? "Stop preview" : "Test voice"}
              </Button>
            </div>
            {isPlaying && (
              <div className="flex items-center gap-[3px] h-9 px-4 rounded-xl bg-accent border border-border animate-in fade-in zoom-in-95 duration-200">
                <Waveform isPlaying={isPlaying} className="h-6 mr-2" />
                <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">Playing preview</span>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="call" className="mt-4 grid gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Destination number
            </Label>
            <Input
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="+919999999999"
            />
            <p className="text-[11px] text-muted-foreground">
              On an Exotel free trial, the number must be verified in your Exotel
              dashboard or the call will silently fail.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              What the agent should say
            </Label>
            <Textarea
              rows={3}
              value={callText}
              onChange={(e) => setCallText(e.target.value)}
              placeholder="Hello, this is a test call from your AI agent…"
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="w-32 space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Language
              </Label>
              <Input
                value={callLang}
                onChange={(e) => setCallLang(e.target.value)}
                placeholder="en-IN"
              />
            </div>
            <Button onClick={startCall} disabled={calling}>
              {calling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PhoneCall className="mr-2 h-4 w-4" />
              )}
              {calling ? "Placing call…" : "Place test call"}
            </Button>
          </div>
          {lastCall && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <div>
                Call queued to <span className="font-medium">{lastCall.to}</span>
              </div>
              {lastCall.sid && (
                <div className="text-muted-foreground">Exotel Call SID: {lastCall.sid}</div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
