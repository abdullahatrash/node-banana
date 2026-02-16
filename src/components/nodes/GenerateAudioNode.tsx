"use client";

import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { Handle, Position, NodeProps, Node, useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useCommentNavigation } from "@/hooks/useCommentNavigation";
import { ModelParameters } from "./ModelParameters";
import { useWorkflowStore, useProviderApiKeys } from "@/store/workflowStore";
import { deduplicatedFetch } from "@/utils/deduplicatedFetch";
import { GenerateAudioNodeData, ProviderType, SelectedModel, ModelInputDef } from "@/types";
import { ProviderModel, ModelCapability } from "@/lib/providers/types";
import { ModelSearchDialog } from "@/components/modals/ModelSearchDialog";
import { useAudioVisualization } from "@/hooks/useAudioVisualization";

// Provider badge component
function ProviderBadge({ provider }: { provider: ProviderType }) {
  const providerName = provider === "kie" ? "Kie.ai" : provider === "replicate" ? "Replicate" : provider === "wavespeed" ? "WaveSpeed" : "fal.ai";

  return (
    <span className="text-neutral-500 shrink-0" title={providerName}>
      {provider === "kie" ? (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 3h3.5v7L17 3h4l-8 8.5L21 21h-4l-7.5-8.5V21H6V3z" />
        </svg>
      ) : provider === "replicate" ? (
        <svg className="w-4 h-4" viewBox="0 0 1000 1000" fill="currentColor">
          <polygon points="1000,427.6 1000,540.6 603.4,540.6 603.4,1000 477,1000 477,427.6" />
          <polygon points="1000,213.8 1000,327 364.8,327 364.8,1000 238.4,1000 238.4,213.8" />
          <polygon points="1000,0 1000,113.2 126.4,113.2 126.4,1000 0,1000 0,0" />
        </svg>
      ) : provider === "wavespeed" ? (
        <svg className="w-4 h-4" viewBox="95 140 350 230" fill="currentColor">
          <path d="M308.946 153.758C314.185 153.758 318.268 158.321 317.516 163.506C306.856 237.02 270.334 302.155 217.471 349.386C211.398 354.812 203.458 357.586 195.315 357.586H127.562C117.863 357.586 110.001 349.724 110.001 340.025V333.552C110.001 326.82 113.882 320.731 119.792 317.505C176.087 286.779 217.883 232.832 232.32 168.537C234.216 160.09 241.509 153.758 250.167 153.758H308.946Z" />
          <path d="M183.573 153.758C188.576 153.758 192.592 157.940 192.069 162.916C187.11 210.12 160.549 250.886 122.45 275.151C116.916 278.676 110 274.489 110 267.928V171.318C110 161.62 117.862 153.758 127.56 153.758H183.573Z" />
          <path d="M414.815 153.758C425.503 153.758 433.734 163.232 431.799 173.743C420.697 234.038 398.943 290.601 368.564 341.414C362.464 351.617 351.307 357.586 339.419 357.586H274.228C266.726 357.586 262.611 348.727 267.233 342.819C306.591 292.513 334.86 233.113 348.361 168.295C350.104 159.925 357.372 153.758 365.922 153.758H414.815Z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 1855 1855" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M1181.65 78C1212.05 78 1236.42 101.947 1239.32 131.261C1265.25 392.744 1480.07 600.836 1750.02 625.948C1780.28 628.764 1805 652.366 1805 681.816V1174.18C1805 1203.63 1780.28 1227.24 1750.02 1230.05C1480.07 1255.16 1265.25 1463.26 1239.32 1724.74C1236.42 1754.05 1212.05 1778 1181.65 1778H673.354C642.951 1778 618.585 1754.05 615.678 1724.74C589.754 1463.26 374.927 1255.16 104.984 1230.05C74.7212 1227.24 50 1203.63 50 1174.18V681.816C50 652.366 74.7213 628.764 104.984 625.948C374.927 600.836 589.754 392.744 615.678 131.261C618.585 101.946 642.951 78 673.353 78H1181.65ZM402.377 926.561C402.377 1209.41 638.826 1438.71 930.501 1438.71C1222.18 1438.71 1458.63 1209.41 1458.63 926.561C1458.63 643.709 1222.18 414.412 930.501 414.412C638.826 414.412 402.377 643.709 402.377 926.561Z" />
        </svg>
      )}
    </span>
  );
}

