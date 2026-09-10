import { useState, useEffect, useRef } from "react";
import { FlowDraft, FlowNode } from "@/routes/_authenticated/orgs.$orgId.agents.$agentId.flows.$flowId.index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  RotateCcw,
  X,
  Send,
  Bot,
  User,
  PhoneCall,
  PhoneOff,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Database,
  Globe,
} from "lucide-react";

type TranscriptMessage = {
  id: string;
  sender: "agent" | "user" | "system";
  text: string;
  nodeId?: string;
  nodeType?: string;
  timestamp: string;
};

type StepLogEntry = {
  nodeId: string;
  label: string;
  type: string;
  timestamp: string;
};

interface FlowSimulationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  draft: FlowDraft;
  onSelectNodeOnCanvas?: (nodeId: string) => void;
}

export function FlowSimulationDrawer({
  isOpen,
  onClose,
  draft,
  onSelectNodeOnCanvas,
}: FlowSimulationDrawerProps) {
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [stepLog, setStepLog] = useState<StepLogEntry[]>([]);
  const [userInputText, setUserInputText] = useState("");
  const [isWaitingForInput, setIsWaitingForInput] = useState(false);
  const [isSimulationEnded, setIsSimulationEnded] = useState(false);
  const [stuckReason, setStuckReason] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      restartSimulation();
    }
  }, [isOpen, draft]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  function getNodeById(id: string | null): FlowNode | undefined {
    if (!id) return undefined;
    return draft.nodes.find((n) => n.id === id);
  }

  function restartSimulation() {
    setTranscript([]);
    setStepLog([]);
    setUserInputText("");
    setIsWaitingForInput(false);
    setIsSimulationEnded(false);
    setStuckReason(null);

    const entryId = draft.entry_node || (draft.nodes[0] ? draft.nodes[0].id : null);
    if (!entryId) {
      setTranscript([
        {
          id: "sys_empty",
          sender: "system",
          text: "Flow has no steps or entry node configured.",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setIsSimulationEnded(true);
      return;
    }

    addSystemMessage("Call connected — Simulation started");
    executeNode(entryId, []);
  }

  function addSystemMessage(text: string, nodeId?: string, nodeType?: string) {
    setTranscript((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: "system",
        text,
        nodeId,
        nodeType,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      },
    ]);
  }

  function executeNode(nodeId: string, visitedLog: StepLogEntry[]) {
    const node = getNodeById(nodeId);
    if (!node) {
      addSystemMessage(`Node ${nodeId} not found in flow definition — simulation stuck.`);
      setIsSimulationEnded(true);
      return;
    }

    setCurrentNodeId(node.id);
    if (onSelectNodeOnCanvas) {
      onSelectNodeOnCanvas(node.id);
    }

    const newStepEntry: StepLogEntry = {
      nodeId: node.id,
      label: (node.config as any)?.label || node.type,
      type: node.type,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const updatedLog = [...visitedLog, newStepEntry];
    setStepLog(updatedLog);

    const config = node.config as any;

    switch (node.type) {
      case "agent_speaks":
      case "disclosure": {
        const text = config?.text || config?.message || "(No speech content configured)";
        // Substitute basic variable placeholders
        const processedText = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_: string, varName: string) => `[${varName}]`);

        setTranscript((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            sender: "agent",
            text: processedText,
            nodeId: node.id,
            nodeType: node.type,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);

        const nextId = node.next.default;
        if (nextId) {
          setTimeout(() => executeNode(nextId, updatedLog), 600);
        } else {
          addSystemMessage("Flow ended — no next step connected.", node.id, node.type);
          setIsSimulationEnded(true);
        }
        break;
      }

      case "listen": {
        setIsWaitingForInput(true);
        break;
      }

      case "decision":
      case "switch_language": {
        // Will be evaluated when user enters text or executed directly if preceding step passed text
        setIsWaitingForInput(true);
        break;
      }

      case "lookup":
      case "knowledge": {
        addSystemMessage(`→ Querying ${node.type === "knowledge" ? "Knowledge Base" : "External API Database"}...`, node.id, node.type);
        setTimeout(() => {
          addSystemMessage("Data loaded (simulation fallback)", node.id, node.type);
          const nextId = node.next.default || node.next.success;
          if (nextId) {
            executeNode(nextId, updatedLog);
          } else {
            addSystemMessage("Flow ended after data lookup.", node.id, node.type);
            setIsSimulationEnded(true);
          }
        }, 800);
        break;
      }

      case "handoff": {
        addSystemMessage("→ Transferring call to a human support agent...", node.id, node.type);
        setIsSimulationEnded(true);
        break;
      }

      case "end_call": {
        addSystemMessage("Call ended cleanly", node.id, node.type);
        setIsSimulationEnded(true);
        break;
      }

      default: {
        const nextId = node.next.default;
        if (nextId) {
          executeNode(nextId, updatedLog);
        } else {
          setIsSimulationEnded(true);
        }
        break;
      }
    }
  }

  function handleSendUserReply() {
    if (!userInputText.trim() || !currentNodeId) return;

    const userText = userInputText.trim();
    setUserInputText("");
    setIsWaitingForInput(false);

    setTranscript((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: "user",
        text: userText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);

    const node = getNodeById(currentNodeId);
    if (!node) return;

    // Handle branching logic
    if (node.type === "listen") {
      const nextId = node.next.default;
      if (nextId) {
        setTimeout(() => executeNode(nextId, stepLog), 500);
      } else {
        addSystemMessage("Listen node completed — no next step configured.");
        setIsSimulationEnded(true);
      }
    } else if (node.type === "decision" || node.type === "switch_language") {
      const branches = (node.config as any)?.branches || (node.config as any)?.rules || [];
      let matchedBranchId: string | null = null;

      const lowerReply = userText.toLowerCase();

      for (const branch of branches) {
        const keywords = (branch.keywords || branch.condition || "").toLowerCase().split(",");
        const isMatch = keywords.some((kw: string) => kw.trim() && lowerReply.includes(kw.trim()));
        if (isMatch) {
          matchedBranchId = node.next[branch.id] || branch.nextId;
          break;
        }
      }

      const nextTargetId = matchedBranchId || node.next.default || node.next.fallback;

      if (nextTargetId) {
        setTimeout(() => executeNode(nextTargetId, stepLog), 500);
      } else {
        addSystemMessage(`No matching branch condition for "${userText}" — simulation stuck.`);
        setStuckReason(`No branch matched "${userText}"`);
        setIsSimulationEnded(true);
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] md:w-[480px] bg-card border-l border-border shadow-2xl z-50 flex flex-col font-sans animate-in slide-in-from-right duration-300">
      {/* Drawer Header */}
      <div className="p-4 border-b border-border/60 flex items-center justify-between bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Play className="h-4 w-4 fill-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-display text-foreground">Flow Simulation</h2>
            <p className="text-[11px] text-muted-foreground">Interactive voice dialogue tester</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={restartSimulation}
            className="gap-1.5 text-xs rounded-lg border-primary/20 text-primary hover:bg-primary/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Transcript Body */}
      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-muted/5">
        {transcript.map((msg) => {
          if (msg.sender === "system") {
            return (
              <div key={msg.id} className="flex justify-center my-2">
                <div className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-3 py-1 rounded-full border border-border/40 text-center max-w-[90%]">
                  {msg.text}
                </div>
              </div>
            );
          }

          if (msg.sender === "agent") {
            return (
              <div key={msg.id} className="flex items-start gap-2.5 max-w-[85%]">
                <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <div className="p-3 rounded-2xl rounded-tl-sm bg-primary/10 border border-primary/20 text-foreground text-xs leading-relaxed">
                    {msg.text}
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground px-1">{msg.timestamp}</span>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex items-start gap-2.5 max-w-[85%] ml-auto flex-row-reverse">
              <div className="h-7 w-7 rounded-full bg-accent text-primary text-xs font-bold flex items-center justify-center shrink-0 shadow-sm mt-0.5 border border-border/40">
                <User className="h-4 w-4" />
              </div>
              <div className="space-y-1 text-right">
                <div className="p-3 rounded-2xl rounded-tr-sm bg-accent border border-border/60 text-foreground text-xs leading-relaxed">
                  {msg.text}
                </div>
                <span className="text-[9px] font-mono text-muted-foreground px-1">{msg.timestamp}</span>
              </div>
            </div>
          );
        })}

        {isSimulationEnded && (
          <div className="p-4 rounded-xl bg-card border border-border/60 text-center space-y-2 mt-4 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 mx-auto">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h4 className="text-xs font-bold font-display text-foreground">Simulation Concluded</h4>
            <p className="text-[11px] text-muted-foreground">
              {stuckReason ? stuckReason : "Reached end node or terminal call state."}
            </p>
            <Button size="xs" variant="outline" onClick={restartSimulation} className="gap-1.5 text-xs">
              <RotateCcw className="h-3 w-3" />
              Run Again
            </Button>
          </div>
        )}
      </div>

      {/* User Input Bar (Active when listening) */}
      <div className="p-3 border-t border-border/60 bg-card space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendUserReply();
          }}
          className="flex items-center gap-2"
        >
          <Input
            placeholder={isWaitingForInput ? "Type customer reply (e.g. Yes, confirm)..." : "Waiting for flow execution..."}
            value={userInputText}
            onChange={(e) => setUserInputText(e.target.value)}
            disabled={!isWaitingForInput || isSimulationEnded}
            className="text-xs rounded-lg"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!isWaitingForInput || !userInputText.trim() || isSimulationEnded}
            className="h-9 w-9 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>

        {/* Step Navigation Log Footer */}
        <div className="pt-2 border-t border-border/40">
          <div className="text-[10px] font-mono text-muted-foreground uppercase font-semibold mb-1 flex items-center justify-between">
            <span>Execution Trace Log</span>
            <span>{stepLog.length} steps visited</span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {stepLog.map((step, idx) => (
              <button
                key={`${step.nodeId}-${idx}`}
                onClick={() => onSelectNodeOnCanvas?.(step.nodeId)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  currentNodeId === step.nodeId
                    ? "bg-primary text-primary-foreground border-primary font-bold"
                    : "bg-muted text-muted-foreground border-border/60 hover:bg-muted/80"
                }`}
                title="Click to highlight node on canvas"
              >
                {idx + 1}. {step.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