// Audio generation capabilities
const AUDIO_CAPABILITIES: ModelCapability[] = ["text-to-audio"];

type GenerateAudioNodeType = Node<GenerateAudioNodeData, "generateAudio">;

export function GenerateAudioNode({ id, data, selected }: NodeProps<GenerateAudioNodeType>) {
  const nodeData = data;
  const commentNavigation = useCommentNavigation(id);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const { replicateApiKey, falApiKey, kieApiKey, wavespeedApiKey, replicateEnabled, kieEnabled } = useProviderApiKeys();
  const generationsPath = useWorkflowStore((state) => state.generationsPath);
  const [externalModels, setExternalModels] = useState<ProviderModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null);
  const [isBrowseDialogOpen, setIsBrowseDialogOpen] = useState(false);
  const [isLoadingCarouselAudio, setIsLoadingCarouselAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);

  // Get the current selected provider (default to fal)
  const currentProvider: ProviderType = nodeData.selectedModel?.provider || "fal";

  // Get enabled providers
  const enabledProviders = useMemo(() => {
    const providers: { id: ProviderType; name: string }[] = [];
    // fal.ai is always available
    providers.push({ id: "fal", name: "fal.ai" });
    // Add Replicate if configured
    if (replicateEnabled && replicateApiKey) {
      providers.push({ id: "replicate", name: "Replicate" });
    }
    // Add Kie.ai if configured
    if (kieEnabled && kieApiKey) {
      providers.push({ id: "kie", name: "Kie.ai" });
    }
    // Add WaveSpeed if configured (always check for key since enabled flag not in hook)
    if (wavespeedApiKey) {
      providers.push({ id: "wavespeed", name: "WaveSpeed" });
    }
    return providers;
  }, [replicateEnabled, replicateApiKey, kieEnabled, kieApiKey, wavespeedApiKey]);

  // Convert base64 data URL to Blob for visualization
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const { waveformData, isLoading: isLoadingWaveform } = useAudioVisualization(audioBlob);

  useEffect(() => {
    if (nodeData.outputAudio) {
      fetch(nodeData.outputAudio)
        .then((r) => r.blob())
        .then(setAudioBlob)
        .catch(() => setAudioBlob(null));
    } else {
      setAudioBlob(null);
    }
  }, [nodeData.outputAudio]);

  // Setup audio element
  useEffect(() => {
    if (nodeData.outputAudio && !audioRef.current) {
      const audio = new Audio(nodeData.outputAudio);
      audioRef.current = audio;

      const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };
      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime);
      };

      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("timeupdate", handleTimeUpdate);

      return () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        audio.pause();
        audioRef.current = null;
      };
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [nodeData.outputAudio]);

  // Draw waveform
  const drawWaveform = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number, peaks: number[]) => {
      ctx.clearRect(0, 0, width, height);

      const barCount = Math.min(peaks.length, width);
      const barWidth = width / barCount;
      const barGap = 1;

      ctx.fillStyle = "rgb(167, 139, 250)"; // violet-400

      for (let i = 0; i < barCount; i++) {
        const peakIndex = Math.floor((i / barCount) * peaks.length);
        const peak = peaks[peakIndex] || 0;
        const barHeight = peak * height;
        const x = i * barWidth;
        const y = (height - barHeight) / 2;

        ctx.fillRect(x, y, barWidth - barGap, barHeight);
      }
    },
    []
  );

  // Effect: ResizeObserver for waveform canvas
  useEffect(() => {
    if (!waveformData || !canvasRef.current || !waveformContainerRef.current) return;

    const canvas = canvasRef.current;
    const container = waveformContainerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;

        canvas.width = width;
        canvas.height = height;

        drawWaveform(ctx, width, height, waveformData.peaks);
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [waveformData, drawWaveform]);

  // Effect: Redraw waveform with playback position
  useEffect(() => {
    if (!waveformData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    drawWaveform(ctx, width, height, waveformData.peaks);

    // Draw playback position
    if (isPlaying && nodeData.duration) {
      const progress = currentTime / nodeData.duration;
      const x = progress * width;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [isPlaying, currentTime, nodeData.duration, waveformData, drawWaveform]);

  // Fetch models from external providers
  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    setModelsFetchError(null);
    try {
      const capabilities = AUDIO_CAPABILITIES.join(",");
      const headers: HeadersInit = {};
      if (replicateApiKey) {
        headers["X-Replicate-Key"] = replicateApiKey;
      }
      if (falApiKey) {
        headers["X-Fal-Key"] = falApiKey;
      }
      if (kieApiKey) {
        headers["X-Kie-Key"] = kieApiKey;
      }
      if (wavespeedApiKey) {
        headers["X-WaveSpeed-Key"] = wavespeedApiKey;
      }
      const response = await deduplicatedFetch(`/api/models?provider=${currentProvider}&capabilities=${capabilities}`, { headers });
      if (response.ok) {
        const data = await response.json();
        setExternalModels(data.models || []);
        setModelsFetchError(null);
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `Failed to load models (${response.status})`;
        setExternalModels([]);
        setModelsFetchError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to fetch audio models:", error);
      setExternalModels([]);
      setModelsFetchError("Failed to load models. Check your connection.");
    } finally {
      setIsLoadingModels(false);
    }
  }, [currentProvider, replicateApiKey, falApiKey, kieApiKey, wavespeedApiKey]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Handle provider change
  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const provider = e.target.value as ProviderType;
      const newSelectedModel: SelectedModel = {
        provider,
        modelId: "",
        displayName: "Select model...",
      };
      updateNodeData(id, { selectedModel: newSelectedModel, parameters: {} });
    },
    [id, updateNodeData]
  );

  // Handle model change
  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const modelId = e.target.value;
      const model = externalModels.find(m => m.id === modelId);
      if (model) {
        const newSelectedModel: SelectedModel = {
          provider: currentProvider,
          modelId: model.id,
          displayName: model.name,
        };
        updateNodeData(id, { selectedModel: newSelectedModel, parameters: {} });
      }
    },
    [id, currentProvider, externalModels, updateNodeData]
  );

  const handleClearAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioBlob(null);
    updateNodeData(id, { outputAudio: null, status: "idle", error: null, duration: null, format: null });
  }, [id, updateNodeData]);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleParametersChange = useCallback(
    (parameters: Record<string, unknown>) => {
      updateNodeData(id, { parameters });
    },
    [id, updateNodeData]
  );

  const handleInputsLoaded = useCallback(
    (inputs: ModelInputDef[]) => {
      updateNodeData(id, { inputSchema: inputs });
    },
    [id, updateNodeData]
  );

  const { setNodes } = useReactFlow();
  const handleParametersExpandChange = useCallback(
    (expanded: boolean, parameterCount: number) => {
      const parameterHeight = expanded ? Math.max(parameterCount * 28 + 16, 60) : 0;
      const baseHeight = 300;
      const newHeight = baseHeight + parameterHeight;

      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, style: { ...node.style, height: newHeight } }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);

  const handleRegenerate = useCallback(() => {
    regenerateNode(id);
  }, [id, regenerateNode]);

  // Load audio by ID from generations folder
  const loadAudioById = useCallback(async (audioId: string) => {
    if (!generationsPath) {
      console.error("Generations path not configured");
      return null;
    }

    try {
      const response = await fetch("/api/load-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directoryPath: generationsPath,
          imageId: audioId,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        console.log(`Audio not found: ${audioId}`);
        return null;
      }
      return result.audio || result.image;
    } catch (error) {
      console.warn("Error loading audio:", error);
      return null;
    }
  }, [generationsPath]);

  // Carousel navigation handlers
  const handleCarouselPrevious = useCallback(async () => {
    const history = nodeData.audioHistory || [];
    if (history.length === 0 || isLoadingCarouselAudio) return;

    const currentIndex = nodeData.selectedAudioHistoryIndex || 0;
    const newIndex = currentIndex === 0 ? history.length - 1 : currentIndex - 1;
    const audioItem = history[newIndex];

    setIsLoadingCarouselAudio(true);
    const audio = await loadAudioById(audioItem.id);
    setIsLoadingCarouselAudio(false);

    if (audio) {
      updateNodeData(id, {
        outputAudio: audio,
        selectedAudioHistoryIndex: newIndex,
      });
    }
  }, [id, nodeData.audioHistory, nodeData.selectedAudioHistoryIndex, isLoadingCarouselAudio, loadAudioById, updateNodeData]);

  const handleCarouselNext = useCallback(async () => {
    const history = nodeData.audioHistory || [];
    if (history.length === 0 || isLoadingCarouselAudio) return;

    const currentIndex = nodeData.selectedAudioHistoryIndex || 0;
    const newIndex = (currentIndex + 1) % history.length;
    const audioItem = history[newIndex];

    setIsLoadingCarouselAudio(true);
    const audio = await loadAudioById(audioItem.id);
    setIsLoadingCarouselAudio(false);

    if (audio) {
      updateNodeData(id, {
        outputAudio: audio,
        selectedAudioHistoryIndex: newIndex,
      });
    }
  }, [id, nodeData.audioHistory, nodeData.selectedAudioHistoryIndex, isLoadingCarouselAudio, loadAudioById, updateNodeData]);

  const handleBrowseModelSelect = useCallback((model: ProviderModel) => {
    const newSelectedModel: SelectedModel = {
      provider: model.provider,
      modelId: model.id,
      displayName: model.name,
    };
    updateNodeData(id, { selectedModel: newSelectedModel, parameters: {} });
    setIsBrowseDialogOpen(false);
  }, [id, updateNodeData]);

  const displayTitle = useMemo(() => {
    if (nodeData.selectedModel?.displayName && nodeData.selectedModel.modelId) {
      return nodeData.selectedModel.displayName;
    }
    return "Generate Audio";
  }, [nodeData.selectedModel?.displayName, nodeData.selectedModel?.modelId]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Dynamic handles based on inputSchema
  const dynamicHandles = useMemo(() => {
    if (!nodeData.inputSchema || nodeData.inputSchema.length === 0) return null;

    return nodeData.inputSchema.map((input, index) => {
      const handleType = input.type === "image" ? "image" : "text";
      return (
        <Handle
          key={input.name}
          type="target"
          position={Position.Left}
          id={input.name}
          data-handletype={handleType}
          style={{
            background: handleType === "image" ? "rgb(34, 197, 94)" : "rgb(251, 191, 36)",
            top: `${50 + (index - nodeData.inputSchema!.length / 2 + 0.5) * 20}px`,
          }}
          title={input.label}
        />
      );
    });
  }, [nodeData.inputSchema]);

  return (
    <>
      <BaseNode
        id={id}
        title={displayTitle}
        customTitle={nodeData.customTitle}
        comment={nodeData.comment}
        onCustomTitleChange={(title) => updateNodeData(id, { customTitle: title || undefined })}
        onCommentChange={(comment) => updateNodeData(id, { comment: comment || undefined })}
        selected={selected}
        commentNavigation={commentNavigation ?? undefined}
        minWidth={300}
        minHeight={250}
      >
        {/* Provider and model selection */}
        <div className="flex flex-col gap-2 mb-2">
          <div className="flex gap-2">
            <select
              value={currentProvider}
              onChange={handleProviderChange}
              className="flex-1 px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded"
            >
              {enabledProviders.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setIsBrowseDialogOpen(true)}
              className="px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 rounded transition-colors"
              title="Browse all models"
            >
              Browse
            </button>
          </div>

          {isLoadingModels ? (
            <div className="text-xs text-neutral-500">Loading models...</div>
          ) : modelsFetchError ? (
            <div className="text-xs text-red-400">{modelsFetchError}</div>
          ) : (
            <select
              value={nodeData.selectedModel?.modelId || ""}
              onChange={handleModelChange}
              className="w-full px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded"
              disabled={externalModels.length === 0}
            >
              <option value="">Select model...</option>
              {externalModels.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Model parameters */}
        {nodeData.selectedModel?.modelId && (
          <ModelParameters
            provider={currentProvider}
            modelId={nodeData.selectedModel.modelId}
            parameters={nodeData.parameters || {}}
            onParametersChange={handleParametersChange}
            onInputsLoaded={handleInputsLoaded}
            onExpandChange={handleParametersExpandChange}
          />
        )}

        {/* Output audio player */}
        {nodeData.outputAudio && (
          <div className="relative group mt-2">
            {/* Waveform visualization */}
            {isLoadingWaveform ? (
              <div className="flex items-center justify-center bg-neutral-900/50 rounded h-16">
                <span className="text-xs text-neutral-500">Loading waveform...</span>
              </div>
            ) : waveformData ? (
              <div
                ref={waveformContainerRef}
                className="h-16 bg-neutral-900/50 rounded cursor-pointer relative"
              >
                <canvas ref={canvasRef} className="w-full h-full" />
              </div>
            ) : (
              <div className="flex items-center justify-center bg-neutral-900/50 rounded h-16">
                <span className="text-xs text-neutral-500">Processing...</span>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handlePlayPause}
                className="w-7 h-7 flex items-center justify-center bg-violet-600 hover:bg-violet-500 rounded transition-colors shrink-0"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Progress bar */}
              <div className="flex-1 h-1 bg-neutral-700 rounded-full overflow-hidden relative">
                {nodeData.duration && (
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${(currentTime / nodeData.duration) * 100}%` }}
                  />
                )}
              </div>

              {/* Time */}
              <span className="text-[10px] text-neutral-500 min-w-[32px] text-right">
                {formatTime(currentTime)}
              </span>

              {/* Carousel navigation */}
              {(nodeData.audioHistory?.length || 0) > 1 && (
                <>
                  <button
                    onClick={handleCarouselPrevious}
                    className="w-5 h-5 flex items-center justify-center bg-neutral-700 hover:bg-neutral-600 rounded transition-colors shrink-0"
                    disabled={isLoadingCarouselAudio}
                    title="Previous"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                    </svg>
                  </button>
                  <span className="text-[10px] text-neutral-500">
                    {(nodeData.selectedAudioHistoryIndex || 0) + 1}/{nodeData.audioHistory?.length}
                  </span>
                  <button
                    onClick={handleCarouselNext}
                    className="w-5 h-5 flex items-center justify-center bg-neutral-700 hover:bg-neutral-600 rounded transition-colors shrink-0"
                    disabled={isLoadingCarouselAudio}
                    title="Next"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* Clear button */}
            <button
              onClick={handleClearAudio}
              className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              title="Clear audio"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Status indicators */}
        {nodeData.status === "loading" && (
          <div className="flex items-center gap-2 mt-2">
            <div className="animate-spin w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full" />
            <span className="text-xs text-neutral-400">Generating audio...</span>
          </div>
        )}

        {nodeData.status === "error" && nodeData.error && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            {nodeData.error}
          </div>
        )}

        {/* Regenerate button */}
        {nodeData.status === "complete" && nodeData.outputAudio && (
          <button
            onClick={handleRegenerate}
            disabled={isRunning}
            className="w-full mt-2 px-2 py-1.5 text-xs bg-neutral-700 hover:bg-neutral-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Regenerate audio"
          >
            Regenerate
          </button>
        )}

        {/* Dynamic handles from schema */}
        {dynamicHandles}

        {/* Default prompt handle (if no dynamic schema) */}
        {(!nodeData.inputSchema || nodeData.inputSchema.length === 0) && (
          <Handle
            type="target"
            position={Position.Left}
            id="text"
            data-handletype="text"
            style={{ background: "rgb(251, 191, 36)" }}
          />
        )}

        {/* Output audio handle */}
        <Handle
          type="source"
          position={Position.Right}
          id="audio"
          data-handletype="audio"
          style={{ background: "rgb(167, 139, 250)" }}
        />
      </BaseNode>

      {/* Browse dialog */}
      {isBrowseDialogOpen && (
        <ModelSearchDialog
          isOpen={isBrowseDialogOpen}
          onClose={() => setIsBrowseDialogOpen(false)}
          onModelSelected={handleBrowseModelSelect}
          initialProvider={currentProvider}
          initialCapabilityFilter="audio"
        />
      )}
    </>
  );
}
